import { fail, redirect } from "@sveltejs/kit";
import { clearSession, getSessionId } from "$lib/server";
import * as api from "$lib/server/api";
import type { Actions, PageServerLoad } from "./$types";
import type { AuditLog, Invite, SiteSettings, Webhook } from "$lib";

export const load: PageServerLoad = async ({ cookies }) => {
	const sessionId = getSessionId(cookies);
	if (!sessionId) {
		redirect(302, "/login");
	}

	const user = await api.getUserById(sessionId, sessionId);
	if (!user) {
		clearSession(cookies);
		redirect(302, "/login");
	}

	let invites: Invite[] = [];
	let events: Awaited<ReturnType<typeof api.getEvents>> = [];
	let groups: Awaited<ReturnType<typeof api.getGroups>> = [];
	let auditLogs: AuditLog[] = [];
	let siteSettings: SiteSettings | null = null;
	let webhooks: Webhook[] = [];

	if (user.role === "admin") {
		[invites, events, groups, auditLogs, siteSettings, webhooks] = await Promise.all([
			api.getInvites(user.id, sessionId).catch(() => []),
			api.getEvents({ limit: 20 }).catch(() => []),
			api.getGroups().catch(() => []),
			api.getAuditLogs({ limit: 50, sessionId }).catch(() => []),
			api.getSettings().catch(() => null),
			api.getWebhooks(sessionId).catch(() => []),
		]);
	}

	return { user, invites, events, groups, auditLogs, siteSettings, webhooks };
};

