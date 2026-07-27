import { sql } from "../index";
import type { SiteSettings } from "../../types";
import { getAuthContext, requireAuth, requireAdmin } from "../utils/auth";
import { ok, badRequest, unauthorized, forbidden } from "../utils/response";
import { sendTestEmail as sendTest } from "../utils/email";
import { invalidateSettingsCache } from "./checks";
import { sanitizeUserAgent } from "../utils/sanitize";

export type { SiteSettings };

export async function getSettings(): Promise<SiteSettings> {
	const rows = await sql`SELECT key, value FROM settings`;

	const map: Record<string, string> = {};
	for (const row of rows) {
		map[row.key as string] = row.value as string;
	}

	let emailGroups: string[] = [];
	try {
		emailGroups = JSON.parse(map.email_groups || "[]");
	} catch {
		emailGroups = [];
	}

	return {
		siteName: map.site_name || "atums/status",
		siteIcon: map.site_icon || "",
		siteUrl: map.site_url || "",
		sourceUrl: map.source_url || "",
		discordUrl: map.discord_url || "",
		securityContact: map.security_contact || "",
		securityCanonical: map.security_canonical || "/.well-known/security.txt",
		smtpHost: map.smtp_host || "",
		smtpPort: map.smtp_port || "587",
		smtpUser: map.smtp_user || "",
		smtpPass: map.smtp_pass || "",
		smtpFrom: map.smtp_from || "",
		smtpSecure: map.smtp_secure === "true",
		smtpEnabled: map.smtp_enabled === "true",
		emailTo: map.email_to || "",
		emailIsGlobal: map.email_is_global !== "false",
		emailGroups,
		retryCount: Number.parseInt(map.retry_count || "0", 10) || 0,
		checkUserAgent: map.check_user_agent || "",
	};
}

export async function get(): Promise<Response> {
	const settings = await getSettings();
	return ok({ settings });
}

export async function update(req: Request): Promise<Response> {
	const auth = await getAuthContext(req);
	if (!requireAuth(auth)) {
		return unauthorized();
	}
	if (!requireAdmin(auth)) {
		return forbidden("Admin access required");
	}

	const body = await req.json();
	const {
		siteName,
		siteIcon,
		siteUrl,
		sourceUrl,
		discordUrl,
		securityContact,
		securityCanonical,
		smtpHost,
		smtpPort,
		smtpUser,
		smtpPass,
		smtpFrom,
		smtpSecure,
		smtpEnabled,
		emailTo,
		emailIsGlobal,
		emailGroups,
		retryCount,
		checkUserAgent,
	} = body;

	const updates: Array<{ key: string; value: string }> = [];

	if (typeof siteName === "string") {
		updates.push({ key: "site_name", value: siteName });
	}
	if (typeof siteIcon === "string") {
		if (siteIcon !== "") {
			try {
				const url = new URL(siteIcon);
				const path = url.pathname.toLowerCase();
				if (!path.endsWith(".jpg") && !path.endsWith(".jpeg") && !path.endsWith(".png")) {
					return badRequest("Site icon must be a .jpg or .png URL");
				}
			} catch {
				return badRequest("Site icon must be a valid URL");
			}
		}
		updates.push({ key: "site_icon", value: siteIcon });
	}
	if (typeof siteUrl === "string") {
		updates.push({ key: "site_url", value: siteUrl });
	}
	if (typeof sourceUrl === "string") {
		updates.push({ key: "source_url", value: sourceUrl });
	}
	if (typeof discordUrl === "string") {
		updates.push({ key: "discord_url", value: discordUrl });
	}
	if (typeof securityContact === "string") {
		updates.push({ key: "security_contact", value: securityContact });
	}
	if (typeof securityCanonical === "string") {
		updates.push({ key: "security_canonical", value: securityCanonical });
	}
	if (typeof smtpHost === "string") {
		updates.push({ key: "smtp_host", value: smtpHost });
	}
	if (typeof smtpPort === "string") {
		updates.push({ key: "smtp_port", value: smtpPort });
	}
	if (typeof smtpUser === "string") {
		updates.push({ key: "smtp_user", value: smtpUser });
	}
	if (typeof smtpPass === "string") {
		updates.push({ key: "smtp_pass", value: smtpPass });
	}
	if (typeof smtpFrom === "string") {
		updates.push({ key: "smtp_from", value: smtpFrom });
	}
	if (typeof smtpSecure === "boolean") {
		updates.push({ key: "smtp_secure", value: String(smtpSecure) });
	}
	if (typeof smtpEnabled === "boolean") {
		updates.push({ key: "smtp_enabled", value: String(smtpEnabled) });
	}
	if (typeof emailTo === "string") {
		updates.push({ key: "email_to", value: emailTo });
	}
	if (typeof emailIsGlobal === "boolean") {
		updates.push({ key: "email_is_global", value: String(emailIsGlobal) });
	}
	if (Array.isArray(emailGroups)) {
		const groupList = emailGroups.filter((g): g is string => typeof g === "string");
		updates.push({ key: "email_groups", value: JSON.stringify(groupList) });
	}
	if (typeof retryCount === "number") {
		const count = Math.max(0, Math.min(10, Math.floor(retryCount)));
		updates.push({ key: "retry_count", value: String(count) });
	}
	if (typeof checkUserAgent === "string") {
		updates.push({ key: "check_user_agent", value: sanitizeUserAgent(checkUserAgent) || "" });
	}

	if (updates.length === 0) {
		return badRequest("No valid settings provided");
	}

	for (const { key, value } of updates) {
		await sql`
			INSERT INTO settings (key, value, updated_at)
			VALUES (${key}, ${value}, NOW())
			ON CONFLICT (key) DO UPDATE SET value = ${value}, updated_at = NOW()
		`;
	}

	invalidateSettingsCache();

	const settings = await getSettings();
	return ok({ settings });
}

export async function getSecurityTxt(): Promise<Response> {
	const settings = await getSettings();
	const content = `Contact: ${settings.securityContact || "security@example.com"}
Preferred-Languages: en
Canonical: ${settings.securityCanonical || "/.well-known/security.txt"}
`;
	return new Response(content, {
		headers: { "Content-Type": "text/plain; charset=utf-8" },
	});
}

export async function testEmail(req: Request): Promise<Response> {
	const auth = await getAuthContext(req);
	if (!requireAuth(auth)) {
		return unauthorized();
	}
	if (!requireAdmin(auth)) {
		return forbidden("Admin access required");
	}

	const result = await sendTest();

	if (result.success) {
		return ok({ message: "Test email sent successfully" });
	}
	return badRequest(result.error || "Failed to send test email");
}
