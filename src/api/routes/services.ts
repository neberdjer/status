import { randomUUIDv7 } from "bun";
import { sql } from "../index";
import type { Group, Service } from "../types";
import { getAuthContext, requireAuth, requireAdmin } from "../utils/auth";
import { ok, created, noContent, badRequest, unauthorized, forbidden, notFound } from "../utils/response";

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

function rowToGroup(row: Record<string, unknown>): Group {
	return {
		id: row.id as string,
		name: row.name as string,
		position: (row.position as number) || 0,
		emailNotifications: (row.email_notifications as boolean) || false,
		createdAt: row.created_at as string,
		parentGroupName: (row.parent_group_name as string) || null,
	};
}

export async function list(req: Request): Promise<Response> {
	const auth = await getAuthContext(req);
	if (!requireAuth(auth)) {
		return unauthorized();
	}

	const rows = await sql`
		SELECT id, name, description, url, display_url, expected_status, expected_content_type, expected_body, check_interval, enabled, is_public, email_notifications, group_name, position, created_by, created_at, updated_at
		FROM services
		ORDER BY position ASC, created_at ASC
	`;

	return ok({ services: rows.map(rowToService) });
}

export async function listPublic(): Promise<Response> {
	const rows = await sql`
		SELECT id, name, description, url, display_url, expected_status, expected_content_type, expected_body, check_interval, enabled, is_public, email_notifications, group_name, position, created_by, created_at, updated_at
		FROM services
		WHERE is_public = true AND enabled = true
		ORDER BY position ASC, created_at ASC
	`;

	return ok({ services: rows.map(rowToService) });
}

export async function listByUser(
	req: Request,
	_url: URL,
	params?: Record<string, string>,
): Promise<Response> {
	const auth = await getAuthContext(req);
	if (!requireAuth(auth)) {
		return unauthorized();
	}

	const userId = params?.id;
	if (!userId) {
		return badRequest("User ID required");
	}

	if (auth.user.id !== userId && !auth.isAdmin) {
		return forbidden("Cannot access other users' services");
	}

	const rows = await sql`
		SELECT id, name, description, url, display_url, expected_status, expected_content_type, expected_body, check_interval, enabled, is_public, email_notifications, group_name, position, created_by, created_at, updated_at
		FROM services
		WHERE created_by = ${userId}
		ORDER BY position ASC, created_at ASC
	`;

	return ok({ services: rows.map(rowToService) });
}

export async function get(
	req: Request,
	_url: URL,
	params?: Record<string, string>,
): Promise<Response> {
	const id = params?.id;
	if (!id) {
		return badRequest("Service ID required");
	}

	const rows = await sql`
		SELECT id, name, description, url, display_url, expected_status, expected_content_type, expected_body, check_interval, enabled, is_public, email_notifications, group_name, position, created_by, created_at, updated_at
		FROM services
		WHERE id = ${id}
	`;

	if (rows.length === 0) {
		return notFound("Service not found");
	}

	const service = rowToService(rows[0]);

	if (!service.isPublic) {
		const auth = await getAuthContext(req);
		if (!requireAuth(auth)) {
			return unauthorized();
		}
		if (auth.user.id !== service.createdBy && !auth.isAdmin) {
			return forbidden("Cannot access this service");
		}
	}

	return ok({ service });
}

