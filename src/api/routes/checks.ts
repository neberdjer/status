import { randomUUIDv7 } from "bun";
import { sql } from "../index";
import type { Service, ServiceCheck } from "../types";
import { getAuthContext, requireAuth } from "../utils/auth";
import { ok, badRequest, unauthorized, forbidden, notFound } from "../utils/response";
import { sendServiceDown, sendServiceUp } from "../utils/discord";
import { sendServiceDownEmail, sendServiceUpEmail } from "../utils/email";
import { broadcastCheck } from "../utils/sse";

async function isEmailEnabledForGroup(groupName: string | null): Promise<boolean> {
	const settingsRows = await sql`SELECT key, value FROM settings WHERE key IN ('smtp_enabled', 'email_is_global', 'email_groups')`;
	const map: Record<string, string> = {};
	for (const row of settingsRows) {
		map[row.key as string] = row.value as string;
	}

	if (map.smtp_enabled !== "true") return false;

	let inScope = false;
	if (map.email_is_global !== "false") {
		inScope = true;
	} else if (groupName) {
		try {
			const emailGroups = JSON.parse(map.email_groups || "[]");
			inScope = Array.isArray(emailGroups) && emailGroups.includes(groupName);
		} catch {
			inScope = false;
		}
	}

	if (!inScope) return false;

	if (!groupName) return false;
	const groupRows = await sql`SELECT email_notifications FROM groups WHERE name = ${groupName}`;
	return groupRows.length > 0 && groupRows[0].email_notifications === true;
}

function isServiceEmailEnabled(service: Service): boolean {
	return service.emailNotifications === true;
}

function rowToCheck(row: Record<string, unknown>): ServiceCheck {
	return {
		id: row.id as string,
		serviceId: row.service_id as string,
		statusCode: row.status_code as number | null,
		responseTime: row.response_time as number,
		success: row.success as boolean,
		errorMessage: row.error_message as string | null,
		checkedAt: row.checked_at as string,
	};
}

function rowToService(row: Record<string, unknown>): Service {
	return {
		id: row.id as string,
		name: row.name as string,
		description: row.description as string | null,
		url: row.url as string,
		displayUrl: row.display_url as string | null,
		expectedStatus: row.expected_status as number,
		expectedContentType: row.expected_content_type as string | null,
		expectedBody: row.expected_body as string | null,
		checkInterval: row.check_interval as number,
		enabled: row.enabled as boolean,
		isPublic: row.is_public as boolean,
		emailNotifications: (row.email_notifications as boolean) || false,
		groupName: row.group_name as string | null,
		position: (row.position as number) || 0,
		createdBy: row.created_by as string,
		createdAt: row.created_at as string,
		updatedAt: row.updated_at as string,
	};
}

const checkIntervals = new Map<string, ReturnType<typeof setInterval>>();
const lastCheckStatus = new Map<string, boolean>();
const consecutiveFailures = new Map<string, number>();
const notifiedDown = new Map<string, boolean>();
const checkInProgress = new Set<string>();

const SETTINGS_CACHE_TTL = 60_000;
let cachedRetryCount: { value: number; expires: number } | null = null;
let cachedCheckTimeout: { value: number; expires: number } | null = null;

async function getRetryCount(): Promise<number> {
	const now = Date.now();
	if (cachedRetryCount && now < cachedRetryCount.expires) return cachedRetryCount.value;
	const rows = await sql`SELECT value FROM settings WHERE key = 'retry_count'`;
	const value = rows.length === 0 ? 0 : Number.parseInt(rows[0].value as string, 10) || 0;
	cachedRetryCount = { value, expires: now + SETTINGS_CACHE_TTL };
	return value;
}

async function getCheckTimeout(): Promise<number> {
	const now = Date.now();
	if (cachedCheckTimeout && now < cachedCheckTimeout.expires) return cachedCheckTimeout.value;
	const rows = await sql`SELECT value FROM settings WHERE key = 'check_timeout'`;
	const value = rows.length === 0 ? 30000 : Number.parseInt(rows[0].value as string, 10) || 30000;
	cachedCheckTimeout = { value, expires: now + SETTINGS_CACHE_TTL };
	return value;
}

export function invalidateSettingsCache(): void {
	cachedRetryCount = null;
	cachedCheckTimeout = null;
}

