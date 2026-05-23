import { CryptoHasher, randomUUIDv7 } from "bun";
import { sql } from "../index";
import type { ApiKey, ApiKeyScope } from "../../types";
import { getAuthContext, requireAuth } from "../utils/auth";
import { ok, created, badRequest, unauthorized, forbidden, notFound } from "../utils/response";

function generateApiKey(): string {
	return `sk_${randomUUIDv7()}`;
}

function hashKey(key: string): string {
	return new CryptoHasher("sha256").update(key).digest("hex");
}

function rowToApiKey(row: Record<string, unknown>): ApiKey {
	return {
		id: row.id as string,
		userId: row.user_id as string,
		name: row.name as string,
		keyPrefix: row.key_prefix as string,
		scopes: (row.scopes as ApiKeyScope[]) || [],
		lastUsedAt: row.last_used_at as string | null,
		expiresAt: row.expires_at as string | null,
		createdAt: row.created_at as string,
	};
}

export async function list(req: Request): Promise<Response> {
	const auth = await getAuthContext(req);
	if (!requireAuth(auth)) {
		return unauthorized();
	}

	const rows = await sql`
		SELECT id, user_id, name, key_prefix, scopes, last_used_at, expires_at, created_at
		FROM api_keys
		WHERE user_id = ${auth.user.id}
		ORDER BY created_at DESC
	`;

	return ok({ apiKeys: rows.map(rowToApiKey) });
}

export async function create(req: Request): Promise<Response> {
	const auth = await getAuthContext(req);
	if (!requireAuth(auth)) {
		return unauthorized();
	}

	const body = await req.json();
	const { name, scopes, expiresAt } = body;

	if (!name || typeof name !== "string" || name.trim().length === 0) {
		return badRequest("Name is required");
	}

	if (!scopes || !Array.isArray(scopes) || scopes.length === 0) {
		return badRequest("At least one scope is required");
	}

	const id = randomUUIDv7();
	const key = generateApiKey();
	const keyHash = hashKey(key);
	const keyPrefix = key.substring(0, 7) + "...";
	const scopesArray = `{${scopes.map((s: string) => `"${s.replace(/"/g, '\\"')}"`).join(",")}}`;

	await sql`
		INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, scopes, expires_at)
		VALUES (${id}, ${auth.user.id}, ${name.trim()}, ${keyHash}, ${keyPrefix}, ${scopesArray}::text[], ${expiresAt || null})
	`;

	const rows = await sql`
		SELECT id, user_id, name, key_prefix, scopes, last_used_at, expires_at, created_at
		FROM api_keys
		WHERE id = ${id}
	`;

	return created({
		apiKey: rowToApiKey(rows[0]),
		key,
	});
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
		return badRequest("API key ID required");
	}

	const existing = await sql`
		SELECT user_id FROM api_keys WHERE id = ${id}
	`;

	if (existing.length === 0) {
		return notFound("API key not found");
	}

	if (existing[0].user_id !== auth.user.id && !auth.isAdmin) {
		return forbidden("Cannot update this API key");
	}

	const body = await req.json();
	const { name, scopes, expiresAt } = body;

	if (name !== undefined && (typeof name !== "string" || name.trim().length === 0)) {
		return badRequest("Name cannot be empty");
	}

	if (scopes !== undefined && (!Array.isArray(scopes) || scopes.length === 0)) {
		return badRequest("At least one scope is required");
	}

	if (name !== undefined) {
		await sql`UPDATE api_keys SET name = ${name.trim()} WHERE id = ${id}`;
	}

	if (scopes !== undefined) {
		const scopesArray = `{${scopes.map((s: string) => `"${s.replace(/"/g, '\\"')}"`).join(",")}}`;
		await sql`UPDATE api_keys SET scopes = ${scopesArray}::text[] WHERE id = ${id}`;
	}

	if (expiresAt !== undefined) {
		await sql`UPDATE api_keys SET expires_at = ${expiresAt} WHERE id = ${id}`;
	}

	const rows = await sql`
		SELECT id, user_id, name, key_prefix, scopes, last_used_at, expires_at, created_at
		FROM api_keys
		WHERE id = ${id}
	`;

	return ok({ apiKey: rowToApiKey(rows[0]) });
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
		return badRequest("API key ID required");
	}

	const existing = await sql`
		SELECT user_id FROM api_keys WHERE id = ${id}
	`;

	if (existing.length === 0) {
		return notFound("API key not found");
	}

	if (existing[0].user_id !== auth.user.id && !auth.isAdmin) {
		return forbidden("Cannot delete this API key");
	}

	await sql`DELETE FROM api_keys WHERE id = ${id}`;

	return ok({ message: "API key deleted" });
}

export async function validateApiKey(
	key: string,
): Promise<{ valid: boolean; userId?: string; scopes?: ApiKeyScope[]; keyId?: string }> {
	if (!key || !key.startsWith("sk_")) {
		return { valid: false };
	}

	const keyHash = hashKey(key);

	const rows = await sql`
		UPDATE api_keys
		SET last_used_at = NOW()
		WHERE key_hash = ${keyHash}
		  AND (expires_at IS NULL OR expires_at > NOW())
		RETURNING id, user_id, scopes
	`;

	if (rows.length === 0) {
		return { valid: false };
	}

	const apiKey = rows[0];

	return {
		valid: true,
		userId: apiKey.user_id as string,
		scopes: apiKey.scopes as ApiKeyScope[],
		keyId: apiKey.id as string,
	};
}

export function hasScope(scopes: ApiKeyScope[], required: ApiKeyScope): boolean {
	return scopes.includes(required);
}

export function hasAnyScope(scopes: ApiKeyScope[], required: ApiKeyScope[]): boolean {
	return required.some((scope) => scopes.includes(scope));
}
