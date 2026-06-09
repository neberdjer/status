import { spawn } from "node:child_process";

const procs = [
	{ name: "api", cmd: "bun", args: ["run", "src/api/index.ts"] },
	{ name: "web", cmd: "bun", args: ["run", "build/index.js"] },
].map(({ name, cmd, args }) => {
	const child = spawn(cmd, args, { stdio: "inherit" });
	child.on("error", (err) => {
		console.error(`[${name}] failed to spawn:`, err);
		shutdown(1);
	});
	child.on("exit", (code, signal) => {
		console.error(`[${name}] exited (code=${code} signal=${signal})`);
		shutdown(code ?? 1);
	});
	return { name, child };
});

let shuttingDown = false;
function shutdown(code: number): void {
	if (shuttingDown) return;
	shuttingDown = true;
	for (const { child } of procs) {
		if (child.pid && !child.killed) child.kill("SIGTERM");
	}
	setTimeout(() => {
		for (const { child } of procs) {
			if (child.pid && !child.killed) child.kill("SIGKILL");
		}
		process.exit(code);
	}, 5000).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