export async function create(req: Request): Promise<Response> {
	const auth = await getAuthContext(req);
	if (!requireAuth(auth)) {
		return unauthorized();
	}

	const body = await req.json();
	const {
		name,
		url,
		description,
		displayUrl = null,
		expectedStatus = 200,
		expectedContentType = null,
		expectedBody = null,
		checkInterval = 60,
		enabled = true,
		isPublic = false,
		emailNotifications = false,
		groupName = null,
		position,
	} = body;

	if (!name || !url) {
		return badRequest("Name and URL required");
	}

	try {
		new URL(url);
	} catch {
		return badRequest("Invalid URL format");
	}

	const id = randomUUIDv7();
	const createdBy = auth.user.id;

	const maxPosResult = await sql`SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM services`;
	const nextPosition = position ?? (maxPosResult[0]?.next_pos || 0);

	await sql`
		INSERT INTO services (id, name, description, url, display_url, expected_status, expected_content_type, expected_body, check_interval, enabled, is_public, email_notifications, group_name, position, created_by)
		VALUES (${id}, ${name}, ${description || null}, ${url}, ${displayUrl || null}, ${expectedStatus}, ${expectedContentType}, ${expectedBody}, ${checkInterval}, ${enabled}, ${isPublic}, ${emailNotifications}, ${groupName || null}, ${nextPosition}, ${createdBy})
	`;

	const rows = await sql`
		SELECT id, name, description, url, display_url, expected_status, expected_content_type, expected_body, check_interval, enabled, is_public, email_notifications, group_name, position, created_by, created_at, updated_at
		FROM services
		WHERE id = ${id}
	`;

	return created({ service: rowToService(rows[0]) });
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

	const id = params?.id;
	if (!id) {
		return badRequest("Service ID required");
	}

	const existing = await sql`SELECT created_by FROM services WHERE id = ${id}`;
	if (existing.length === 0) {
		return notFound("Service not found");
	}

	if (existing[0].created_by !== auth.user.id && !auth.isAdmin) {
		return forbidden("Cannot modify this service");
	}

	const body = await req.json();
	const {
		name,
		description,
		url: serviceUrl,
		displayUrl,
		expectedStatus,
		expectedContentType,
		expectedBody,
		checkInterval,
		enabled,
		isPublic,
		emailNotifications,
		groupName,
		position,
	} = body;

	if (serviceUrl !== undefined) {
		try {
			new URL(serviceUrl);
		} catch {
			return badRequest("Invalid URL format");
		}
	}

	const updates: Record<string, unknown> = {};
	if (name !== undefined) updates.name = name;
	if (description !== undefined) updates.description = description;
	if (serviceUrl !== undefined) updates.url = serviceUrl;
	if (displayUrl !== undefined) updates.display_url = displayUrl;
	if (expectedStatus !== undefined) updates.expected_status = expectedStatus;
	if (expectedContentType !== undefined) updates.expected_content_type = expectedContentType;
	if (expectedBody !== undefined) updates.expected_body = expectedBody;
	if (checkInterval !== undefined) updates.check_interval = checkInterval;
	if (enabled !== undefined) updates.enabled = enabled;
	if (isPublic !== undefined) updates.is_public = isPublic;
	if (emailNotifications !== undefined) updates.email_notifications = emailNotifications;
	if (groupName !== undefined) updates.group_name = groupName;
	if (position !== undefined) updates.position = position;

	if (Object.keys(updates).length === 0) {
		return badRequest("No fields to update");
	}

	await sql`
		UPDATE services
		SET ${sql(updates)}, updated_at = NOW()
		WHERE id = ${id}
	`;

	const rows = await sql`
		SELECT id, name, description, url, display_url, expected_status, expected_content_type, expected_body, check_interval, enabled, is_public, email_notifications, group_name, position, created_by, created_at, updated_at
		FROM services
		WHERE id = ${id}
	`;

	return ok({ service: rowToService(rows[0]) });
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

	const id = params?.id;
	if (!id) {
		return badRequest("Service ID required");
	}

	const existing = await sql`SELECT created_by FROM services WHERE id = ${id}`;
	if (existing.length === 0) {
		return notFound("Service not found");
	}

	if (existing[0].created_by !== auth.user.id && !auth.isAdmin) {
		return forbidden("Cannot delete this service");
	}

	await sql`DELETE FROM services WHERE id = ${id}`;

	return noContent();
}

