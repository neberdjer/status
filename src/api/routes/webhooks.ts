import { randomUUIDv7 } from "bun";
import { sql } from "../index";
import type { Webhook, WebhookType } from "../../types";
import { getAuthContext, requireAuth, requireAdmin } from "../utils/auth";
import { ok, created, noContent, badRequest, unauthorized, forbidden, notFound } from "../utils/response";

function rowToWebhook(row: Record<string, unknown>): Webhook {
	return {
		id: row.id as string,
		name: row.name as string,
		url: row.url as string,
		type: row.type as WebhookType,
		isGlobal: row.is_global as boolean,
		groups: (row.groups as string[]) || [],
		enabled: row.enabled as boolean,
		messageDown: row.message_down as string,
		messageUp: row.message_up as string,
		avatarUrl: row.avatar_url as string | null,
		createdAt: row.created_at as string,
		updatedAt: row.updated_at as string,
	};
}

export async function list(req: Request): Promise<Response> {
	const auth = await getAuthContext(req);
	if (!requireAuth(auth)) {
		return unauthorized();
	}
	if (!requireAdmin(auth)) {
		return forbidden("Admin access required");
	}

	const rows = await sql`
		SELECT id, name, url, type, is_global, groups, enabled, message_down, message_up, avatar_url, created_at, updated_at
		FROM webhooks
		ORDER BY is_global DESC, name
	`;

	return ok({ webhooks: rows.map(rowToWebhook) });
}

export async function create(req: Request): Promise<Response> {
	const auth = await getAuthContext(req);
	if (!requireAuth(auth)) {
		return unauthorized();
	}
	if (!requireAdmin(auth)) {
		return forbidden("Admin access required");
	}

	const body = await req.json();
	const { name, url, type, isGlobal, groups, messageDown, messageUp, avatarUrl } = body;

	if (!name || typeof name !== "string") {
		return badRequest("Name is required");
	}
	if (!url || typeof url !== "string") {
		return badRequest("URL is required");
	}
	if (!type || !["discord", "webhook"].includes(type)) {
		return badRequest("Type must be 'discord' or 'webhook'");
	}

	const id = randomUUIDv7();
	const global = isGlobal === true;
	const groupList = Array.isArray(groups) ? groups.filter((g): g is string => typeof g === "string") : [];
	const groupsArray = `{${groupList.map(g => `"${g.replace(/"/g, '\\"')}"`).join(",")}}`;
	const msgDown = messageDown || "{service} is down";
	const msgUp = messageUp || "{service} is back up";
	const avatar = type === "discord" && avatarUrl ? avatarUrl : null;

	await sql`
		INSERT INTO webhooks (id, name, url, type, is_global, groups, message_down, message_up, avatar_url)
		VALUES (${id}, ${name}, ${url}, ${type}, ${global}, ${groupsArray}::text[], ${msgDown}, ${msgUp}, ${avatar})
	`;

	const rows = await sql`
		SELECT id, name, url, type, is_global, groups, enabled, message_down, message_up, avatar_url, created_at, updated_at
		FROM webhooks WHERE id = ${id}
	`;

	return created({ webhook: rowToWebhook(rows[0]) });
}

export async function update(
	req: Request,
	_url: URL,
	params?: Record<string, string>,
): Promise<Response> {
	const auth = await getAuthContext(req);
	if (!requireAuth(auth)) {
		return unauthorized();
	}
	if (!requireAdmin(auth)) {
		return forbidden("Admin access required");
	}

	const webhookId = params?.id;
	if (!webhookId) {
		return badRequest("Webhook ID required");
	}

	const existing = await sql`SELECT id FROM webhooks WHERE id = ${webhookId}`;
	if (existing.length === 0) {
		return notFound("Webhook not found");
	}

	const body = await req.json();
	const { name, url, type, isGlobal, groups, enabled, messageDown, messageUp, avatarUrl } = body;

	if (typeof name === "string") {
		await sql`UPDATE webhooks SET name = ${name}, updated_at = NOW() WHERE id = ${webhookId}`;
	}
	if (typeof url === "string") {
		await sql`UPDATE webhooks SET url = ${url}, updated_at = NOW() WHERE id = ${webhookId}`;
	}
	if (type && ["discord", "webhook"].includes(type)) {
		await sql`UPDATE webhooks SET type = ${type}, updated_at = NOW() WHERE id = ${webhookId}`;
	}
	if (typeof isGlobal === "boolean") {
		await sql`UPDATE webhooks SET is_global = ${isGlobal}, updated_at = NOW() WHERE id = ${webhookId}`;
	}
	if (Array.isArray(groups)) {
		const groupList = groups.filter((g): g is string => typeof g === "string");
		const groupsArray = `{${groupList.map(g => `"${g.replace(/"/g, '\\"')}"`).join(",")}}`;
		await sql`UPDATE webhooks SET groups = ${groupsArray}::text[], updated_at = NOW() WHERE id = ${webhookId}`;
	}
	if (typeof enabled === "boolean") {
		await sql`UPDATE webhooks SET enabled = ${enabled}, updated_at = NOW() WHERE id = ${webhookId}`;
	}
	if (typeof messageDown === "string") {
		await sql`UPDATE webhooks SET message_down = ${messageDown}, updated_at = NOW() WHERE id = ${webhookId}`;
	}
	if (typeof messageUp === "string") {
		await sql`UPDATE webhooks SET message_up = ${messageUp}, updated_at = NOW() WHERE id = ${webhookId}`;
	}
	if (avatarUrl !== undefined) {
		await sql`UPDATE webhooks SET avatar_url = ${avatarUrl || null}, updated_at = NOW() WHERE id = ${webhookId}`;
	}

	const rows = await sql`
		SELECT id, name, url, type, is_global, groups, enabled, message_down, message_up, avatar_url, created_at, updated_at
		FROM webhooks WHERE id = ${webhookId}
	`;

	return ok({ webhook: rowToWebhook(rows[0]) });
}

export async function remove(
	req: Request,
	_url: URL,
	params?: Record<string, string>,
): Promise<Response> {
	const auth = await getAuthContext(req);
	if (!requireAuth(auth)) {
		return unauthorized();
	}
	if (!requireAdmin(auth)) {
		return forbidden("Admin access required");
	}

	const webhookId = params?.id;
	if (!webhookId) {
		return badRequest("Webhook ID required");
	}

	const existing = await sql`SELECT id FROM webhooks WHERE id = ${webhookId}`;
	if (existing.length === 0) {
		return notFound("Webhook not found");
	}

	await sql`DELETE FROM webhooks WHERE id = ${webhookId}`;

	return noContent();
}

export async function getWebhooksForGroup(groupName: string | null): Promise<Webhook[]> {
	let rows;
	if (groupName) {
		rows = await sql`
			SELECT id, name, url, type, is_global, groups, enabled, message_down, message_up, avatar_url, created_at, updated_at
			FROM webhooks
			WHERE enabled = true
			AND (is_global = true OR groups @> ARRAY[${groupName}]::text[])
		`;
	} else {
		rows = await sql`
			SELECT id, name, url, type, is_global, groups, enabled, message_down, message_up, avatar_url, created_at, updated_at
			FROM webhooks
			WHERE enabled = true
			AND is_global = true
		`;
	}
	return rows.map(rowToWebhook);
}
