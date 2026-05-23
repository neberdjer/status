import type { SSEMessage, CheckUpdateHandler } from "../types";

export function createSSEConnection(onCheckUpdate: CheckUpdateHandler, apiUrl: string): () => void {
	let eventSource: EventSource | null = null;
	let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
	let disposed = false;

	const baseUrl = apiUrl.endsWith("/") ? apiUrl.slice(0, -1) : apiUrl;
	const sseUrl = `${baseUrl}/events/stream`;

	function connect() {
		if (disposed) return;

		if (eventSource) {
			eventSource.close();
		}

		eventSource = new EventSource(sseUrl);

		eventSource.onopen = () => {
			console.log("[SSE] Connected");
		};

		eventSource.onmessage = (event) => {
			try {
				const data: SSEMessage = JSON.parse(event.data);

				if (data.type === "check" && data.serviceId && data.check) {
					onCheckUpdate(data.serviceId, data.check);
				}
			} catch (err) {
				console.error("[SSE] Parse error:", err);
			}
		};

		eventSource.onerror = () => {
			if (disposed) return;
			console.log("[SSE] Connection error, reconnecting...");
			eventSource?.close();
			eventSource = null;

			if (reconnectTimeout) {
				clearTimeout(reconnectTimeout);
			}
			reconnectTimeout = setTimeout(connect, 3000);
		};
	}

	connect();

	return () => {
		disposed = true;
		if (reconnectTimeout) {
			clearTimeout(reconnectTimeout);
			reconnectTimeout = null;
		}
		if (eventSource) {
			eventSource.onerror = null;
			eventSource.close();
			eventSource = null;
		}
	};
}