async function shouldSendEmail(service: Service): Promise<boolean> {
	if (isServiceEmailEnabled(service)) return true;
	return await isEmailEnabledForGroup(service.groupName);
}

async function sendDownNotifications(service: Service, statusCode: number | null, errorMessage: string | null): Promise<void> {
	sendServiceDown(service.name, service.displayUrl || service.url, service.groupName, statusCode, errorMessage).catch(() => {});
	if (await shouldSendEmail(service)) {
		sendServiceDownEmail(service.name, service.url, service.displayUrl, service.groupName, statusCode, errorMessage).catch(() => {});
	}
}

async function sendUpNotifications(service: Service, responseTime: number): Promise<void> {
	sendServiceUp(service.name, service.displayUrl || service.url, service.groupName, responseTime).catch(() => {});
	if (await shouldSendEmail(service)) {
		sendServiceUpEmail(service.name, service.url, service.displayUrl, service.groupName, responseTime).catch(() => {});
	}
}

function jsonContains(actual: unknown, expected: unknown): boolean {
	if (typeof expected !== typeof actual) return false;

	if (expected === null || typeof expected !== "object") {
		return actual === expected;
	}

	if (Array.isArray(expected)) {
		if (!Array.isArray(actual)) return false;
		return expected.every((item, i) => jsonContains(actual[i], item));
	}

	for (const key of Object.keys(expected as Record<string, unknown>)) {
		if (!(key in (actual as Record<string, unknown>))) return false;
		if (!jsonContains((actual as Record<string, unknown>)[key], (expected as Record<string, unknown>)[key])) {
			return false;
		}
	}

	return true;
}

async function performSingleCheck(service: Service, timeoutMs: number): Promise<{
	statusCode: number | null;
	success: boolean;
	errorMessage: string | null;
	responseTime: number;
}> {
	const startTime = performance.now();
	let statusCode: number | null = null;
	let success = false;
	let errorMessage: string | null = null;

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort("timeout"), timeoutMs);

	try {
		const response = await fetch(service.url, {
			method: "GET",
			signal: controller.signal,
			headers: { "User-Agent": "atums-status/1.0" },
		});

		statusCode = response.status;

		const errors: string[] = [];

		if (statusCode !== service.expectedStatus) {
			errors.push(`Expected status ${service.expectedStatus}, got ${statusCode}`);
		}

		if (service.expectedContentType) {
			const contentType = response.headers.get("content-type") || "";
			if (!contentType.includes(service.expectedContentType)) {
				errors.push(`Expected content-type ${service.expectedContentType}, got ${contentType}`);
			}
		}

		if (service.expectedBody) {
			const body = await response.text();
			let matches = false;

			try {
				const expectedJson = JSON.parse(service.expectedBody);
				const actualJson = JSON.parse(body);
				matches = jsonContains(actualJson, expectedJson);
			} catch {
				matches = body.includes(service.expectedBody);
			}

			if (!matches) {
				errors.push(`Response body does not contain expected content`);
			}
		}

		success = errors.length === 0;
		if (!success) {
			errorMessage = errors.join("; ");
		}
	} catch (err) {
		if (err instanceof Error) {
			if (err.name === "AbortError") {
				errorMessage = "Request timed out";
			} else {
				errorMessage = err.message;
			}
		} else {
			errorMessage = "Unknown error";
		}
		success = false;
	} finally {
		clearTimeout(timeoutId);
	}

	return {
		statusCode,
		success,
		errorMessage,
		responseTime: Math.round(performance.now() - startTime),
	};
}