export async function updatePositions(req: Request): Promise<Response> {
	const auth = await getAuthContext(req);
	if (!requireAuth(auth)) {
		return unauthorized();
	}

	const body = await req.json();
	const { positions } = body;

	if (!Array.isArray(positions)) {
		return badRequest("Positions array required");
	}

	const ids = positions.map((p: { id: string }) => p.id);
	const existing = await sql`
		SELECT id, created_by FROM services WHERE id = ANY(${sql.array(ids, "TEXT")})
	`;

	const ownerById = new Map<string, string>();
	for (const row of existing) {
		ownerById.set(row.id as string, row.created_by as string);
	}

	for (const { id } of positions) {
		const owner = ownerById.get(id);
		if (owner === undefined) continue;
		if (owner !== auth.user.id && !auth.isAdmin) {
			return forbidden("Cannot modify service positions");
		}
	}

	for (const { id, position, groupName } of positions) {
		if (!ownerById.has(id)) continue;

		if (groupName !== undefined) {
			await sql`UPDATE services SET position = ${position}, group_name = ${groupName}, updated_at = NOW() WHERE id = ${id}`;
		} else {
			await sql`UPDATE services SET position = ${position}, updated_at = NOW() WHERE id = ${id}`;
		}
	}

	return ok({ message: "Positions updated" });
}

export async function listGroups(): Promise<Response> {
	const dbGroups = await sql`
		SELECT id, name, position, email_notifications, created_at, parent_group_name
		FROM groups
		ORDER BY position ASC, name ASC
	`;

	const serviceGroups = await sql`
		SELECT DISTINCT group_name
		FROM services
		WHERE group_name IS NOT NULL
	`;

	const dbGroupNames = new Set(dbGroups.map((r: Record<string, unknown>) => r.name));
	const allGroups = [...dbGroups.map(rowToGroup)];

	for (const row of serviceGroups) {
		if (!dbGroupNames.has(row.group_name as string)) {
			allGroups.push({
				id: `service-group-${row.group_name}`,
				name: row.group_name as string,
				position: allGroups.length,
				emailNotifications: false,
				createdAt: new Date().toISOString(),
				parentGroupName: null,
			});
		}
	}

	return ok({ groups: allGroups });
}

export async function listGroupsHierarchy(): Promise<Response> {
	const dbGroups = await sql`
		SELECT id, name, position, email_notifications, created_at, parent_group_name
		FROM groups
		ORDER BY position ASC, name ASC
	`;

	const groups = dbGroups.map(rowToGroup);

	const masterGroups: (Group & { subGroups: Group[] })[] = [];
	const subGroupMap = new Map<string, Group[]>();

	for (const group of groups) {
		if (group.parentGroupName) {
			const existing = subGroupMap.get(group.parentGroupName) || [];
			existing.push(group);
			subGroupMap.set(group.parentGroupName, existing);
		}
	}

	for (const group of groups) {
		if (!group.parentGroupName) {
			masterGroups.push({
				...group,
				subGroups: (subGroupMap.get(group.name) || []).sort((a, b) => a.position - b.position),
			});
		}
	}

	return ok({ masterGroups, groups });
}

export async function upsertGroup(req: Request): Promise<Response> {
	const auth = await getAuthContext(req);
	if (!requireAdmin(auth)) {
		return forbidden("Admin access required");
	}

	const body = await req.json();
	const { name, position, parentGroupName } = body;

	if (!name) {
		return badRequest("Name required");
	}

	if (parentGroupName) {
		const parentExists = await sql`SELECT id, parent_group_name FROM groups WHERE name = ${parentGroupName}`;
		if (parentExists.length === 0) {
			return badRequest("Parent group does not exist");
		}
		if (parentExists[0].parent_group_name) {
			return badRequest("Cannot nest more than 2 levels deep");
		}
	}

	const existing = await sql`SELECT id FROM groups WHERE name = ${name}`;

	if (existing.length > 0) {
		await sql`UPDATE groups SET position = ${position ?? 0}, parent_group_name = ${parentGroupName || null} WHERE name = ${name}`;
	} else {
		const id = randomUUIDv7();
		const maxPosResult = await sql`SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM groups`;
		const nextPosition = position ?? (maxPosResult[0]?.next_pos || 0);
		await sql`INSERT INTO groups (id, name, position, parent_group_name) VALUES (${id}, ${name}, ${nextPosition}, ${parentGroupName || null})`;
	}

	const rows = await sql`SELECT id, name, position, email_notifications, created_at, parent_group_name FROM groups WHERE name = ${name}`;
	return ok({ group: rowToGroup(rows[0]) });
}

