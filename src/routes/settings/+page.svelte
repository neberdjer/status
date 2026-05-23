<script lang="ts">
import { ThemeToggle, UserMenu } from "$lib";
import favicon from "$lib/assets/favicon.svg";
import type { PageData } from "./$types";
import { page } from "$app/state";
import { goto } from "$app/navigation";
import "./page.css";
import AccountSection from "./components/AccountSection.svelte";
import PasswordSection from "./components/PasswordSection.svelte";
import InvitesSection from "./components/InvitesSection.svelte";
import EventsSection from "./components/EventsSection.svelte";
import AuditSection from "./components/AuditSection.svelte";
import SessionSection from "./components/SessionSection.svelte";
import SiteSection from "./components/SiteSection.svelte";
import WebhooksSection from "./components/WebhooksSection.svelte";
import ExportSection from "./components/ExportSection.svelte";
import ApiKeysSection from "./components/ApiKeysSection.svelte";

const { data }: { data: PageData } = $props();

const siteIcon = $derived(data.site.icon || favicon);

const validTabs = $derived.by(() => {
	const base = ["account"];
	if (data.user.role === "admin") {
		base.push("site", "notifications", "events", "audit", "export");
	}
	return base;
});

const tabs = $derived.by(() => {
	const base = [
		{ id: "account", label: "account" },
	];
	if (data.user.role === "admin") {
		base.push(
			{ id: "site", label: "site" },
			{ id: "notifications", label: "notifications" },
			{ id: "events", label: "events" },
			{ id: "audit", label: "audit log" },
			{ id: "export", label: "export" },
		);
	}
	return base;
});

const activeTab = $derived.by(() => {
	const tabParam = page.url.searchParams.get("tab");
	if (tabParam && validTabs.includes(tabParam)) {
		return tabParam;
	}
	return "account";
});

function setTab(tab: string) {
	goto(`?tab=${tab}`, { replaceState: true, noScroll: true });
}
</script>

<div class="container">
	<header class="header">
		<div class="header-left">
			<img src={siteIcon} alt="" class="site-icon" />
			<h1><span class="brand">{data.site.brand}</span>{data.site.suffix}</h1>
			<nav class="nav">
				<a href="/" class="nav-link">index</a>
				{#if data.site.sourceUrl}
					<a href={data.site.sourceUrl} target="_blank" rel="noopener noreferrer" class="nav-link">source</a>
				{/if}
				{#if data.site.discordUrl}
					<a href={data.site.discordUrl} target="_blank" rel="noopener noreferrer" class="nav-link">discord</a>
				{/if}
			</nav>
		</div>
		<div class="header-actions">
			<ThemeToggle />
			<UserMenu user={data.user} />
		</div>
	</header>

	<main id="main-content" class="main narrow">
		<h2>settings</h2>

		<div class="tabs">
			{#each tabs as tab (tab.id)}
				<button
					type="button"
					class="tab"
					class:active={activeTab === tab.id}
					onclick={() => setTab(tab.id)}
				>
					{tab.label}
				</button>
			{/each}
		</div>

		<div class="tab-content">
			{#if activeTab === "account"}
				<AccountSection user={data.user} />
				<PasswordSection />
				<ApiKeysSection />
				<SessionSection />
			{:else if activeTab === "site"}
				<SiteSection settings={data.siteSettings} />
				<InvitesSection invites={data.invites} />
			{:else if activeTab === "notifications"}
				<WebhooksSection webhooks={data.webhooks} groups={data.groups} settings={data.siteSettings} />
			{:else if activeTab === "events"}
				<EventsSection events={data.events} groups={data.groups} />
			{:else if activeTab === "audit"}
				<AuditSection initialLogs={data.auditLogs} />
			{:else if activeTab === "export"}
				<ExportSection groups={data.groups} />
			{/if}
		</div>
	</main>
</div>
