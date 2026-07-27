export interface Service {
	id: string;
	name: string;
	description: string | null;
	url: string;
	displayUrl: string | null;
	expectedStatus: number;
	expectedContentType: string | null;
	expectedBody: string | null;
	checkInterval: number;
	userAgent: string | null;
	enabled: boolean;
	isPublic: boolean;
	emailNotifications: boolean;
	groupName: string | null;
	position: number;
	createdBy: string;
	createdAt: string;
	updatedAt: string;
}

export type CheckErrorType =
	| "status"
	| "content-type"
	| "body"
	| "timeout"
	| "connection";

export interface CheckErrorDetail {
	type: CheckErrorType;
	message: string;
	expected?: string;
	actual?: string;
}

export interface ServiceCheck {
	id: string;
	serviceId: string;
	statusCode: number | null;
	responseTime: number | null;
	success: boolean;
	errorMessage: string | null;
	errorDetails: CheckErrorDetail[] | null;
	checkedAt: string;
}

export interface ServiceStats {
	totalChecks: number;
	successfulChecks: number;
	uptimePercent: number;
	avgResponseTime: number;
	minResponseTime: number;
	maxResponseTime: number;
}
