import { CryptoHasher, file, Glob } from "bun";
import { resolve } from "node:path";
import { Echo } from "@atums/echo";
import type { SQL } from "bun";
import type { SqlMigration } from "../types";

const logger = new Echo({ disableFile: true });
const migrationsPath = resolve("src", "database", "migrations");

export async function runMigrations(sql: SQL): Promise<void> {
	const migrations: SqlMigration[] = [];

	try {
		const upPath = resolve(migrationsPath, "up");
		const downPath = resolve(migrationsPath, "down");

		const glob = new Glob("*.sql");
		const sqlFiles = Array.from(glob.scanSync(upPath)).sort();

		for (const sqlFile of sqlFiles) {
			const baseName = sqlFile.replace(".sql", "");
			const parts = baseName.split("_");
			const id = parts[0];
			const name = parts.slice(1).join("_") || "migration";

			if (!id || id.trim() === "") continue;

			const upSql = await file(resolve(upPath, sqlFile)).text();
			let downSql: string | undefined;

			try {
				const downGlob = new Glob(`${id}_*.sql`);
				const downFiles = Array.from(downGlob.scanSync(downPath));
				if (downFiles.length > 0) {
					downSql = await file(resolve(downPath, downFiles[0])).text();
				}
			} catch {}

			migrations.push({
				id,
				name,
				upSql: upSql.trim(),
				...(downSql && { downSql: downSql.trim() }),
			});
		}

		logger.debug(`Loaded ${migrations.length} migrations`);
	} catch {
		logger.debug("No migrations directory found");
		return;
	}

	if (migrations.length === 0) return;

	await sql.unsafe(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			id TEXT PRIMARY KEY,
			name TEXT,
			executed_at TIMESTAMPTZ DEFAULT NOW(),
			checksum TEXT
		)
	`);

	const ADVISORY_LOCK_KEY = 4242891337;

	await sql.begin(async (tx) => {
		await tx`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_KEY})`;

		const executed = await tx`SELECT id FROM schema_migrations`;
		const executedIds = new Set(executed.map((r: { id: string }) => r.id));

		const pending = migrations.filter((m) => !executedIds.has(m.id));
		if (pending.length === 0) {
			logger.debug("All migrations are up to date");
			return;
		}

		logger.info(`Running ${pending.length} pending migrations...`);

		for (const migration of pending) {
			logger.debug(`Running migration: ${migration.id} - ${migration.name}`);
			const checksum = generateChecksum(migration.upSql);
			await tx.unsafe(migration.upSql);
			await tx`
				INSERT INTO schema_migrations (id, name, checksum)
				VALUES (${migration.id}, ${migration.name}, ${checksum})
			`;
			logger.debug(`Migration ${migration.id} completed`);
		}

		logger.info("All migrations completed successfully");
	});
}

function generateChecksum(input: string): string {
	return new CryptoHasher("sha256").update(input).digest("hex");
}
