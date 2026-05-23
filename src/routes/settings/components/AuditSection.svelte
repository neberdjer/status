<script lang="ts">
import { formatDateTime } from "$lib";
import type { AuditLog } from "$lib";

const { initialLogs = [] }: { initialLogs?: AuditLog[] } = $props();

let logs = $state<AuditLog[]>([]);
let loading = $state(true);
let total = $state(0);
let page = $state(1);
let perPage = $state(20);
let selectedDate = $state("");
let hasLoaded = $state(false);
let fetchSeq = 0;

const totalPages = $derived(Math.max(1, Math.ceil(total / perPage)));

async function fetchLogs() {
	const seq = ++fetchSeq;
	loading = true;
	try {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const params = new URLSearchParams();
		params.set("limit", String(perPage));
		params.set("offset", String((page - 1) * perPage));
		if (selectedDate) {
			params.set("startDate", selectedDate);
			params.set("endDate", selectedDate);
		}

		const res = await fetch(`/api/audit?${params.toString()}`);
		if (seq !== fetchSeq) return;
		if (res.ok) {
			const json = await res.json();
			if (seq !== fetchSeq) return;
			logs = json.data?.logs ?? [];
			total = json.data?.total ?? 0;
		} else {
			logs = [];
			total = 0;
		}
	} catch (err) {
		if (seq !== fetchSeq) return;
		console.error("Failed to fetch audit logs:", err);
		logs = [];
		total = 0;
	} finally {
		if (seq === fetchSeq) loading = false;
	}
}

function handleDateChange() {
	page = 1;
	fetchLogs();
}

function goToPage(newPage: number) {
	if (newPage >= 1 && newPage <= totalPages) {
		page = newPage;
		fetchLogs();
	}
}

$effect(() => {
	if (!hasLoaded) {
		hasLoaded = true;
		logs = initialLogs ?? [];
		fetchLogs();
	}
});
</script>

<section class="settings-section">
	<div class="audit-header-row">
		<h3>audit log</h3>
		<input
			type="date"
			bind:value={selectedDate}
			onchange={handleDateChange}
			class="date-input"
			aria-label="Filter by date"
		/>
	</div>

	{#if loading}
		<div class="audit-loading">loading...</div>
	{:else if logs.length > 0}
		<div class="audit-list">
			{#each logs as log (log.id)}
				<div class="audit-item">
					<div class="audit-header">
						<span class="audit-action {log.action}">{log.action}</span>
						<span class="audit-entity">{log.entityType}</span>
						<span class="audit-date">{formatDateTime(log.createdAt)}</span>
					</div>
					<div class="audit-details">
						<span class="audit-user">{log.userName || log.userId}</span>
						{#if log.entityId}
							<span class="audit-entity-id">{log.entityId.slice(0, 8)}...</span>
						{/if}
						{#if log.ipAddress}
							<span class="audit-ip">{log.ipAddress}</span>
						{/if}
					</div>
					{#if log.details}
						<div class="audit-extra">
							{#each Object.entries(log.details) as [key, value]}
								<span class="audit-detail">{key}: {value}</span>
							{/each}
						</div>
					{/if}
				</div>
			{/each}
		</div>

		{#if totalPages > 1}
			<div class="audit-pagination">
				<button
					type="button"
					class="btn btn-secondary pagination-btn"
					disabled={page <= 1}
					onclick={() => goToPage(page - 1)}
					aria-label="Previous page"
				>
					←
				</button>
				<span class="pagination-info">
					page {page} of {totalPages} ({total} total)
				</span>
				<button
					type="button"
					class="btn btn-secondary pagination-btn"
					disabled={page >= totalPages}
					onclick={() => goToPage(page + 1)}
					aria-label="Next page"
				>
					→
				</button>
			</div>
		{/if}
	{:else}
		<p class="no-logs">{selectedDate ? "no audit logs for this date" : "no audit logs yet"}</p>
	{/if}
</section>
