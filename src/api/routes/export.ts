import { randomUUIDv7 } from "bun";
import { sql } from "../index";
import type { ExportData, ExportGroup, ExportService } from "../types";
import { getAuthContext, requireAuth, requireAdmin } from "../utils/auth";
import { ok, badRequest, unauthorized, forbidden, notFound } from "../utils/response";
import { startCheckerForService } from "./checks";

const EXPORT_VERSION = 1;

function rowToExportGroup(row: Record<string, unknown>): ExportGroup {
	return {
		name: row.name as string,
		position: (row.position as number) || 0,
		emailNotifications: (row.email_notifications as boolean) || false,
		parentGroupName: (row.parent_group_name as string) || null,
	};
}

function rowToExportService(row: Record<string, unknown>): ExportService {
	return {
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
	};
}

export async function exportGlobal(req: Request): Promise<Response> {
	const auth = await getAuthContext(req);
	if (!requireAdmin(auth)) {
		return forbidden("Admin access required");
	}

	const groups = await sql`
		SELECT name, position, email_notifications
		FROM groups
		ORDER BY position ASC, name ASC
	`;

	const services = await sql`
		SELECT name, description, url, display_url, expected_status, expected_content_type, expected_body, check_interval, enabled, is_public, email_notifications, group_name, position
		FROM services
		ORDER BY position ASC, created_at ASC
	`;

	const exportData: ExportData = {
		version: EXPORT_VERSION,
		type: "global",
		exportedAt: new Date().toISOString(),
		data: {
			groups: groups.map(rowToExportGroup),
			services: services.map(rowToExportService),
		},
	};

	return ok(exportData);
}

export async function exportGroup(
	req: Request,
	_url: URL,
	params?: Record<string, string>,
): Promise<Response> {
	const auth = await getAuthContext(req);
	if (!requireAuth(auth)) {
		return unauthorized();
	}

	const groupName = params?.id;
	if (!groupName) {
		return badRequest("Group name required");
	}

	const decodedGroupName = decodeURIComponent(groupName);

	const groups = await sql`
		SELECT name, position, email_notifications
		FROM groups
		WHERE name = ${decodedGroupName}
	`;

	if (groups.length === 0) {
		return notFound("Group not found");
	}

	const services = await sql`
		SELECT name, description, url, display_url, expected_status, expected_content_type, expected_body, check_interval, enabled, is_public, email_notifications, group_name, position
		FROM services
		WHERE group_name = ${decodedGroupName}
		ORDER BY position ASC, created_at ASC
	`;

	const exportData: ExportData = {
		version: EXPORT_VERSION,
		type: "group",
		exportedAt: new Date().toISOString(),
		data: {
			groups: groups.map(rowToExportGroup),
			services: services.map(rowToExportService),
		},
	};

	return ok(exportData);
}

export async function exportService(
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

	const services = await sql`
		SELECT name, description, url, display_url, expected_status, expected_content_type, expected_body, check_interval, enabled, is_public, email_notifications, group_name, position, created_by
		FROM services
		WHERE id = ${serviceId}
	`;

	if (services.length === 0) {
		return notFound("Service not found");
	}

	const service = services[0];
	if (service.created_by !== auth.user.id && !auth.isAdmin) {
		return forbidden("Cannot export this service");
	}

	const exportData: ExportData = {
		version: EXPORT_VERSION,
		type: "service",
		exportedAt: new Date().toISOString(),
		data: {
			services: [rowToExportService(service)],
		},
	};

	return ok(exportData);
}

export async function importData(req: Request): Promise<Response> {
	const auth = await getAuthContext(req);
	if (!requireAuth(auth)) {
		return unauthorized();
	}

	let importData: ExportData;
	try {
		importData = await req.json();
	} catch {
		return badRequest("Invalid JSON");
	}

	if (!importData.version || !importData.type || !importData.data) {
		return badRequest("Invalid export format");
	}

	if (importData.version !== EXPORT_VERSION) {
		return badRequest(`Unsupported export version: ${importData.version}`);
	}

	const stats = {
		groupsCreated: 0,
		groupsRenamed: 0,
		servicesCreated: 0,
	};

	async function getUniqueGroupName(baseName: string): Promise<string> {
		const existing = await sql`SELECT id FROM groups WHERE name = ${baseName}`;
		if (existing.length === 0) return baseName;

		let counter = 1;
		while (true) {
			const newName = `${baseName}-(${counter})`;
			const check = await sql`SELECT id FROM groups WHERE name = ${newName}`;
			if (check.length === 0) return newName;
			counter++;
		}
	}

	const groupNameMap: Record<string, string> = {};

	if (importData.data.groups && importData.data.groups.length > 0) {
		if (!requireAdmin(auth)) {
			return forbidden("Admin access required to import groups");
		}

		for (const group of importData.data.groups) {
			const uniqueName = await getUniqueGroupName(group.name);
			if (uniqueName !== group.name) {
				groupNameMap[group.name] = uniqueName;
				stats.groupsRenamed++;
			}

			const id = randomUUIDv7();
			await sql`
				INSERT INTO groups (id, name, position, email_notifications)
				VALUES (${id}, ${uniqueName}, ${group.position}, ${group.emailNotifications})
			`;
			stats.groupsCreated++;
		}
	}

	if (importData.data.services) {
		for (const service of importData.data.services) {
			let groupName = service.groupName;
			if (groupName && groupNameMap[groupName]) {
				groupName = groupNameMap[groupName];
			}

			if (groupName) {
				const groupExists = await sql`SELECT id FROM groups WHERE name = ${groupName}`;
				if (groupExists.length === 0) {
					if (requireAdmin(auth)) {
						const groupId = randomUUIDv7();
						const maxPosResult = await sql`SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM groups`;
						await sql`
							INSERT INTO groups (id, name, position)
							VALUES (${groupId}, ${groupName}, ${maxPosResult[0]?.next_pos || 0})
						`;
						stats.groupsCreated++;
					} else {
						groupName = null;
					}
				}
			}

			const id = randomUUIDv7();
			const maxPosResult = await sql`SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM services`;
			const position = service.position ?? maxPosResult[0]?.next_pos ?? 0;

			await sql`
				INSERT INTO services (
					id, name, description, url, display_url, expected_status, expected_content_type,
					expected_body, check_interval, enabled, is_public, email_notifications, group_name, position, created_by
				)
				VALUES (
					${id}, ${service.name}, ${service.description}, ${service.url}, ${service.displayUrl},
					${service.expectedStatus}, ${service.expectedContentType}, ${service.expectedBody},
					${service.checkInterval}, ${service.enabled}, ${service.isPublic}, ${service.emailNotifications},
					${groupName}, ${position}, ${auth.user.id}
				)
			`;
			stats.servicesCreated++;

			if (service.enabled) {
				startCheckerForService(id).catch((err) => {
					console.error(`[Import] Failed to start checker for service ${id}:`, err);
				});
			}
		}
	}

	return ok({
		message: "Import completed",
		stats,
	});
}
