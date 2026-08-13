import { clearSession, getSessionId } from "$lib/server";
import * as api from "$lib/server/api";
import type { PageServerLoad } from "./$types";
import { env } from "$env/dynamic/public";
import type { Service, ServiceCheck } from "$lib";

function calculateEmbed(
	services: Service[],
	checks: Record<string, ServiceCheck | null>,
	uptime: Record<string, { uptimePercent: number; totalChecks: number }>,
	siteName: string,
	siteUrl: string,
) {

	if (services.length === 0) {
		return {
			siteName,
			siteUrl,
			title: siteName,
			description: "No services configured",
			status: "unknown" as const,
			color: 0x808080,
			uptimePercent: null,
			servicesUp: 0,
			servicesDown: 0,
			totalServices: 0,
		};
	}

	const servicesUp = services.filter((s) => checks[s.id]?.success).length;
	const servicesDown = services.length - servicesUp;

	const uptimeValues = services
		.map((s) => uptime[s.id])
		.filter((u) => u && u.totalChecks > 0);
	const avgUptime = uptimeValues.length > 0
		? uptimeValues.reduce((sum, u) => sum + u.uptimePercent, 0) / uptimeValues.length
		: null;

	let status: "operational" | "degraded" | "outage" | "unknown";
	let color: number;
	let statusText: string;

	if (servicesDown === 0) {
		status = "operational";
		color = 0x22c55e; // green
		statusText = "All Systems Operational";
	} else if (servicesDown < services.length / 2) {
		status = "degraded";
		color = 0xeab308; // yellow
		statusText = `${servicesDown} Service${servicesDown > 1 ? "s" : ""} Degraded`;
	} else {
		status = "outage";
		color = 0xef4444; // red
		statusText = "Major Outage";
	}

	const uptimeText = avgUptime !== null ? ` | ${avgUptime.toFixed(2)}% uptime` : "";
	const description = `${statusText}${uptimeText} | ${servicesUp}/${services.length} services up`;

	return {
		siteName,
		siteUrl,
		title: siteName,
		description,
		status,
		color,
		uptimePercent: avgUptime !== null ? Math.round(avgUptime * 100) / 100 : null,
		servicesUp,
		servicesDown,
		totalServices: services.length,
	};
}

export const load: PageServerLoad = async ({ cookies }) => {
	const sessionId = getSessionId(cookies);
	const timezone = env.PUBLIC_TIMEZONE || "UTC";

	let siteName = "atums/status";
	let siteUrl = "";

	try {
		const settings = await api.getSettings();
		siteName = settings.siteName || "atums/status";
		siteUrl = settings.siteUrl || "";
	} catch {}

	if (!sessionId) {
		const [services, groups] = await Promise.all([
			api.getPublicServices(),
			api.getGroups(),
		]);
		const serviceIds = services.map((s) => s.id);
		const [checks, uptime] =
			serviceIds.length > 0
				? await Promise.all([
						api.getLatestChecksForServices(serviceIds),
						api.getUptimeForServices(serviceIds),
					])
				: [{}, {}];
		const embed = calculateEmbed(services, checks, uptime, siteName, siteUrl);
		return { user: null, services, checks, groups, uptime, timezone, embed };
	}

	const user = await api.getUserById(sessionId, sessionId);
	if (!user) {
		clearSession(cookies);
		const [services, groups] = await Promise.all([
			api.getPublicServices(),
			api.getGroups(),
		]);
		const serviceIds = services.map((s) => s.id);
		const [checks, uptime] =
			serviceIds.length > 0
				? await Promise.all([
						api.getLatestChecksForServices(serviceIds),
						api.getUptimeForServices(serviceIds),
					])
				: [{}, {}];
		const embed = calculateEmbed(services, checks, uptime, siteName, siteUrl);
		return { user: null, services, checks, groups, uptime, timezone, embed };
	}

	const [services, groups] = await Promise.all([
		api.getServices(sessionId),
		api.getGroups(),
	]);
	const serviceIds = services.map((s) => s.id);
	const [checks, uptime] =
		serviceIds.length > 0
			? await Promise.all([
					api.getLatestChecksForServices(serviceIds),
					api.getUptimeForServices(serviceIds),
				])
			: [{}, {}];

	const publicServices = services.filter((s) => s.isPublic);
	const publicChecks: Record<string, ServiceCheck | null> = {};
	const publicUptime: Record<string, { uptimePercent: number; totalChecks: number }> = {};
	for (const s of publicServices) {
		publicChecks[s.id] = checks[s.id];
		if (uptime[s.id]) publicUptime[s.id] = uptime[s.id];
	}
	const embed = calculateEmbed(publicServices, publicChecks, publicUptime, siteName, siteUrl);

	return { user, services, checks, groups, uptime, timezone, embed };
};

export { statusPageActions as actions } from "$lib/server/actions";