export const actions: Actions = {
	password: async ({ request, cookies, getClientAddress }) => {
		const sessionId = getSessionId(cookies);
		if (!sessionId) {
			redirect(302, "/login");
		}

		const data = await request.formData();
		const currentPassword = data.get("currentPassword")?.toString();
		const newPassword = data.get("newPassword")?.toString();
		const confirmPassword = data.get("confirmPassword")?.toString();

		if (!currentPassword || !newPassword || !confirmPassword) {
			return fail(400, { error: "all fields are required" });
		}

		if (newPassword !== confirmPassword) {
			return fail(400, { error: "passwords do not match" });
		}

		if (newPassword.length < 8) {
			return fail(400, { error: "password must be at least 8 characters" });
		}

		try {
			await api.changePassword(sessionId, currentPassword, newPassword, sessionId);
			await api.auditLog(sessionId, "update", "password", sessionId, null, getClientAddress(), sessionId);
			return { success: "password updated" };
		} catch (err) {
			return fail(400, {
				error: err instanceof Error ? err.message : "failed to update password",
			});
		}
	},

	createInvite: async ({ cookies, getClientAddress }) => {
		const sessionId = getSessionId(cookies);
		if (!sessionId) {
			redirect(302, "/login");
		}

		const user = await api.getUserById(sessionId, sessionId);
		if (!user || user.role !== "admin") {
			return fail(403, { inviteError: "not authorized" });
		}

		try {
			const invite = await api.createInvite(user.id, undefined, sessionId);
			await api.auditLog(user.id, "create", "invite", invite.id, { code: invite.code }, getClientAddress(), sessionId);
			return { inviteSuccess: "invite created" };
		} catch (err) {
			return fail(400, {
				inviteError: err instanceof Error ? err.message : "failed to create invite",
			});
		}
	},

	deleteInvite: async ({ request, cookies, getClientAddress }) => {
		const sessionId = getSessionId(cookies);
		if (!sessionId) {
			redirect(302, "/login");
		}

		const user = await api.getUserById(sessionId, sessionId);
		if (!user || user.role !== "admin") {
			return fail(403, { inviteError: "not authorized" });
		}

		const data = await request.formData();
		const inviteId = data.get("inviteId")?.toString();

		if (!inviteId) {
			return fail(400, { inviteError: "invite id required" });
		}

		try {
			await api.deleteInvite(inviteId, sessionId);
			await api.auditLog(user.id, "delete", "invite", inviteId, null, getClientAddress(), sessionId);
			return { inviteSuccess: "invite deleted" };
		} catch (err) {
			return fail(400, {
				inviteError: err instanceof Error ? err.message : "failed to delete invite",
			});
		}
	},

	logout: async ({ cookies }) => {
		clearSession(cookies);
		redirect(302, "/login");
	},

	createEvent: async ({ request, cookies, getClientAddress }) => {
		const sessionId = getSessionId(cookies);
		if (!sessionId) {
			redirect(302, "/login");
		}

		const user = await api.getUserById(sessionId, sessionId);
		if (!user || user.role !== "admin") {
			return fail(403, { eventError: "not authorized" });
		}

		const data = await request.formData();
		const title = data.get("title")?.toString().trim();
		const description = data.get("description")?.toString().trim() || undefined;
		const type = data.get("type")?.toString() || "incident";
		const status = data.get("status")?.toString() || "ongoing";
		const groupName = data.get("groupName")?.toString() || null;

		if (!title) {
			return fail(400, { eventError: "title is required" });
		}

		try {
			const event = await api.createEvent({
				title,
				description,
				type,
				status,
				groupName: groupName || null,
			}, sessionId);
			await api.auditLog(user.id, "create", "event", event.id, { title, type, status, groupName }, getClientAddress(), sessionId);
			return { eventSuccess: "event created" };
		} catch (err) {
			return fail(400, {
				eventError: err instanceof Error ? err.message : "failed to create event",
			});
		}
	},

	resolveEvent: async ({ request, cookies, getClientAddress }) => {
		const sessionId = getSessionId(cookies);
		if (!sessionId) {
			redirect(302, "/login");
		}

		const user = await api.getUserById(sessionId, sessionId);
		if (!user || user.role !== "admin") {
			return fail(403, { eventError: "not authorized" });
		}

		const data = await request.formData();
		const eventId = data.get("eventId")?.toString();

		if (!eventId) {
			return fail(400, { eventError: "event id required" });
		}

		try {
			await api.resolveEvent(eventId, sessionId);
			await api.auditLog(user.id, "resolve", "event", eventId, null, getClientAddress(), sessionId);
			return { eventSuccess: "event resolved" };
		} catch (err) {
			return fail(400, {
				eventError: err instanceof Error ? err.message : "failed to resolve event",
			});
		}
	},

	deleteEvent: async ({ request, cookies, getClientAddress }) => {
		const sessionId = getSessionId(cookies);
		if (!sessionId) {
			redirect(302, "/login");
		}

		const user = await api.getUserById(sessionId, sessionId);
		if (!user || user.role !== "admin") {
			return fail(403, { eventError: "not authorized" });
		}

		const data = await request.formData();
		const eventId = data.get("eventId")?.toString();

		if (!eventId) {
			return fail(400, { eventError: "event id required" });
		}

		try {
			await api.deleteEvent(eventId, sessionId);
			await api.auditLog(user.id, "delete", "event", eventId, null, getClientAddress(), sessionId);
			return { eventSuccess: "event deleted" };
		} catch (err) {
			return fail(400, {
				eventError: err instanceof Error ? err.message : "failed to delete event",
			});
		}
	},

	updateSiteSettings: async ({ request, cookies, getClientAddress }) => {
		const sessionId = getSessionId(cookies);
		if (!sessionId) {
			redirect(302, "/login");
		}

		const user = await api.getUserById(sessionId, sessionId);
		if (!user || user.role !== "admin") {
			return fail(403, { siteError: "not authorized" });
		}

		const data = await request.formData();
		const settings: Record<string, string | boolean | string[] | number> = {};

		if (data.has("siteName")) settings.siteName = data.get("siteName")?.toString() || "";
		if (data.has("siteIcon")) settings.siteIcon = data.get("siteIcon")?.toString() || "";
		if (data.has("siteUrl")) settings.siteUrl = data.get("siteUrl")?.toString() || "";
		if (data.has("sourceUrl")) settings.sourceUrl = data.get("sourceUrl")?.toString() || "";
		if (data.has("discordUrl")) settings.discordUrl = data.get("discordUrl")?.toString() || "";
		if (data.has("securityContact")) settings.securityContact = data.get("securityContact")?.toString() || "";
		if (data.has("securityCanonical")) settings.securityCanonical = data.get("securityCanonical")?.toString() || "";
		if (data.has("smtpHost")) settings.smtpHost = data.get("smtpHost")?.toString() || "";
		if (data.has("smtpPort")) settings.smtpPort = data.get("smtpPort")?.toString() || "587";
		if (data.has("smtpUser")) settings.smtpUser = data.get("smtpUser")?.toString() || "";
		if (data.has("smtpPass")) settings.smtpPass = data.get("smtpPass")?.toString() || "";
		if (data.has("smtpFrom")) settings.smtpFrom = data.get("smtpFrom")?.toString() || "";
		if (data.has("smtpSecure") || data.has("smtpEnabled")) {
			settings.smtpSecure = data.get("smtpSecure") === "on";
			settings.smtpEnabled = data.get("smtpEnabled") === "on";
		}
		if (data.has("emailIsGlobal")) {
			settings.emailIsGlobal = data.get("emailIsGlobal")?.toString() === "true";
		}
		if (data.has("emailGroups")) {
			const emailGroupsJson = data.get("emailGroups")?.toString() || "[]";
			try {
				settings.emailGroups = JSON.parse(emailGroupsJson);
			} catch {
				settings.emailGroups = [];
			}
		}
		if (data.has("retryCount")) {
			settings.retryCount = Number.parseInt(data.get("retryCount")?.toString() || "0", 10);
		}
		if (data.has("checkUserAgent")) {
			settings.checkUserAgent = data.get("checkUserAgent")?.toString().trim() || "";
		}
		if (data.has("emailTo")) settings.emailTo = data.get("emailTo")?.toString() || "";

		try {
			await api.updateSettings(settings, sessionId);
			const { smtpPass: _, ...safeSettings } = settings;
			await api.auditLog(user.id, "update", "settings", "site", safeSettings, getClientAddress(), sessionId);
			return { siteSuccess: "settings updated" };
		} catch (err) {
			return fail(400, {
				siteError: err instanceof Error ? err.message : "failed to update settings",
			});
		}
	},

	createWebhook: async ({ request, cookies, getClientAddress }) => {
		const sessionId = getSessionId(cookies);
		if (!sessionId) {
			redirect(302, "/login");
		}

		const user = await api.getUserById(sessionId, sessionId);
		if (!user || user.role !== "admin") {
			return fail(403, { webhookError: "not authorized" });
		}

		const data = await request.formData();
		const name = data.get("name")?.toString().trim();
		const url = data.get("url")?.toString().trim();
		const type = data.get("type")?.toString() as "discord" | "webhook";
		const isGlobal = data.get("isGlobal")?.toString() === "true";
		const groupsJson = data.get("groups")?.toString() || "[]";
		let groups: string[] = [];
		try {
			groups = JSON.parse(groupsJson);
		} catch {
			groups = [];
		}
		const messageDown = data.get("messageDown")?.toString().trim() || "{service} is down";
		const messageUp = data.get("messageUp")?.toString().trim() || "{service} is back up";
		const avatarUrl = type === "discord" ? (data.get("avatarUrl")?.toString().trim() || null) : null;

		if (!name) {
			return fail(400, { webhookError: "name is required" });
		}
		if (!url) {
			return fail(400, { webhookError: "url is required" });
		}

		try {
			const webhook = await api.createWebhook({ name, url, type, isGlobal, groups, messageDown, messageUp, avatarUrl }, sessionId);
			await api.auditLog(user.id, "create", "webhook", webhook.id, { name, type, isGlobal, groups }, getClientAddress(), sessionId);
			return { webhookSuccess: "webhook created" };
		} catch (err) {
			return fail(400, {
				webhookError: err instanceof Error ? err.message : "failed to create webhook",
			});
		}
	},

	toggleWebhook: async ({ request, cookies, getClientAddress }) => {
		const sessionId = getSessionId(cookies);
		if (!sessionId) {
			redirect(302, "/login");
		}

		const user = await api.getUserById(sessionId, sessionId);
		if (!user || user.role !== "admin") {
			return fail(403, { webhookError: "not authorized" });
		}

		const data = await request.formData();
		const webhookId = data.get("webhookId")?.toString();
		const enabled = data.get("enabled")?.toString() === "true";

		if (!webhookId) {
			return fail(400, { webhookError: "webhook id required" });
		}

		try {
			await api.updateWebhook(webhookId, { enabled }, sessionId);
			await api.auditLog(user.id, "update", "webhook", webhookId, { enabled }, getClientAddress(), sessionId);
			return { webhookSuccess: enabled ? "webhook enabled" : "webhook disabled" };
		} catch (err) {
			return fail(400, {
				webhookError: err instanceof Error ? err.message : "failed to update webhook",
			});
		}
	},

	updateWebhook: async ({ request, cookies, getClientAddress }) => {
		const sessionId = getSessionId(cookies);
		if (!sessionId) {
			redirect(302, "/login");
		}

		const user = await api.getUserById(sessionId, sessionId);
		if (!user || user.role !== "admin") {
			return fail(403, { webhookError: "not authorized" });
		}

		const data = await request.formData();
		const webhookId = data.get("webhookId")?.toString();
		const name = data.get("name")?.toString().trim();
		const url = data.get("url")?.toString().trim();
		const type = data.get("type")?.toString() as "discord" | "webhook";
		const isGlobal = data.get("isGlobal")?.toString() === "true";
		const groupsJson = data.get("groups")?.toString() || "[]";
		let groups: string[] = [];
		try {
			groups = JSON.parse(groupsJson);
		} catch {
			groups = [];
		}
		const messageDown = data.get("messageDown")?.toString().trim();
		const messageUp = data.get("messageUp")?.toString().trim();
		const avatarUrl = type === "discord" ? (data.get("avatarUrl")?.toString().trim() || null) : null;

		if (!webhookId) {
			return fail(400, { webhookError: "webhook id required" });
		}
		if (!name) {
			return fail(400, { webhookError: "name is required" });
		}
		if (!url) {
			return fail(400, { webhookError: "url is required" });
		}

		try {
			await api.updateWebhook(webhookId, { name, url, type, isGlobal, groups, messageDown, messageUp, avatarUrl }, sessionId);
			await api.auditLog(user.id, "update", "webhook", webhookId, { name, type, isGlobal, groups }, getClientAddress(), sessionId);
			return { webhookSuccess: "webhook updated" };
		} catch (err) {
			return fail(400, {
				webhookError: err instanceof Error ? err.message : "failed to update webhook",
			});
		}
	},

	deleteWebhook: async ({ request, cookies, getClientAddress }) => {
		const sessionId = getSessionId(cookies);
		if (!sessionId) {
			redirect(302, "/login");
		}

		const user = await api.getUserById(sessionId, sessionId);
		if (!user || user.role !== "admin") {
			return fail(403, { webhookError: "not authorized" });
		}

		const data = await request.formData();
		const webhookId = data.get("webhookId")?.toString();

		if (!webhookId) {
			return fail(400, { webhookError: "webhook id required" });
		}

		try {
			await api.deleteWebhook(webhookId, sessionId);
			await api.auditLog(user.id, "delete", "webhook", webhookId, null, getClientAddress(), sessionId);
			return { webhookSuccess: "webhook deleted" };
		} catch (err) {
			return fail(400, {
				webhookError: err instanceof Error ? err.message : "failed to delete webhook",
			});
		}
	},

	testEmail: async ({ cookies }) => {
		const sessionId = getSessionId(cookies);
		if (!sessionId) {
			redirect(302, "/login");
		}

		const user = await api.getUserById(sessionId, sessionId);
		if (!user || user.role !== "admin") {
			return fail(403, { emailError: "not authorized" });
		}

		try {
			await api.sendTestEmail(sessionId);
			return { emailSuccess: "test email sent" };
		} catch (err) {
			return fail(400, {
				emailError: err instanceof Error ? err.message : "failed to send test email",
			});
		}
	},

	exportData: async ({ request, cookies }) => {
		const sessionId = getSessionId(cookies);
		if (!sessionId) {
			return fail(401, { error: "not logged in" });
		}

		let user;
		try {
			user = await api.getUserById(sessionId, sessionId);
		} catch (err) {
			return fail(403, { error: `auth error: ${err instanceof Error ? err.message : "unknown"}` });
		}

		if (!user) {
			return fail(403, { error: "user not found" });
		}

		const data = await request.formData();
		const exportType = data.get("exportType")?.toString() || "global";
		const groupName = data.get("groupName")?.toString();

		try {
			let exportResult;
			if (exportType === "global") {
				if (user.role !== "admin") {
					return fail(403, { error: "admin access required for global export" });
				}
				exportResult = await api.exportGlobal(sessionId);
			} else if (exportType === "group" && groupName) {
				exportResult = await api.exportGroup(groupName, sessionId);
			} else {
				return fail(400, { error: "invalid export parameters" });
			}
			return { exportData: JSON.stringify(exportResult) };
		} catch (err) {
			console.error("Export error:", err);
			return fail(400, {
				error: err instanceof Error ? err.message : "export failed",
			});
		}
	},

	importData: async ({ request, cookies, getClientAddress }) => {
		const sessionId = getSessionId(cookies);
		if (!sessionId) {
			redirect(302, "/login");
		}

		const user = await api.getUserById(sessionId, sessionId);
		if (!user) {
			return fail(403, { error: "not authorized" });
		}

		const data = await request.formData();
		const importDataStr = data.get("importData")?.toString();

		if (!importDataStr) {
			return fail(400, { error: "no import data provided" });
		}

		try {
			const importData = JSON.parse(importDataStr);
			const result = await api.importData(importData, sessionId);
			await api.auditLog(
				user.id,
				"import",
				"data",
				null,
				result.stats,
				getClientAddress(),
				sessionId,
			);
			return result.stats;
		} catch (err) {
			return fail(400, {
				error: err instanceof Error ? err.message : "import failed",
			});
		}
	},
};
