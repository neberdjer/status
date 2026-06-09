import { Echo } from "@atums/echo";
import { SQL } from "bun";
import { runMigrations } from "./migrations";
import { router } from "./router";
import { checksInFlight, initializeCheckers, stopAllCheckers } from "./routes/checks";

const logger = new Echo({ disableFile: true });

const dbUrl = process.env.DATABASE_URL || "postgres://localhost:5432/status";
export const sql = new SQL(dbUrl);

process.on("unhandledRejection", (reason) => {
	logger.error("Unhandled rejection:", reason);
});
process.on("uncaughtException", (err) => {
	logger.error("Uncaught exception:", err);
});

async function waitForDb(maxAttempts = 30): Promise<void> {
	let lastErr: unknown = null;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			await sql`SELECT 1`;
			if (attempt > 1) logger.info(`[DB] Connected after ${attempt} attempts`);
			return;
		} catch (err) {
			lastErr = err;
			const delay = Math.min(500 * attempt, 5000);
			logger.warn(`[DB] Connection attempt ${attempt}/${maxAttempts} failed, retrying in ${delay}ms`);
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}
	throw new Error(`Failed to connect to database after ${maxAttempts} attempts: ${String(lastErr)}`);
}

async function withDbRetry<T>(label: string, fn: () => Promise<T>, maxAttempts = 5): Promise<T> {
	let lastErr: unknown = null;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			return await fn();
		} catch (err) {
			lastErr = err;
			const code = (err as { code?: string } | null)?.code;
			const retriable =
				code === "ERR_POSTGRES_CONNECTION_CLOSED" ||
				code === "ECONNREFUSED" ||
				code === "ECONNRESET";
			if (!retriable || attempt === maxAttempts) throw err;
			const delay = Math.min(500 * attempt, 5000);
			logger.warn(`[DB] ${label} attempt ${attempt}/${maxAttempts} failed (${code}), retrying in ${delay}ms`);
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}
	throw lastErr;
}

await waitForDb();
await withDbRetry("migrations", () => runMigrations(sql));
await withDbRetry("initializeCheckers", () => initializeCheckers());

const apiPort = Number(process.env.API_PORT) || 3001;
const apiHost = process.env.API_HOST || "0.0.0.0";

const server = Bun.serve({
	hostname: apiHost,
	port: apiPort,
	idleTimeout: 255,
	async fetch(req) {
		const url = new URL(req.url);
		const method = req.method;

		if (url.pathname === "/health" || url.pathname === "/healthz") {
			try {
				await sql`SELECT 1`;
				return Response.json(
					{ status: "ok" },
					{ status: 200, headers: { "Cache-Control": "no-store" } },
				);
			} catch (err) {
				logger.error("Health check failed:", err);
				return Response.json(
					{ status: "degraded" },
					{ status: 503, headers: { "Cache-Control": "no-store" } },
				);
			}
		}

		try {
			const response = await router(req, url, method);
			return response;
		} catch (err) {
			logger.error("Request error:", err);
			return Response.json({ error: "Internal server error" }, { status: 500 });
		}
	},
});

logger.info(`API server running on http://${server.hostname}:${server.port}`);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
	if (shuttingDown) return;
	shuttingDown = true;
	logger.info(`Received ${signal}, shutting down...`);

	stopAllCheckers();
	server.stop(false);

	const drainStart = Date.now();
	while (checksInFlight() > 0 && Date.now() - drainStart < 5000) {
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	if (checksInFlight() > 0) {
		logger.warn(`Forcing exit with ${checksInFlight()} checks in flight`);
	}

	try {
		await sql.close({ timeout: 3 });
	} catch (err) {
		logger.warn("Error closing DB:", err);
	}

	logger.info("Shutdown complete");
	process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
