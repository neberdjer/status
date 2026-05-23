import { randomUUIDv7 } from "bun";
import { sql } from "../index";
import type { Invite } from "../types";
import { getAuthContext, requireAdmin } from "../utils/auth";
import { ok, created, noContent, badRequest, forbidden, notFound } from "../utils/response";

function generateCode(): string {
	const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
	let code = "";
	for (let i = 0; i < 8; i++) {
		code += chars[Math.floor(Math.random() * chars.length)];
	}
	return code;
}

function rowToInvite(row: Record<string, unknown>): Invite {
	return {
		id: row.id as string,
		code: row.code as string,
		createdBy: row.created_by as string,
		usedBy: row.used_by as string | null,
		usedByUsername: row.used_by_username as string | null,
		usedAt: row.used_at as string | null,
		expiresAt: row.expires_at as string | null,
		createdAt: row.created_at as string,
	};
}

export async function list(
	req: Request,
	_url: URL,
	params?: Record<string, string>,
): Promise<Response> {
	const auth = await getAuthContext(req);
	if (!requireAdmin(auth)) {
		return forbidden("Admin access required");
	}

	const userId = params?.id;
	if (!userId) {
		return badRequest("User ID required");
	}

	const rows = await sql`
		SELECT
			i.id,
			i.code,
			i.created_by,
			i.used_by,
			i.used_at,
			i.expires_at,
			i.created_at,
			u.username as used_by_username
		FROM invites i
		LEFT JOIN users u ON i.used_by = u.id
		WHERE i.created_by = ${userId}
		ORDER BY i.created_at DESC
	`;

	return ok({ invites: rows.map(rowToInvite) });
}

export async function create(
	req: Request,
	_url: URL,
	params?: Record<string, string>,
): Promise<Response> {
	const auth = await getAuthContext(req);
	if (!requireAdmin(auth)) {
		return forbidden("Admin access required");
	}

	const userId = params?.id;
	if (!userId) {
		return badRequest("User ID required");
	}

	if (auth.user.id !== userId) {
		return forbidden("Cannot create invites for other users");
	}

	const body = await req.json().catch(() => ({}));
	const expiresInDays = body.expiresInDays;

	const code = generateCode();
	const id = randomUUIDv7();

	let expiresAt = null;
	if (expiresInDays && typeof expiresInDays === "number" && expiresInDays > 0) {
		const date = new Date();
		date.setDate(date.getDate() + expiresInDays);
		expiresAt = date.toISOString();
	}

	await sql`
		INSERT INTO invites (id, code, created_by, expires_at)
		VALUES (${id}, ${code}, ${userId}, ${expiresAt})
	`;

	const rows = await sql`
		SELECT
			i.id,
			i.code,
			i.created_by,
			i.used_by,
			i.used_at,
			i.expires_at,
			i.created_at,
			u.username as used_by_username
		FROM invites i
		LEFT JOIN users u ON i.used_by = u.id
		WHERE i.id = ${id}
	`;

	return created({ invite: rowToInvite(rows[0]) });
}

export async function remove(
	req: Request,
	_url: URL,
	params?: Record<string, string>,
): Promise<Response> {
	const auth = await getAuthContext(req);
	if (!requireAdmin(auth)) {
		return forbidden("Admin access required");
	}

	const inviteId = params?.id;
	if (!inviteId) {
		return badRequest("Invite ID required");
	}

	const existing = await sql`SELECT id FROM invites WHERE id = ${inviteId}`;
	if (existing.length === 0) {
		return notFound("Invite not found");
	}

	await sql`DELETE FROM invites WHERE id = ${inviteId}`;

	return noContent();
}

export async function validate(req: Request): Promise<Response> {
	const body = await req.json();
	const { code } = body;

	if (!code) {
		return badRequest("Invite code required");
	}

	const rows = await sql`
		SELECT id, code, used_by, expires_at
		FROM invites
		WHERE code = ${code.toUpperCase()}
	`;

	if (rows.length === 0) {
		return ok({ valid: false, error: "Invalid invite code" });
	}

	const invite = rows[0];

	if (invite.used_by) {
		return ok({ valid: false, error: "Invite already used" });
	}

	if (invite.expires_at && new Date(invite.expires_at as string) < new Date()) {
		return ok({ valid: false, error: "Invite expired" });
	}

	return ok({ valid: true, inviteId: invite.id });
}

export async function markUsed(
	req: Request,
	_url: URL,
	params?: Record<string, string>,
): Promise<Response> {
	const inviteId = params?.id;
	if (!inviteId) {
		return badRequest("Invite ID required");
	}

	const body = await req.json();
	const { userId } = body;

	if (!userId) {
		return badRequest("User ID required");
	}

	const result = await sql`
		UPDATE invites
		SET used_by = ${userId}, used_at = NOW()
		WHERE id = ${inviteId} AND used_by IS NULL
		RETURNING id
	`;

	if (result.length === 0) {
		const existing = await sql`SELECT id FROM invites WHERE id = ${inviteId}`;
		if (existing.length === 0) {
			return notFound("Invite not found");
		}
		return badRequest("Invite already used");
	}

	return ok({ message: "Invite marked as used" });
}
