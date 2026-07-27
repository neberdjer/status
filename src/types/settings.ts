export interface SiteSettings {
	siteName: string;
	siteIcon: string;
	siteUrl: string;
	sourceUrl: string;
	discordUrl: string;
	securityContact: string;
	securityCanonical: string;
	smtpHost: string;
	smtpPort: string;
	smtpUser: string;
	smtpPass: string;
	smtpFrom: string;
	smtpSecure: boolean;
	smtpEnabled: boolean;
	emailTo: string;
	emailIsGlobal: boolean;
	emailGroups: string[];
	retryCount: number;
	checkUserAgent: string;
}