export async function updateGroupPositions(req: Request): Promise<Response> {
	const auth = await getAuthContext(req);
	if (!requireAdmin(auth)) {
		return forbidden("Admin access required");
	}

	const body = await req.json();
	const { positions } = body;

	if (!Array.isArray(positions)) {
		return badRequest("Positions array required");
	}

	for (const { name, position } of positions) {
		const existing = await sql`SELECT id FROM groups WHERE name = ${name}`;
		if (existing.length > 0) {
			await sql`UPDATE groups SET position = ${position} WHERE name = ${name}`;
		} else {
			const id = randomUUIDv7();
			await sql`INSERT INTO groups (id, name, position) VALUES (${id}, ${name}, ${position})`;
		}
	}

	return ok({ message: "Group positions updated" });
}

export async function renameGroup(req: Request): Promise<Response> {
	const auth = await getAuthContext(req);
	if (!requireAdmin(auth)) {
		return forbidden("Admin access required");
	}

	const body = await req.json();
	const { oldName, newName } = body;

	if (!oldName || !newName) {
		return badRequest("Old name and new name required");
	}

	if (oldName === newName) {
		return ok({ message: "No change needed" });
	}

	const existingNew = await sql`SELECT id FROM groups WHERE name = ${newName}`;
	if (existingNew.length > 0) {
		return badRequest("A group with that name already exists");
	}

	await sql`UPDATE groups SET name = ${newName} WHERE name = ${oldName}`;
	await sql`UPDATE groups SET parent_group_name = ${newName} WHERE parent_group_name = ${oldName}`;
	await sql`UPDATE services SET group_name = ${newName} WHERE group_name = ${oldName}`;

	return ok({ message: "Group renamed" });
}

export async function deleteGroup(req: Request): Promise<Response> {
	const auth = await getAuthContext(req);
	if (!requireAdmin(auth)) {
		return forbidden("Admin access required");
	}

	const body = await req.json();
	const { name } = body;

	if (!name) {
		return badRequest("Group name required");
	}

	await sql`UPDATE services SET group_name = NULL WHERE group_name = ${name}`;
	await sql`UPDATE groups SET parent_group_name = NULL WHERE parent_group_name = ${name}`;
	await sql`DELETE FROM groups WHERE name = ${name}`;

	return noContent();
}

export async function updateGroupEmailNotifications(req: Request): Promise<Response> {
	const auth = await getAuthContext(req);
	if (!requireAdmin(auth)) {
		return forbidden("Admin access required");
	}

	const body = await req.json();
	const { name, emailNotifications } = body;

	if (!name) {
		return badRequest("Group name required");
	}

	if (typeof emailNotifications !== "boolean") {
		return badRequest("emailNotifications must be a boolean");
	}

	const existing = await sql`SELECT id FROM groups WHERE name = ${name}`;
	if (existing.length === 0) {
		const id = randomUUIDv7();
		await sql`INSERT INTO groups (id, name, position, email_notifications) VALUES (${id}, ${name}, 0, ${emailNotifications})`;
	} else {
		await sql`UPDATE groups SET email_notifications = ${emailNotifications} WHERE name = ${name}`;
	}

	const rows = await sql`SELECT id, name, position, email_notifications, created_at FROM groups WHERE name = ${name}`;
	return ok({ group: rowToGroup(rows[0]) });
}
