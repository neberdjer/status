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

const API_URLS: string[] = (() => {
	const pinned = env.API_INTERNAL_URL?.trim();
	if (pinned) return [stripTrailingSlash(pinned)];

	const port = env.API_PORT?.trim() || "3001";
	const basePath = stripTrailingSlash(env.API_BASE_PATH?.trim() || "");
	const internal = `http://127.0.0.1:${port}${basePath}`;

	const publicUrl = stripTrailingSlash(publicEnv.PUBLIC_API_URL?.trim() || "");
	return isAbsoluteHttpUrl(publicUrl) && publicUrl !== internal
		? [internal, publicUrl]
		: [internal];
})();

function buildSignal(external?: AbortSignal | null): AbortSignal {
	const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
	return external ? AbortSignal.any([external, timeout]) : timeout;
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

	let response: Response | undefined;
	let url = "";
	const failures: string[] = [];

	for (const base of API_URLS) {
		url = `${base}${path}`;
		try {
			response = await fetch(url, { ...fetchInit, signal: buildSignal(signal) });
			break;
		} catch (err) {
			failures.push(`${url} (${describe(err)})`);
		}
	}

	if (!response) {
		throw new Error(`API unreachable: ${method} ${failures.join(" and ")}`);
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
