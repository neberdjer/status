export function sanitizeUserAgent(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const cleaned = value.replace(/[\r\n\t\0]+/g, " ").trim().slice(0, 512);
	return cleaned || null;
}