async function performCheck(service: Service): Promise<ServiceCheck> {
	const id = randomUUIDv7();
	const timeoutMs = await getCheckTimeout();

	let result = await performSingleCheck(service, timeoutMs);

	if (!result.success && (result.errorMessage === "Request timed out" || result.errorMessage === "The operation was aborted.")) {
		await new Promise((resolve) => setTimeout(resolve, 1000));
		result = await performSingleCheck(service, timeoutMs);
	}

	const { statusCode, success, errorMessage, responseTime } = result;

	await sql`
		INSERT INTO service_checks (id, service_id, status_code, response_time, success, error_message)
		VALUES (${id}, ${service.id}, ${statusCode}, ${responseTime}, ${success}, ${errorMessage})
	`;

	lastCheckStatus.set(service.id, success);

	if (success) {
		const wasNotifiedDown = notifiedDown.get(service.id) || false;
		consecutiveFailures.set(service.id, 0);
		if (wasNotifiedDown) {
			notifiedDown.set(service.id, false);
			sendUpNotifications(service, responseTime).catch((err) =>
				console.error(`[Notification] Error sending up notification for ${service.name}:`, err),
			);
		}
	} else {
		const failures = (consecutiveFailures.get(service.id) || 0) + 1;
		consecutiveFailures.set(service.id, failures);
		const retryCount = await getRetryCount();
		const alreadyNotified = notifiedDown.get(service.id) || false;
		if (!alreadyNotified && failures > retryCount) {
			notifiedDown.set(service.id, true);
			sendDownNotifications(service, statusCode, errorMessage).catch((err) =>
				console.error(`[Notification] Error sending down notification for ${service.name}:`, err),
			);
		}
	}

	const check: ServiceCheck = {
		id,
		serviceId: service.id,
		statusCode,
		responseTime,
		success,
		errorMessage,
		checkedAt: new Date().toISOString(),
	};

	broadcastCheck(service.id, check);

	return check;
}

async function performScheduledCheck(service: Service): Promise<void> {
	if (checkInProgress.has(service.id)) return;
	checkInProgress.add(service.id);
	try {
		await performCheck(service);
	} catch (err) {
		console.error(`[Check] Error checking ${service.name}:`, err);
	} finally {
		checkInProgress.delete(service.id);
	}
}

async function canAccessService(req: Request, serviceId: string): Promise<{ allowed: boolean; service?: Service; response?: Response }> {
	const rows = await sql`
		SELECT id, name, description, url, display_url, expected_status, expected_content_type, expected_body, check_interval, enabled, is_public, group_name, position, created_by, created_at, updated_at
		FROM services
		WHERE id = ${serviceId}
	`;

	if (rows.length === 0) {
		return { allowed: false, response: notFound("Service not found") };
	}

	const service = rowToService(rows[0]);

	if (service.isPublic) {
		return { allowed: true, service };
	}

	const auth = await getAuthContext(req);
	if (!requireAuth(auth)) {
		return { allowed: false, response: unauthorized() };
	}

	if (auth.user.id !== service.createdBy && !auth.isAdmin) {
		return { allowed: false, response: forbidden("Cannot access this service") };
	}

	return { allowed: true, service };
}

export async function getForService(
	req: Request,
	url: URL,
	params?: Record<string, string>,
): Promise<Response> {
	const serviceId = params?.id;
	if (!serviceId) {
		return badRequest("Service ID required");
	}

	const access = await canAccessService(req, serviceId);
	if (!access.allowed) {
		return access.response!;
	}

	const limit = Number(url.searchParams.get("limit")) || 100;

	const rows = await sql`
		SELECT id, service_id, status_code, response_time, success, error_message, checked_at
		FROM service_checks
		WHERE service_id = ${serviceId}
		ORDER BY checked_at DESC
		LIMIT ${limit}
	`;

	return ok({ checks: rows.map(rowToCheck) });
}

export async function getStatsForService(
	req: Request,
	_url: URL,
	params?: Record<string, string>,
): Promise<Response> {
	const serviceId = params?.id;
	if (!serviceId) {
		return badRequest("Service ID required");
	}

	const access = await canAccessService(req, serviceId);
	if (!access.allowed) {
		return access.response!;
	}

	const statsRows = await sql`
		SELECT
			COUNT(*) as total_checks,
			COUNT(*) FILTER (WHERE success = true) as successful_checks,
			AVG(response_time) as avg_response_time,
			MIN(response_time) as min_response_time,
			MAX(response_time) as max_response_time
		FROM service_checks
		WHERE service_id = ${serviceId}
		AND checked_at > NOW() - INTERVAL '24 hours'
	`;

	const stats = statsRows[0] || {};
	const totalChecks = Number(stats.total_checks) || 0;
	const successfulChecks = Number(stats.successful_checks) || 0;
	const uptimePercent = totalChecks > 0 ? (successfulChecks / totalChecks) * 100 : 0;

	return ok({
		stats: {
			totalChecks,
			successfulChecks,
			uptimePercent: Math.round(uptimePercent * 100) / 100,
			avgResponseTime: Math.round(Number(stats.avg_response_time) || 0),
			minResponseTime: Number(stats.min_response_time) || 0,
			maxResponseTime: Number(stats.max_response_time) || 0,
		},
	});
}

