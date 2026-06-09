import * as apikeys from "./routes/apikeys";
import * as audit from "./routes/audit";
import * as auth from "./routes/auth";
import * as checks from "./routes/checks";
import * as events from "./routes/events";
import * as exportData from "./routes/export";
import * as invites from "./routes/invites";
import * as services from "./routes/services";
import * as settings from "./routes/settings";
import * as version from "./routes/version";
import * as webhooks from "./routes/webhooks";
import { handleSSE } from "./utils/sse";
import { notFound } from "./utils/response";
import type { Route } from "../types";
import { env } from "./env";

const basePath = env.apiBasePath;

const routes: Route[] = [
	{
		pattern: /^\/version$/,
		handlers: { GET: version.get },
	},
	{
		pattern: /^\/events\/stream$/,
		handlers: { GET: handleSSE },
	},
	{
		pattern: /^\/\.well-known\/security\.txt$/,
		handlers: { GET: settings.getSecurityTxt },
	},
	{
		pattern: /^\/settings$/,
		handlers: { GET: settings.get, PUT: settings.update },
	},
	{
		pattern: /^\/settings\/test-email$/,
		handlers: { POST: settings.testEmail },
	},
	{
		pattern: /^\/auth\/login$/,
		handlers: { POST: auth.login },
	},
	{
		pattern: /^\/auth\/register$/,
		handlers: { POST: auth.register },
	},
	{
		pattern: /^\/auth\/user\/([^/]+)$/,
		handlers: { GET: auth.getUser },
	},
	{
		pattern: /^\/auth\/user\/([^/]+)\/password$/,
		handlers: { PUT: auth.changePassword },
	},
	{
		pattern: /^\/auth\/first-user$/,
		handlers: { GET: auth.isFirstUser },
	},
	{
		pattern: /^\/services$/,
		handlers: { GET: services.list, POST: services.create },
	},
	{
		pattern: /^\/services\/public$/,
		handlers: { GET: services.listPublic },
	},
	{
		pattern: /^\/services\/user\/([^/]+)$/,
		handlers: { GET: services.listByUser },
	},
	{
		pattern: /^\/services\/positions$/,
		handlers: { PUT: services.updatePositions },
	},
	{
		pattern: /^\/services\/([^/]+)$/,
		handlers: {
			GET: services.get,
			PUT: services.update,
			DELETE: services.remove,
		},
	},
	{
		pattern: /^\/groups$/,
		handlers: { GET: services.listGroups, POST: services.upsertGroup },
	},
	{
		pattern: /^\/groups\/hierarchy$/,
		handlers: { GET: services.listGroupsHierarchy },
	},
	{
		pattern: /^\/groups\/positions$/,
		handlers: { PUT: services.updateGroupPositions },
	},
	{
		pattern: /^\/groups\/rename$/,
		handlers: { PUT: services.renameGroup },
	},
	{
		pattern: /^\/groups\/delete$/,
		handlers: { DELETE: services.deleteGroup },
	},
	{
		pattern: /^\/groups\/email$/,
		handlers: { PUT: services.updateGroupEmailNotifications },
	},
	{
		pattern: /^\/checks\/service\/([^/]+)$/,
		handlers: { GET: checks.getForService, POST: checks.runCheck },
	},
	{
		pattern: /^\/checks\/service\/([^/]+)\/latest$/,
		handlers: { GET: checks.getLatestForService },
	},
	{
		pattern: /^\/checks\/service\/([^/]+)\/stats$/,
		handlers: { GET: checks.getStatsForService },
	},
	{
		pattern: /^\/checks\/batch$/,
		handlers: { POST: checks.getLatestBatch },
	},
	{
		pattern: /^\/checks\/stats\/batch$/,
		handlers: { POST: checks.getStatsBatch },
	},
	{
		pattern: /^\/checker\/start\/([^/]+)$/,
		handlers: { POST: checks.startChecker },
	},
	{
		pattern: /^\/checker\/stop\/([^/]+)$/,
		handlers: { POST: checks.stopChecker },
	},
	{
		pattern: /^\/events$/,
		handlers: { GET: events.list, POST: events.create },
	},
	{
		pattern: /^\/events\/active$/,
		handlers: { GET: events.listActive },
	},
	{
		pattern: /^\/events\/([^/]+)$/,
		handlers: {
			GET: events.get,
			PUT: events.update,
			DELETE: events.remove,
		},
	},
	{
		pattern: /^\/events\/([^/]+)\/resolve$/,
		handlers: { POST: events.resolve },
	},
	{
		pattern: /^\/invites\/user\/([^/]+)$/,
		handlers: { GET: invites.list, POST: invites.create },
	},
	{
		pattern: /^\/invites\/([^/]+)$/,
		handlers: { DELETE: invites.remove },
	},
	{
		pattern: /^\/invites\/validate$/,
		handlers: { POST: invites.validate },
	},
	{
		pattern: /^\/invites\/([^/]+)\/use$/,
		handlers: { POST: invites.markUsed },
	},
	{
		pattern: /^\/audit$/,
		handlers: { GET: audit.list, POST: audit.create },
	},
	{
		pattern: /^\/webhooks$/,
		handlers: { GET: webhooks.list, POST: webhooks.create },
	},
	{
		pattern: /^\/webhooks\/([^/]+)$/,
		handlers: { PUT: webhooks.update, DELETE: webhooks.remove },
	},
	{
		pattern: /^\/export\/global$/,
		handlers: { GET: exportData.exportGlobal },
	},
	{
		pattern: /^\/export\/group\/([^/]+)$/,
		handlers: { GET: exportData.exportGroup },
	},
	{
		pattern: /^\/export\/service\/([^/]+)$/,
		handlers: { GET: exportData.exportService },
	},
	{
		pattern: /^\/import$/,
		handlers: { POST: exportData.importData },
	},
	{
		pattern: /^\/api-keys$/,
		handlers: { GET: apikeys.list, POST: apikeys.create },
	},
	{
		pattern: /^\/api-keys\/([^/]+)$/,
		handlers: { PUT: apikeys.update, DELETE: apikeys.remove },
	},
];

export async function router(
	req: Request,
	url: URL,
	method: string,
): Promise<Response> {
	let path = url.pathname;

	if (basePath && (path === basePath || path.startsWith(basePath + "/"))) {
		path = path.slice(basePath.length) || "/";
	}

	for (const route of routes) {
		const match = path.match(route.pattern);
		if (match) {
			const handler = route.handlers[method];
			if (handler) {
				const params: Record<string, string> = {};
				if (match[1]) params.id = match[1];
				if (match[2]) params.id2 = match[2];
				return handler(req, url, params);
			}
			return Response.json(
				{ success: false, error: "Method not allowed" },
				{ status: 405 },
			);
		}
	}

	return notFound("Route not found");
}
