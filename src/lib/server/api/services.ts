import type { Service } from "../../../types";
import { request } from "./client";

export async function getServices(sessionId?: string): Promise<Service[]> {
	const result = await request<{ services: Service[] }>("/services", { sessionId });
	return result.services;
}

export async function getPublicServices(): Promise<Service[]> {
	const result = await request<{ services: Service[] }>("/services/public");
	return result.services;
}

export async function getServicesByUser(userId: string, sessionId?: string): Promise<Service[]> {
	const result = await request<{ services: Service[] }>(
		`/services/user/${userId}`,
		{ sessionId: sessionId || userId },
	);
	return result.services;
}

export async function getServiceById(id: string): Promise<Service | null> {
	try {
		const result = await request<{ service: Service }>(`/services/${id}`);
		return result.service;
	} catch {
		return null;
	}
}

export async function createService(
	name: string,
	url: string,
	sessionId: string,
	options?: {
		description?: string;
		displayUrl?: string | null;
		expectedStatus?: number;
		expectedContentType?: string | null;
		expectedBody?: string | null;
		checkInterval?: number;
		userAgent?: string | null;
		enabled?: boolean;
		isPublic?: boolean;
		emailNotifications?: boolean;
		groupName?: string | null;
	},
): Promise<Service> {
	const result = await request<{ service: Service }>("/services", {
		method: "POST",
		body: JSON.stringify({ name, url, ...options }),
		sessionId,
	});
	return result.service;
}

export async function updateService(
	id: string,
	data: {
		name?: string;
		description?: string | null;
		url?: string;
		displayUrl?: string | null;
		expectedStatus?: number;
		expectedContentType?: string | null;
		expectedBody?: string | null;
		checkInterval?: number;
		userAgent?: string | null;
		enabled?: boolean;
		isPublic?: boolean;
		emailNotifications?: boolean;
		groupName?: string | null;
	},
	sessionId?: string,
): Promise<Service> {
	const result = await request<{ service: Service }>(`/services/${id}`, {
		method: "PUT",
		body: JSON.stringify(data),
		sessionId,
	});
	return result.service;
}

export async function deleteService(id: string, sessionId?: string): Promise<void> {
	await request(`/services/${id}`, { method: "DELETE", sessionId });
}

export async function updateServicePositions(
	positions: Array<{ id: string; position: number; groupName?: string }>,
	sessionId?: string,
): Promise<void> {
	await request("/services/positions", {
		method: "PUT",
		body: JSON.stringify({ positions }),
		sessionId,
	});
}