export async function getLatestForService(
	req: Request,
	_url: URL,
	params?: Record<string, string>,
): Promise<Response> {
	const serviceId = params?.id;
	if (!serviceId) {
		return badRequest("Service ID required");
	}

	const access = await canAccessService(req, serviceId);
	if (!access.allowed) {
		return access.response!;
	}

	const rows = await sql`
		SELECT id, service_id, status_code, response_time, success, error_message, checked_at
		FROM service_checks
		WHERE service_id = ${serviceId}
		ORDER BY checked_at DESC
		LIMIT 1
	`;

	return ok({ check: rows.length > 0 ? rowToCheck(rows[0]) : null });
}

async function filterAccessibleServiceIds(req: Request, serviceIds: string[]): Promise<string[]> {
	if (serviceIds.length === 0) return [];

	const serviceRows = await sql`
		SELECT id, is_public, created_by
		FROM services
		WHERE id = ANY(${sql.array(serviceIds, "TEXT")})
	`;

	const auth = await getAuthContext(req);
	const isAuthed = requireAuth(auth);

	return serviceRows
		.filter((row: Record<string, unknown>) => {
			if (row.is_public) return true;
			if (!isAuthed) return false;
			return auth.user.id === row.created_by || auth.isAdmin;
		})
		.map((row: Record<string, unknown>) => row.id as string);
}

export async function getLatestBatch(req: Request): Promise<Response> {
	const body = await req.json();
	const { serviceIds } = body;

	if (!Array.isArray(serviceIds)) {
		return badRequest("serviceIds array required");
	}

	const allowedIds = await filterAccessibleServiceIds(req, serviceIds);

	if (allowedIds.length === 0) {
		return ok({ checks: {} });
	}

	const rows = await sql`
		SELECT DISTINCT ON (service_id) id, service_id, status_code, response_time, success, error_message, checked_at
		FROM service_checks
		WHERE service_id = ANY(${sql.array(allowedIds, "TEXT")})
		ORDER BY service_id, checked_at DESC
	`;

	const checks: Record<string, ServiceCheck | null> = {};
	for (const id of allowedIds) {
		checks[id] = null;
	}
	for (const row of rows) {
		checks[row.service_id as string] = rowToCheck(row);
	}

	return ok({ checks });
}

export async function getStatsBatch(req: Request): Promise<Response> {
	const body = await req.json();
	const { serviceIds } = body;

	if (!Array.isArray(serviceIds)) {
		return badRequest("serviceIds array required");
	}

	const allowedIds = await filterAccessibleServiceIds(req, serviceIds);

	if (allowedIds.length === 0) {
		return ok({ stats: {} });
	}

	const rows = await sql`
		SELECT
			service_id,
			COUNT(*) as total_checks,
			COUNT(*) FILTER (WHERE success = true) as successful_checks
		FROM service_checks
		WHERE service_id = ANY(${sql.array(allowedIds, "TEXT")})
		AND checked_at > NOW() - INTERVAL '24 hours'
		GROUP BY service_id
	`;

	const stats: Record<string, { uptimePercent: number; totalChecks: number }> = {};
	for (const id of allowedIds) {
		stats[id] = { uptimePercent: 100, totalChecks: 0 };
	}
	for (const row of rows) {
		const totalChecks = Number(row.total_checks) || 0;
		const successfulChecks = Number(row.successful_checks) || 0;
		const uptimePercent = totalChecks > 0 ? (successfulChecks / totalChecks) * 100 : 100;
		stats[row.service_id as string] = {
			uptimePercent: Math.round(uptimePercent * 100) / 100,
			totalChecks,
		};
	}

	return ok({ stats });
}

export async function runCheck(
	req: Request,
	_url: URL,
	params?: Record<string, string>,
): Promise<Response> {
	const auth = await getAuthContext(req);
	if (!requireAuth(auth)) {
		return unauthorized();
	}

	const serviceId = params?.id;
	if (!serviceId) {
		return badRequest("Service ID required");
	}

	const rows = await sql`
		SELECT id, name, description, url, display_url, expected_status, expected_content_type, expected_body, check_interval, enabled, is_public, group_name, position, created_by, created_at, updated_at
		FROM services
		WHERE id = ${serviceId}
	`;

	if (rows.length === 0) {
		return notFound("Service not found");
	}

	const service = rowToService(rows[0]);

	if (service.createdBy !== auth.user.id && !auth.isAdmin) {
		return forbidden("Cannot run check for this service");
	}

	const check = await performCheck(service);

	return ok({ check });
}

