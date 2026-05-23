export function formatDateTime(date: string, timezone?: string): string {
	return new Date(date).toLocaleString(undefined, {
		timeZone: timezone,
		hour12: false,
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

export function formatDate(date: string): string {
	return new Date(date).toLocaleDateString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

export function formatShortTime(date: string, timezone?: string): string {
	return new Date(date).toLocaleTimeString(undefined, {
		timeZone: timezone,
		hour12: false,
		hour: "2-digit",
		minute: "2-digit",
	});
}

export function formatResponseTime(ms: number): string {
	if (ms < 1000) {
		return `${ms}ms`;
	}
	return `${(ms / 1000).toFixed(2)}s`;
}

export function censorEmail(email: string): string {
	const [local, domain] = email.split("@");
	if (!domain) return "***";

	const censoredLocal =
		local.length > 2
			? local[0] + "*".repeat(local.length - 2) + local[local.length - 1]
			: "*".repeat(local.length);

	const dotIndex = domain.lastIndexOf(".");
	const domainName = dotIndex === -1 ? domain : domain.slice(0, dotIndex);
	const tld = dotIndex === -1 ? "" : domain.slice(dotIndex + 1);
	const censoredDomain =
		domainName.length > 2
			? domainName[0] +
				"*".repeat(domainName.length - 2) +
				domainName[domainName.length - 1]
			: "*".repeat(domainName.length);

	return tld
		? `${censoredLocal}@${censoredDomain}.${tld}`
		: `${censoredLocal}@${censoredDomain}`;
}

export async function copyToClipboard(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}
