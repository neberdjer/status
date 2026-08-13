import { env } from "$env/dynamic/private";
import { env as publicEnv } from "$env/dynamic/public";
import type { ApiResponse, RequestOptions } from "../../../types";

const REQUEST_TIMEOUT_MS = Number(env.API_INTERNAL_TIMEOUT_MS) || 30000;

function stripTrailingSlash(value: string): string {
	return value.replace(/\/+$/, "");
}

function isAbsoluteHttpUrl(value: string): boolean {
	try {
		const parsed = new URL(value);
		return parsed.protocol === "http:" || parsed.protocol === "https:";
	} catch {
		return false;
	}
}

function resolveInternalUrl(): string {
	const explicit = env.API_INTERNAL_URL?.trim();
	if (explicit) return stripTrailingSlash(explicit);

	const port = env.API_PORT?.trim() || "3001";
	const basePath = stripTrailingSlash(env.API_BASE_PATH?.trim() || "");
	return `http://127.0.0.1:${port}${basePath}`;
}

function resolveFallbackUrl(internalUrl: string): string | null {
	if (env.API_INTERNAL_URL?.trim()) return null;

	const publicUrl = stripTrailingSlash(publicEnv.PUBLIC_API_URL?.trim() || "");
	if (!publicUrl || !isAbsoluteHttpUrl(publicUrl)) return null;
	if (publicUrl === internalUrl) return null;

	return publicUrl;
}

const INTERNAL_URL = resolveInternalUrl();
const FALLBACK_URL = resolveFallbackUrl(INTERNAL_URL);

function buildSignal(external?: AbortSignal | null): AbortSignal {
	const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
	if (!external) return timeout;
	return AbortSignal.any([external, timeout]);
}

function describe(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

export async function request<T>(path: string, options?: RequestOptions): Promise<T> {
	const { sessionId, headers: extraHeaders, signal, ...init } = options ?? {};

	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};

	if (sessionId) {
		headers["Cookie"] = `session=${sessionId}`;
	}

	const method = init.method || "GET";
	const fetchInit: RequestInit = {
		...init,
		headers: {
			...headers,
			...extraHeaders,
		},
	};

	let url = `${INTERNAL_URL}${path}`;
	let response: Response;

	try {
		response = await fetch(url, { ...fetchInit, signal: buildSignal(signal) });
	} catch (err) {
		if (!FALLBACK_URL) {
			throw new Error(`API unreachable: ${method} ${url} (${describe(err)})`);
		}

		const internalError = describe(err);
		url = `${FALLBACK_URL}${path}`;

		try {
			response = await fetch(url, { ...fetchInit, signal: buildSignal(signal) });
		} catch (fallbackErr) {
			throw new Error(
				`API unreachable: ${method} ${INTERNAL_URL}${path} (${internalError}) and ${url} (${describe(fallbackErr)})`,
			);
		}
	}

	if (response.status === 204) {
		return undefined as T;
	}

	const raw = await response.text();

	if (!raw.trim()) {
		if (response.ok) return undefined as T;
		throw new Error(`API error: ${method} ${url} returned ${response.status} with an empty body`);
	}

	let body: ApiResponse<T>;
	try {
		body = JSON.parse(raw);
	} catch {
		const contentType = response.headers.get("content-type") || "unknown";
		const snippet = raw.slice(0, 200).replace(/\s+/g, " ").trim();
		throw new Error(
			`API returned non-JSON response: ${method} ${url} -> ${response.status} (content-type: ${contentType}): ${snippet}`,
		);
	}

	if (!response.ok || !body.success) {
		throw new Error(body.error || `API error: ${method} ${url} returned ${response.status}`);
	}

	return body.data as T;
}
