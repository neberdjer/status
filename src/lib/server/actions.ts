import { fail, type Actions, type Cookies, type RequestEvent } from "@sveltejs/kit";
import { authenticate } from "./auth";
import * as api from "./api";

function parseServiceForm(formData: FormData) {
	return {
		name: formData.get("name")?.toString().trim(),
		url: formData.get("url")?.toString().trim(),
		displayUrl: formData.get("displayUrl")?.toString().trim() || null,
		description: formData.get("description")?.toString().trim() || null,
		expectedStatus: Number.parseInt(formData.get("expectedStatus")?.toString() || "200", 10),
		expectedContentType: formData.get("expectedContentType")?.toString().trim() || null,
		expectedBody: formData.get("expectedBody")?.toString().trim() || null,
		checkInterval: Number.parseInt(formData.get("checkInterval")?.toString() || "60", 10),
		userAgent: formData.get("userAgent")?.toString().trim() || null,
		enabled: formData.get("enabled") === "on",
		isPublic: formData.get("isPublic") === "on",
		emailNotifications: formData.get("emailNotifications") === "on",
		groupName: formData.get("groupName")?.toString().trim() || null,
	};
}

async function savePositions<T>(
	cookies: Cookies,
	request: Request,
	save: (positions: T[], sessionId: string) => Promise<void>,
) {
	const auth = await authenticate(cookies);
	if (!auth) return fail(401, { error: "Unauthorized" });

	const formData = await request.formData();
	const positionsJson = formData.get("positions")?.toString();

	if (!positionsJson) return fail(400, { error: "Positions required" });

	try {
		await save(JSON.parse(positionsJson), auth.sessionId);
		return { success: true };
	} catch {
		return fail(400, { error: "Invalid positions data" });
	}
}

async function upsertGroup(
	{ cookies, request, getClientAddress }: RequestEvent,
	verb: "create" | "update",
	adminOnly: boolean,
) {
	const auth = await authenticate(cookies);
	if (!auth) return fail(401, { error: "Unauthorized" });

	if (adminOnly && auth.user.role !== "admin") {
		return fail(403, { error: "Admin access required" });
	}

	const formData = await request.formData();
	const name = formData.get("name")?.toString().trim();
	const parentGroupName = formData.get("parentGroupName")?.toString().trim() || null;

	if (!name) {
		return fail(400, { error: "Group name is required" });
	}

	try {
		await api.upsertGroup(name, undefined, parentGroupName, auth.sessionId);
		await api.auditLog(auth.user.id, verb, "group", name, { parentGroupName }, getClientAddress(), auth.sessionId);
		return { success: true };
	} catch (err) {
		return fail(400, {
			error: err instanceof Error ? err.message : `Failed to ${verb} group`,
		});
	}
}