export async function startChecker(
	req: Request,
	_url: URL,
	params?: Record<string, string>,
): Promise<Response> {
	const auth = await getAuthContext(req);
	if (!requireAuth(auth)) {
		return unauthorized();
	}

	const serviceId = params?.id;
	if (!serviceId) {
		return badRequest("Service ID required");
	}

	const rows = await sql`
		SELECT id, name, description, url, display_url, expected_status, expected_content_type, expected_body, check_interval, enabled, is_public, group_name, position, created_by, created_at, updated_at
		FROM services
		WHERE id = ${serviceId}
	`;

	if (rows.length === 0) {
		return notFound("Service not found");
	}

	const service = rowToService(rows[0]);

	if (service.createdBy !== auth.user.id && !auth.isAdmin) {
		return forbidden("Cannot start checker for this service");
	}

	if (checkIntervals.has(serviceId)) {
		clearInterval(checkIntervals.get(serviceId));
	}

	performScheduledCheck(service);

	const interval = setInterval(() => {
		performScheduledCheck(service);
	}, service.checkInterval * 1000);

	checkIntervals.set(serviceId, interval);

	return ok({ message: `Checker started for service ${serviceId}` });
}

export async function stopChecker(
	req: Request,
	_url: URL,
	params?: Record<string, string>,
): Promise<Response> {
	const auth = await getAuthContext(req);
	if (!requireAuth(auth)) {
		return unauthorized();
	}

	const serviceId = params?.id;
	if (!serviceId) {
		return badRequest("Service ID required");
	}

	const rows = await sql`SELECT created_by FROM services WHERE id = ${serviceId}`;
	if (rows.length === 0) {
		return notFound("Service not found");
	}

	if (rows[0].created_by !== auth.user.id && !auth.isAdmin) {
		return forbidden("Cannot stop checker for this service");
	}

	if (checkIntervals.has(serviceId)) {
		clearInterval(checkIntervals.get(serviceId));
		checkIntervals.delete(serviceId);
	}

	return ok({ message: `Checker stopped for service ${serviceId}` });
}

const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000;
let cleanupIntervalId: ReturnType<typeof setInterval> | null = null;

async function cleanupOldChecks(): Promise<void> {
	try {
		await sql`DELETE FROM service_checks WHERE checked_at < NOW() - INTERVAL '30 days'`;
	} catch (err) {
		console.error("[Cleanup] Error deleting old checks:", err);
	}
}

export async function initializeCheckers(): Promise<void> {
	const rows = await sql`
		SELECT id, name, description, url, display_url, expected_status, expected_content_type, expected_body, check_interval, enabled, is_public, email_notifications, group_name, position, created_by, created_at, updated_at
		FROM services
		WHERE enabled = true
	`;

	for (const row of rows) {
		const service = rowToService(row);

		performScheduledCheck(service);

		const interval = setInterval(() => {
			performScheduledCheck(service);
		}, service.checkInterval * 1000);

		checkIntervals.set(service.id, interval);
	}

	if (cleanupIntervalId) clearInterval(cleanupIntervalId);
	cleanupOldChecks();
	cleanupIntervalId = setInterval(cleanupOldChecks, CLEANUP_INTERVAL);
}

export async function startCheckerForService(serviceId: string): Promise<void> {
	const rows = await sql`
		SELECT id, name, description, url, display_url, expected_status, expected_content_type, expected_body, check_interval, enabled, is_public, email_notifications, group_name, position, created_by, created_at, updated_at
		FROM services
		WHERE id = ${serviceId} AND enabled = true
	`;

	if (rows.length === 0) return;

	const service = rowToService(rows[0]);

	if (checkIntervals.has(serviceId)) {
		clearInterval(checkIntervals.get(serviceId));
	}

	performScheduledCheck(service);

	const interval = setInterval(() => {
		performScheduledCheck(service);
	}, service.checkInterval * 1000);

	checkIntervals.set(serviceId, interval);
}
