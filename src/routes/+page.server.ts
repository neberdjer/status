import { fail } from "@sveltejs/kit";
import { clearSession, getSessionId } from "$lib/server";
import * as api from "$lib/server/api";
import type { Actions, PageServerLoad } from "./$types";
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

export const actions: Actions = {
	delete: async ({ cookies, request, getClientAddress }) => {
		const sessionId = getSessionId(cookies);
		if (!sessionId) return fail(401, { error: "Unauthorized" });

		const user = await api.getUserById(sessionId, sessionId);
		if (!user) {
			clearSession(cookies);
			return fail(401, { error: "Unauthorized" });
		}

		const formData = await request.formData();
		const serviceId = formData.get("id")?.toString();

		if (!serviceId) return fail(400, { error: "Service ID required" });

		await api.stopChecker(serviceId, sessionId);
		await api.deleteService(serviceId, sessionId);
		await api.auditLog(user.id, "delete", "service", serviceId, null, getClientAddress(), sessionId);

		return { success: true };
	},

	check: async ({ cookies, request }) => {
		const sessionId = getSessionId(cookies);
		if (!sessionId) return fail(401, { error: "Unauthorized" });

		const user = await api.getUserById(sessionId, sessionId);
		if (!user) {
			clearSession(cookies);
			return fail(401, { error: "Unauthorized" });
		}

		const formData = await request.formData();
		const serviceId = formData.get("id")?.toString();

		if (!serviceId) return fail(400, { error: "Service ID required" });

		const check = await api.runCheck(serviceId, sessionId);
		return { success: true, check };
	},

	edit: async ({ cookies, request, getClientAddress }) => {
		const sessionId = getSessionId(cookies);
		if (!sessionId) return fail(401, { editError: "Unauthorized" });

		const user = await api.getUserById(sessionId, sessionId);
		if (!user) {
			clearSession(cookies);
			return fail(401, { editError: "Unauthorized" });
		}

		const formData = await request.formData();
		const serviceId = formData.get("id")?.toString();
		const name = formData.get("name")?.toString().trim();
		const url = formData.get("url")?.toString().trim();
		const displayUrl = formData.get("displayUrl")?.toString().trim() || null;
		const description = formData.get("description")?.toString().trim() || null;
		const expectedStatus = Number.parseInt(
			formData.get("expectedStatus")?.toString() || "200",
			10,
		);
		const expectedContentType = formData.get("expectedContentType")?.toString().trim() || null;
		const expectedBody = formData.get("expectedBody")?.toString().trim() || null;
		const checkInterval = Number.parseInt(
			formData.get("checkInterval")?.toString() || "60",
			10,
		);
		const enabled = formData.get("enabled") === "on";
		const isPublic = formData.get("isPublic") === "on";
		const emailNotifications = formData.get("emailNotifications") === "on";
		const groupName = formData.get("groupName")?.toString().trim() || null;

		if (!serviceId) return fail(400, { editError: "Service ID required" });
		if (!name) return fail(400, { editError: "Name is required", editServiceId: serviceId });
		if (!url) return fail(400, { editError: "URL is required", editServiceId: serviceId });

		try {
			new URL(url);
		} catch {
			return fail(400, { editError: "Invalid URL format", editServiceId: serviceId });
		}

		if (Number.isNaN(expectedStatus) || expectedStatus < 100 || expectedStatus > 599) {
			return fail(400, { editError: "Expected status must be a valid HTTP status code", editServiceId: serviceId });
		}

		if (Number.isNaN(checkInterval) || checkInterval < 10 || checkInterval > 3600) {
			return fail(400, { editError: "Check interval must be between 10 and 3600 seconds", editServiceId: serviceId });
		}

		try {
			await api.updateService(serviceId, {
				name,
				url,
				displayUrl,
				description,
				expectedStatus,
				expectedContentType,
				expectedBody,
				checkInterval,
				enabled,
				isPublic,
				emailNotifications,
				groupName,
			}, sessionId);
		} catch (err) {
			return fail(500, { editError: err instanceof Error ? err.message : "Failed to update service", editServiceId: serviceId });
		}

		await api.stopChecker(serviceId, sessionId);
		await api.auditLog(user.id, "update", "service", serviceId, { name, url, enabled, isPublic }, getClientAddress(), sessionId);

		if (enabled) {
			await api.startChecker(serviceId, sessionId);
		}

		return { success: true, edited: true };
	},

	create: async ({ cookies, request, getClientAddress }) => {
		const sessionId = getSessionId(cookies);
		if (!sessionId) return fail(401, { createError: "Unauthorized" });

		const user = await api.getUserById(sessionId, sessionId);
		if (!user) {
			clearSession(cookies);
			return fail(401, { createError: "Unauthorized" });
		}

		const formData = await request.formData();
		const name = formData.get("name")?.toString().trim();
		const url = formData.get("url")?.toString().trim();
		const displayUrl = formData.get("displayUrl")?.toString().trim() || null;
		const description = formData.get("description")?.toString().trim() || null;
		const expectedStatus = Number.parseInt(
			formData.get("expectedStatus")?.toString() || "200",
			10,
		);
		const expectedContentType = formData.get("expectedContentType")?.toString().trim() || null;
		const expectedBody = formData.get("expectedBody")?.toString().trim() || null;
		const checkInterval = Number.parseInt(
			formData.get("checkInterval")?.toString() || "60",
			10,
		);
		const enabled = formData.get("enabled") === "on";
		const isPublic = formData.get("isPublic") === "on";
		const emailNotifications = formData.get("emailNotifications") === "on";
		const groupName = formData.get("groupName")?.toString().trim() || null;

		if (!name) return fail(400, { createError: "Name is required" });
		if (!url) return fail(400, { createError: "URL is required" });

		try {
			new URL(url);
		} catch {
			return fail(400, { createError: "Invalid URL format" });
		}

		try {
			const service = await api.createService(name, url, sessionId, {
				description: description || undefined,
				displayUrl,
				expectedStatus,
				expectedContentType,
				expectedBody,
				checkInterval,
				enabled,
				isPublic,
				emailNotifications,
				groupName,
			});
			await api.auditLog(user.id, "create", "service", service.id, { name, url, enabled, isPublic }, getClientAddress(), sessionId);

			if (enabled) {
				await api.startChecker(service.id, sessionId);
			}

			return { success: true, created: true };
		} catch (err) {
			console.error("Create service error:", err);
			return fail(500, { createError: err instanceof Error ? err.message : "Failed to create service" });
		}
	},

	updatePositions: async ({ cookies, request }) => {
		const sessionId = getSessionId(cookies);
		if (!sessionId) return fail(401, { error: "Unauthorized" });

		const user = await api.getUserById(sessionId, sessionId);
		if (!user) {
			clearSession(cookies);
			return fail(401, { error: "Unauthorized" });
		}

		const formData = await request.formData();
		const positionsJson = formData.get("positions")?.toString();

		if (!positionsJson) return fail(400, { error: "Positions required" });

		try {
			const positions = JSON.parse(positionsJson);
			await api.updateServicePositions(positions, sessionId);
			return { success: true };
		} catch {
			return fail(400, { error: "Invalid positions data" });
		}
	},

	updateGroupPositions: async ({ cookies, request }) => {
		const sessionId = getSessionId(cookies);
		if (!sessionId) return fail(401, { error: "Unauthorized" });

		const user = await api.getUserById(sessionId, sessionId);
		if (!user) {
			clearSession(cookies);
			return fail(401, { error: "Unauthorized" });
		}

		const formData = await request.formData();
		const positionsJson = formData.get("positions")?.toString();

		if (!positionsJson) return fail(400, { error: "Positions required" });

		try {
			const positions = JSON.parse(positionsJson);
			await api.updateGroupPositions(positions, sessionId);
			return { success: true };
		} catch {
			return fail(400, { error: "Invalid positions data" });
		}
	},

	renameGroup: async ({ cookies, request, getClientAddress }) => {
		const sessionId = getSessionId(cookies);
		if (!sessionId) return fail(401, { renameError: "Unauthorized" });

		const user = await api.getUserById(sessionId, sessionId);
		if (!user) {
			clearSession(cookies);
			return fail(401, { renameError: "Unauthorized" });
		}

		const formData = await request.formData();
		const oldName = formData.get("oldName")?.toString().trim();
		const newName = formData.get("newName")?.toString().trim();

		if (!oldName || !newName) {
			return fail(400, { renameError: "Group name is required" });
		}

		try {
			await api.renameGroup(oldName, newName, sessionId);
			await api.auditLog(user.id, "update", "group", oldName, { oldName, newName }, getClientAddress(), sessionId);
			return { success: true, renamed: true };
		} catch (err) {
			return fail(400, { renameError: err instanceof Error ? err.message : "Failed to rename group" });
		}
	},

	deleteGroup: async ({ cookies, request, getClientAddress }) => {
		const sessionId = getSessionId(cookies);
		if (!sessionId) return fail(401, { error: "Unauthorized" });

		const user = await api.getUserById(sessionId, sessionId);
		if (!user) {
			clearSession(cookies);
			return fail(401, { error: "Unauthorized" });
		}

		const formData = await request.formData();
		const name = formData.get("name")?.toString().trim();

		if (!name) {
			return fail(400, { error: "Group name is required" });
		}

		try {
			await api.deleteGroup(name, sessionId);
			await api.auditLog(user.id, "delete", "group", name, null, getClientAddress(), sessionId);
			return { success: true, deleted: true };
		} catch (err) {
			return fail(400, { error: err instanceof Error ? err.message : "Failed to delete group" });
		}
	},

	setGroupParent: async ({ cookies, request, getClientAddress }) => {
		const sessionId = getSessionId(cookies);
		if (!sessionId) return fail(401, { error: "Unauthorized" });

		const user = await api.getUserById(sessionId, sessionId);
		if (!user) {
			clearSession(cookies);
			return fail(401, { error: "Unauthorized" });
		}

		const formData = await request.formData();
		const name = formData.get("name")?.toString().trim();
		const parentGroupName = formData.get("parentGroupName")?.toString().trim() || null;

		if (!name) {
			return fail(400, { error: "Group name is required" });
		}

		try {
			await api.upsertGroup(name, undefined, parentGroupName, sessionId);
			await api.auditLog(user.id, "update", "group", name, { parentGroupName }, getClientAddress(), sessionId);
			return { success: true };
		} catch (err) {
			return fail(400, { error: err instanceof Error ? err.message : "Failed to set group parent" });
		}
	},

	toggleGroupEmail: async ({ cookies, request, getClientAddress }) => {
		const sessionId = getSessionId(cookies);
		if (!sessionId) return fail(401, { error: "Unauthorized" });

		const user = await api.getUserById(sessionId, sessionId);
		if (!user) {
			clearSession(cookies);
			return fail(401, { error: "Unauthorized" });
		}

		if (user.role !== "admin") {
			return fail(403, { error: "Admin access required" });
		}

		const formData = await request.formData();
		const name = formData.get("name")?.toString().trim();
		const emailNotifications = formData.get("emailNotifications")?.toString() === "true";

		if (!name) {
			return fail(400, { error: "Group name is required" });
		}

		try {
			await api.updateGroupEmail(name, emailNotifications, sessionId);
			await api.auditLog(user.id, "update", "group", name, { emailNotifications }, getClientAddress(), sessionId);
			return { success: true };
		} catch (err) {
			return fail(400, { error: err instanceof Error ? err.message : "Failed to update group email" });
		}
	},

	createGroup: async ({ cookies, request, getClientAddress }) => {
		const sessionId = getSessionId(cookies);
		if (!sessionId) return fail(401, { error: "Unauthorized" });

		const user = await api.getUserById(sessionId, sessionId);
		if (!user) {
			clearSession(cookies);
			return fail(401, { error: "Unauthorized" });
		}

		if (user.role !== "admin") {
			return fail(403, { error: "Admin access required" });
		}

		const formData = await request.formData();
		const name = formData.get("name")?.toString().trim();
		const parentGroupName = formData.get("parentGroupName")?.toString().trim() || null;

		if (!name) {
			return fail(400, { error: "Group name is required" });
		}

		try {
			await api.upsertGroup(name, undefined, parentGroupName, sessionId);
			await api.auditLog(user.id, "create", "group", name, { parentGroupName }, getClientAddress(), sessionId);
			return { success: true };
		} catch (err) {
			return fail(400, { error: err instanceof Error ? err.message : "Failed to create group" });
		}
	},
};