export const statusPageActions: Actions = {
	delete: async ({ cookies, request, getClientAddress }) => {
		const auth = await authenticate(cookies);
		if (!auth) return fail(401, { error: "Unauthorized" });

		const formData = await request.formData();
		const serviceId = formData.get("id")?.toString();

		if (!serviceId) return fail(400, { error: "Service ID required" });

		await api.stopChecker(serviceId, auth.sessionId);
		await api.deleteService(serviceId, auth.sessionId);
		await api.auditLog(auth.user.id, "delete", "service", serviceId, null, getClientAddress(), auth.sessionId);

		return { success: true };
	},

	check: async ({ cookies, request }) => {
		const auth = await authenticate(cookies);
		if (!auth) return fail(401, { error: "Unauthorized" });

		const formData = await request.formData();
		const serviceId = formData.get("id")?.toString();

		if (!serviceId) return fail(400, { error: "Service ID required" });

		const check = await api.runCheck(serviceId, auth.sessionId);
		return { success: true, check };
	},

	edit: async ({ cookies, request, getClientAddress }) => {
		const auth = await authenticate(cookies);
		if (!auth) return fail(401, { editError: "Unauthorized" });

		const formData = await request.formData();
		const serviceId = formData.get("id")?.toString();
		const fields = parseServiceForm(formData);
		const { name, url, expectedStatus, checkInterval, enabled } = fields;

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
			await api.updateService(serviceId, { ...fields, name, url }, auth.sessionId);
		} catch (err) {
			return fail(500, { editError: err instanceof Error ? err.message : "Failed to update service", editServiceId: serviceId });
		}

		await api.stopChecker(serviceId, auth.sessionId);
		await api.auditLog(auth.user.id, "update", "service", serviceId, { name, url, enabled, isPublic: fields.isPublic }, getClientAddress(), auth.sessionId);

		if (enabled) {
			await api.startChecker(serviceId, auth.sessionId);
		}

		return { success: true, edited: true };
	},

	create: async ({ cookies, request, getClientAddress }) => {
		const auth = await authenticate(cookies);
		if (!auth) return fail(401, { createError: "Unauthorized" });

		const formData = await request.formData();
		const fields = parseServiceForm(formData);
		const { name, url, description, ...rest } = fields;

		if (!name) return fail(400, { createError: "Name is required" });
		if (!url) return fail(400, { createError: "URL is required" });

		try {
			new URL(url);
		} catch {
			return fail(400, { createError: "Invalid URL format" });
		}

		try {
			const service = await api.createService(name, url, auth.sessionId, {
				...rest,
				description: description || undefined,
			});
			await api.auditLog(auth.user.id, "create", "service", service.id, { name, url, enabled: rest.enabled, isPublic: rest.isPublic }, getClientAddress(), auth.sessionId);

			if (rest.enabled) {
				await api.startChecker(service.id, auth.sessionId);
			}

			return { success: true, created: true };
		} catch (err) {
			console.error("Create service error:", err);
			return fail(500, { createError: err instanceof Error ? err.message : "Failed to create service" });
		}
	},

	updatePositions: ({ cookies, request }) =>
		savePositions(cookies, request, api.updateServicePositions),

	updateGroupPositions: ({ cookies, request }) =>
		savePositions(cookies, request, api.updateGroupPositions),

	renameGroup: async ({ cookies, request, getClientAddress }) => {
		const auth = await authenticate(cookies);
		if (!auth) return fail(401, { renameError: "Unauthorized" });

		const formData = await request.formData();
		const oldName = formData.get("oldName")?.toString().trim();
		const newName = formData.get("newName")?.toString().trim();

		if (!oldName || !newName) {
			return fail(400, { renameError: "Group name is required" });
		}

		try {
			await api.renameGroup(oldName, newName, auth.sessionId);
			await api.auditLog(auth.user.id, "update", "group", oldName, { oldName, newName }, getClientAddress(), auth.sessionId);
			return { success: true, renamed: true };
		} catch (err) {
			return fail(400, { renameError: err instanceof Error ? err.message : "Failed to rename group" });
		}
	},

	deleteGroup: async ({ cookies, request, getClientAddress }) => {
		const auth = await authenticate(cookies);
		if (!auth) return fail(401, { error: "Unauthorized" });

		const formData = await request.formData();
		const name = formData.get("name")?.toString().trim();

		if (!name) {
			return fail(400, { error: "Group name is required" });
		}

		try {
			await api.deleteGroup(name, auth.sessionId);
			await api.auditLog(auth.user.id, "delete", "group", name, null, getClientAddress(), auth.sessionId);
			return { success: true, deleted: true };
		} catch (err) {
			return fail(400, { error: err instanceof Error ? err.message : "Failed to delete group" });
		}
	},

	toggleGroupEmail: async ({ cookies, request, getClientAddress }) => {
		const auth = await authenticate(cookies);
		if (!auth) return fail(401, { error: "Unauthorized" });

		if (auth.user.role !== "admin") {
			return fail(403, { error: "Admin access required" });
		}

		const formData = await request.formData();
		const name = formData.get("name")?.toString().trim();
		const emailNotifications = formData.get("emailNotifications")?.toString() === "true";

		if (!name) {
			return fail(400, { error: "Group name is required" });
		}

		try {
			await api.updateGroupEmail(name, emailNotifications, auth.sessionId);
			await api.auditLog(auth.user.id, "update", "group", name, { emailNotifications }, getClientAddress(), auth.sessionId);
			return { success: true };
		} catch (err) {
			return fail(400, { error: err instanceof Error ? err.message : "Failed to update group email" });
		}
	},

	setGroupParent: (event) => upsertGroup(event, "update", false),

	createGroup: (event) => upsertGroup(event, "create", true),
};
