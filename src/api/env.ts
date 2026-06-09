export interface ResolvedEnv {
	databaseUrl: string;
	apiHost: string;
	apiPort: number;
	apiBasePath: string;
}

function parsePort(raw: string | undefined, name: string, errors: string[], fallback: number): number {
	if (raw === undefined || raw === "") return fallback;
	const parsed = Number(raw);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
		errors.push(`${name} must be an integer between 1 and 65535, got: ${raw}`);
		return fallback;
	}
	return parsed;
}

export function loadEnv(): ResolvedEnv {
	const errors: string[] = [];

	const databaseUrl = process.env.DATABASE_URL?.trim() || "";
	if (!databaseUrl) {
		errors.push("DATABASE_URL is required (e.g. postgres://user:pass@host:5432/db)");
	} else if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
		errors.push(`DATABASE_URL must start with "postgres://" or "postgresql://", got: ${databaseUrl.split(":")[0]}://...`);
	} else {
		try {
			new URL(databaseUrl);
		} catch {
			errors.push(`DATABASE_URL is not a valid URL: ${databaseUrl}`);
		}
	}

	const apiHost = process.env.API_HOST?.trim() || "0.0.0.0";
	const apiPort = parsePort(process.env.API_PORT, "API_PORT", errors, 3001);

	const apiBasePathRaw = process.env.API_BASE_PATH?.trim() || "";
	let apiBasePath = apiBasePathRaw;
	if (apiBasePathRaw && !apiBasePathRaw.startsWith("/")) {
		errors.push(`API_BASE_PATH must start with "/" if set, got: ${apiBasePathRaw}`);
	}
	if (apiBasePathRaw.endsWith("/") && apiBasePathRaw !== "/") {
		apiBasePath = apiBasePathRaw.replace(/\/+$/, "");
	}

	if (errors.length > 0) {
		console.error("Environment validation failed:");
		for (const err of errors) console.error(`  - ${err}`);
		console.error("See .env.example for the expected configuration.");
		process.exit(1);
	}

	return { databaseUrl, apiHost, apiPort, apiBasePath };
}

export const env: ResolvedEnv = loadEnv();
