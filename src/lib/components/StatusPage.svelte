<script lang="ts">
	import {
		type Group,
		type Service,
		type ServiceCheck,
		type ServiceStats,
		type StatusPageData,
		type StatusPageForm,
		ThemeToggle,
		UserMenu,
		formatDateTime,
		formatShortTime as formatShortTimeUtil,
		formatDate as formatDateUtil,
		formatResponseTime,
	} from "$lib";
	import favicon from "$lib/assets/favicon.svg";
	import { createSSEConnection } from "$lib/sse";
	import { enhance } from "$app/forms";
	import { goto, invalidateAll } from "$app/navigation";
	import { page } from "$app/state";
	import { onMount } from "svelte";

	let { data, form }: { data: StatusPageData; form: StatusPageForm | null } =
		$props();

	const siteIcon = $derived(data.site.icon || favicon);
	const isGroupView = $derived(!!data.currentGroup);
	const basePath = $derived(
		isGroupView ? `/${encodeURIComponent(data.currentGroup!)}` : "/",
	);

	let liveChecks = $state<Record<string, ServiceCheck | null>>({});
	const checks = $derived<Record<string, ServiceCheck | null>>({
		...data.checks,
		...liveChecks,
	});

	onMount(() => {
		const cleanup = createSSEConnection((serviceId, check) => {
			liveChecks[serviceId] = check;
			if (selectedService?.id === serviceId) {
				serviceChecks = [check, ...serviceChecks].slice(0, 100);
			}
		}, data.apiUrl);
		return cleanup;
	});

	$effect(() => {
		if (
			selectedService ||
			editingService ||
			creatingService ||
			creatingGroup ||
			creatingMasterGroup
		) {
			document.body.style.overflow = "hidden";
		} else {
			document.body.style.overflow = "";
		}
	});

	$effect(() => {
		if (!showAddMenu) return;

		const handleClickOutside = (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			if (!target.closest(".add-menu-container")) {
				showAddMenu = false;
			}
		};

		document.addEventListener("click", handleClickOutside);
		return () => document.removeEventListener("click", handleClickOutside);
	});

	$effect(() => {
		const modalParam = page.url.searchParams.get("modal");
		if (modalParam) {
			if (!selectedService || selectedService.id !== modalParam) {
				const service = data.services?.find((s) => s.id === modalParam);
				if (service) {
					openServiceDetail(service, false);
				} else {
					goto(basePath, { replaceState: true, noScroll: true });
				}
			}
		} else if (selectedService) {
			selectedService = null;
			serviceChecks = [];
			serviceStats = null;
		}
	});

	const embedColor = $derived(
		data.embed.status === "operational"
			? "#22c55e"
			: data.embed.status === "degraded"
				? "#eab308"
				: data.embed.status === "outage"
					? "#ef4444"
					: "#808080",
	);

	const canonicalUrl = $derived(data.embed.siteUrl || undefined);

	let editMode = $state(false);
	let selectedService = $state<Service | null>(null);
	let editingService = $state<Service | null>(null);
	let creatingService = $state(false);
	let creatingInGroup = $state<string | null>(null);
	let serviceChecks = $state<ServiceCheck[]>([]);
	let serviceStats = $state<ServiceStats | null>(null);
	let loading = $state(false);
	let showRecentEvents = $state(false);

	let draggedService = $state<Service | null>(null);
	let editingGroupName = $state<string | null>(null);
	let newGroupName = $state("");

	let showAddMenu = $state(false);
	let creatingGroup = $state(false);
	let creatingMasterGroup = $state(false);
	let newGroupInput = $state("");
	let newMasterGroupInput = $state("");
	let selectedMasterForSubGroup = $state<string | null>(null);

	function handleFormResult() {
		return async ({
			result,
			update,
		}: {
			result: { type: string };
			update: () => Promise<void>;
		}) => {
			if (result.type === "success") {
				editingService = null;
				creatingService = false;
				creatingInGroup = null;
				await invalidateAll();
			}
			await update();
		};
	}

	function formatTime(ms: number | null): string {
		if (ms === null) return "-";
		return formatResponseTime(ms);
	}

	function formatDate(date: string): string {
		return formatDateTime(date, data.timezone);
	}

	function formatShortTime(date: string): string {
		return formatShortTimeUtil(date, data.timezone);
	}

	function formatEventDate(date: string): string {
		return formatDateUtil(date);
	}

	function getEventTypeClass(type: string): string {
		switch (type) {
			case "incident":
				return "event-incident";
			case "maintenance":
				return "event-maintenance";
			default:
				return "event-info";
		}
	}

	const groupedServices = $derived.by(() => {
		const grouped: Record<string, Service[]> = {};
		const ungrouped: Service[] = [];
		const services = data.services || [];

		for (const service of services) {
			if (service.groupName) {
				if (!grouped[service.groupName]) {
					grouped[service.groupName] = [];
				}
				grouped[service.groupName].push(service);
			} else {
				ungrouped.push(service);
			}
		}

		for (const key of Object.keys(grouped)) {
			grouped[key].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
		}
		ungrouped.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

		return { groups: grouped, ungrouped };
	});

	const sortedGroups = $derived.by(() => {
		const dbGroups = data.groups || [];
		const dbGroupNames = new Set(dbGroups.map((g) => g.name));

		const serviceGroupNames = new Set(
			(data.services || [])
				.map((s) => s.groupName)
				.filter(
					(name): name is string =>
						name !== null && !dbGroupNames.has(name),
				),
		);

		const allGroups: Group[] = [
			...dbGroups.sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
			...[...serviceGroupNames].sort().map((name, i) => ({
				id: `service-group-${name}`,
				name,
				position: dbGroups.length + i,
				emailNotifications: false,
				createdAt: new Date().toISOString(),
				parentGroupName: null,
			})),
		];

		return allGroups;
	});

	const masterGroupsList = $derived.by(() => {
		const groupsWithChildren = new Set(
			sortedGroups
				.filter((g) => g.parentGroupName)
				.map((g) => g.parentGroupName),
		);
		return sortedGroups.filter(
			(g) => !g.parentGroupName && groupsWithChildren.has(g.name),
		);
	});

	function getAvailableParents(groupName: string) {
		return sortedGroups.filter(
			(g) => !g.parentGroupName && g.name !== groupName,
		);
	}

	const displayGroups = $derived.by(() => {
		if (isGroupView) {
			if (data.isMasterGroup && data.subGroups) {
				return data.subGroups.sort((a, b) => a.position - b.position);
			}
			const group = sortedGroups.find(
				(g) =>
					g.name.toLowerCase() === data.currentGroup?.toLowerCase(),
			);
			return group ? [group] : [];
		}

		const groupsWithChildren = new Set(
			sortedGroups
				.filter((g) => g.parentGroupName)
				.map((g) => g.parentGroupName),
		);
		return sortedGroups
			.filter((g) => !groupsWithChildren.has(g.name))
			.sort((a, b) => a.position - b.position);
	});

	const overallUptime = $derived.by(() => {
		const uptime = data.uptime || {};
		const services = data.services || [];
		if (services.length === 0) return null;

		const values = services
			.map((s) => uptime[s.id])
			.filter((u) => u && u.totalChecks > 0);

		if (values.length === 0) return null;

		const avg =
			values.reduce((sum, u) => sum + u.uptimePercent, 0) / values.length;
		return Math.round(avg * 100) / 100;
	});

	const groupUptime = $derived.by(() => {
		const uptime = data.uptime || {};
		const result: Record<string, number | null> = {};

		for (const [groupName, services] of Object.entries(
			groupedServices.groups,
		)) {
			const values = services
				.map((s) => uptime[s.id])
				.filter((u) => u && u.totalChecks > 0);

			if (values.length === 0) {
				result[groupName] = null;
			} else {
				const avg =
					values.reduce((sum, u) => sum + u.uptimePercent, 0) /
					values.length;
				result[groupName] = Math.round(avg * 100) / 100;
			}
		}

		return result;
	});

	async function openServiceDetail(service: Service, updateUrl = true) {
		if (editMode) return;
		selectedService = service;
		loading = true;
		serviceChecks = [];
		serviceStats = null;

		if (updateUrl) {
			goto(`${basePath}?modal=${service.id}`, {
				replaceState: false,
				noScroll: true,
			});
		}

		try {
			const [checksRes, statsRes] = await Promise.all([
				fetch(`/api/checks/service/${service.id}?limit=100`),
				fetch(`/api/checks/service/${service.id}/stats`),
			]);

			if (checksRes.ok) {
				const checksData = await checksRes.json();
				serviceChecks = checksData.data?.checks ?? [];
			}
			if (statsRes.ok) {
				const statsData = await statsRes.json();
				serviceStats = statsData.data?.stats ?? null;
			}
		} catch {
			serviceChecks = [];
			serviceStats = null;
		} finally {
			loading = false;
		}
	}

	function closeModal() {
		selectedService = null;
		serviceChecks = [];
		serviceStats = null;
		goto(basePath, { replaceState: false, noScroll: true });
	}

	function closeEditModal() {
		editingService = null;
	}

	function closeCreateModal() {
		creatingService = false;
		creatingInGroup = null;
	}

	function openCreateModal(groupName: string | null = null) {
		creatingService = true;
		creatingInGroup = groupName;
	}

	function openRenameGroup(groupName: string) {
		editingGroupName = groupName;
		newGroupName = groupName;
	}

	function closeRenameGroup() {
		editingGroupName = null;
		newGroupName = "";
	}

	async function saveGroupName() {
		if (!editingGroupName || !newGroupName.trim()) return;
		if (editingGroupName === newGroupName.trim()) {
			closeRenameGroup();
			return;
		}

		const formData = new FormData();
		formData.set("oldName", editingGroupName);
		formData.set("newName", newGroupName.trim());

		await fetch("/?/renameGroup", {
			method: "POST",
			body: formData,
		});

		closeRenameGroup();
		await invalidateAll();
	}

	async function deleteGroup(groupName: string) {
		const formData = new FormData();
		formData.set("name", groupName);

		await fetch("/?/deleteGroup", {
			method: "POST",
			body: formData,
		});

		await invalidateAll();
	}

	async function toggleGroupEmail(groupName: string, enabled: boolean) {
		const formData = new FormData();
		formData.set("name", groupName);
		formData.set("emailNotifications", String(enabled));

		await fetch("/?/toggleGroupEmail", {
			method: "POST",
			body: formData,
		});

		await invalidateAll();
	}

	async function createGroup() {
		if (!newGroupInput.trim()) return;

		const formData = new FormData();
		formData.set("name", newGroupInput.trim());
		if (selectedMasterForSubGroup) {
			formData.set("parentGroupName", selectedMasterForSubGroup);
		}

		await fetch("/?/createGroup", {
			method: "POST",
			body: formData,
		});

		newGroupInput = "";
		selectedMasterForSubGroup = null;
		creatingGroup = false;
		await invalidateAll();
	}

	async function createMasterGroup() {
		if (!newMasterGroupInput.trim()) return;

		const formData = new FormData();
		formData.set("name", newMasterGroupInput.trim());

		await fetch("/?/createGroup", {
			method: "POST",
			body: formData,
		});

		newMasterGroupInput = "";
		creatingMasterGroup = false;
		await invalidateAll();
	}

	async function setGroupParent(
		groupName: string,
		parentName: string | null,
	) {
		const formData = new FormData();
		formData.set("name", groupName);
		formData.set("parentGroupName", parentName ?? "");

		await fetch("/?/setGroupParent", {
			method: "POST",
			body: formData,
		});

		await invalidateAll();
	}

	function handleServiceDragStart(e: DragEvent, service: Service) {
		if (!editMode) return;
		draggedService = service;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = "move";
			e.dataTransfer.setData("text/plain", service.id);
		}
	}

	function handleServiceDragEnd() {
		draggedService = null;
	}

	async function handleServiceDrop(
		e: DragEvent,
		targetService: Service | null,
		targetGroup: string | null,
	) {
		e.preventDefault();
		if (!draggedService) return;

		const toGroup = targetGroup;

		const servicesInGroup = targetGroup
			? groupedServices.groups[targetGroup] || []
			: groupedServices.ungrouped;

		const filtered = servicesInGroup.filter(
			(s) => s.id !== draggedService!.id,
		);
		const targetIndex = targetService
			? filtered.findIndex((s) => s.id === targetService.id)
			: filtered.length;

		filtered.splice(
			targetIndex === -1 ? filtered.length : targetIndex,
			0,
			draggedService,
		);

		const positions: Array<{
			id: string;
			position: number;
			groupName?: string;
		}> = filtered.map((s, i) => ({
			id: s.id,
			position: i,
			groupName: toGroup ?? undefined,
		}));

		draggedService = null;

		if (positions.length > 0) {
			await savePositions(positions);
		}
	}

	async function moveGroupUp(groupName: string) {
		const groupList = [...sortedGroups];
		const index = groupList.findIndex((g) => g.name === groupName);
		if (index <= 0) return;

		[groupList[index - 1], groupList[index]] = [
			groupList[index],
			groupList[index - 1],
		];

		const positions = groupList.map((g, i) => ({
			name: g.name,
			position: i,
		}));

		await saveGroupPositions(positions);
	}

	async function moveGroupDown(groupName: string) {
		const groupList = [...sortedGroups];
		const index = groupList.findIndex((g) => g.name === groupName);
		if (index === -1 || index >= groupList.length - 1) return;

		[groupList[index], groupList[index + 1]] = [
			groupList[index + 1],
			groupList[index],
		];

		const positions = groupList.map((g, i) => ({
			name: g.name,
			position: i,
		}));

		await saveGroupPositions(positions);
	}

	async function savePositions(
		positions: Array<{ id: string; position: number; groupName?: string }>,
	) {
		const formData = new FormData();
		formData.set("positions", JSON.stringify(positions));

		await fetch("/?/updatePositions", {
			method: "POST",
			body: formData,
		});
		await invalidateAll();
	}

	async function saveGroupPositions(
		positions: Array<{ name: string; position: number }>,
	) {
		const formData = new FormData();
		formData.set("positions", JSON.stringify(positions));

		await fetch("/?/updateGroupPositions", {
			method: "POST",
			body: formData,
		});
		await invalidateAll();
	}

	let hoveredPoint = $state<{
		check: ServiceCheck;
		x: number;
		y: number;
	} | null>(null);

	let isMobile = $state(false);

	onMount(() => {
		const checkMobile = () => {
			isMobile = window.innerWidth < 600;
		};
		checkMobile();
		window.addEventListener("resize", checkMobile);
		return () => window.removeEventListener("resize", checkMobile);
	});

	const FAILED_Y = 4;

	const graphData = $derived.by(() => {
		if (serviceChecks.length === 0)
			return {
				points: [],
				lineSegments: [],
				maxTime: 0,
				minTime: 0,
				timeLabels: [],
				yLabels: [],
				hasSuccess: false,
			};

		const maxPoints = isMobile ? 20 : 50;
		const chronological = [...serviceChecks].reverse();

		let sampled = chronological;
		if (chronological.length > maxPoints) {
			const bucketSize = chronological.length / maxPoints;
			sampled = [];
			for (let i = 0; i < maxPoints; i++) {
				const start = Math.floor(i * bucketSize);
				const end = Math.floor((i + 1) * bucketSize);
				const bucket = chronological.slice(start, end);
				if (bucket.length === 0) continue;
				const hasFailure = bucket.some((c) => !c.success);
				const pick = hasFailure
					? bucket.find((c) => !c.success)!
					: bucket.reduce((worst, c) =>
						(c.responseTime ?? 0) > (worst.responseTime ?? 0) ? c : worst,
					);
				sampled.push(pick);
			}
		}

		const successful = sampled.filter((c) => c.success);
		const hasSuccess = successful.length > 0;
		const okTimes = successful.map((c) => c.responseTime ?? 0);
		const maxTime = hasSuccess ? Math.max(...okTimes) : 0;
		const minTime = hasSuccess ? Math.min(...okTimes) : 0;
		const padding = 10;

		const getY = (check: ServiceCheck) => {
			if (!check.success) return FAILED_Y;
			if (!hasSuccess || maxTime === minTime) return 50;
			const rt = check.responseTime ?? 0;
			return (
				padding +
				((maxTime - rt) / (maxTime - minTime)) * (100 - padding * 2)
			);
		};

		const points = sampled.map((check, i) => ({
			x: (i / (sampled.length - 1 || 1)) * 100,
			y: getY(check),
			check,
		}));

		const lineSegments: string[] = [];
		let current = "";
		for (let i = 0; i < points.length; i++) {
			const p = points[i];
			if (!p.check.success) {
				if (current) {
					lineSegments.push(current);
					current = "";
				}
				continue;
			}
			current += `${current ? " L" : "M"} ${p.x} ${p.y}`;
		}
		if (current) lineSegments.push(current);

		const timeLabels: { x: number; label: string }[] = [];
		if (sampled.length > 0) {
			timeLabels.push({ x: 0, label: formatGraphDate(sampled[0].checkedAt) });
			if (sampled.length > 2) {
				timeLabels.push({
					x: 50,
					label: formatGraphDate(sampled[Math.floor(sampled.length / 2)].checkedAt),
				});
			}
			timeLabels.push({
				x: 100,
				label: formatGraphDate(sampled[sampled.length - 1].checkedAt),
			});
		}

		const yLabels = hasSuccess
			? [
				{ y: padding, label: formatTime(maxTime) },
				{ y: 50, label: formatTime((maxTime + minTime) / 2) },
				{ y: 100 - padding, label: formatTime(minTime) },
			]
			: [];

		return {
			points,
			lineSegments,
			maxTime,
			minTime,
			timeLabels,
			yLabels,
			hasSuccess,
		};
	});

	function formatGraphDate(date: string): string {
		const d = new Date(date);
		const now = new Date();
		const diffDays = Math.floor(
			(now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24),
		);

		const timeOpts: Intl.DateTimeFormatOptions = {
			timeZone: data.timezone,
			hour12: false,
			hour: "2-digit",
			minute: "2-digit",
		};

		if (diffDays === 0) {
			return d.toLocaleTimeString(undefined, timeOpts);
		}
		if (diffDays === 1) {
			return "Yesterday " + d.toLocaleTimeString(undefined, timeOpts);
		}
		return (
			d.toLocaleDateString(undefined, {
				timeZone: data.timezone,
				month: "short",
				day: "numeric",
			}) +
			" " +
			d.toLocaleTimeString(undefined, timeOpts)
		);
	}
</script>

<svelte:head>
	<title>{data.embed.title}</title>
	<meta name="description" content={data.embed.description} />
	<meta name="theme-color" content={embedColor} />
	<meta property="og:type" content="website" />
	<meta property="og:title" content={data.embed.title} />
	<meta property="og:description" content={data.embed.description} />
	<meta property="og:site_name" content={data.embed.siteName} />
	{#if canonicalUrl}
		<meta property="og:url" content={canonicalUrl} />
	{/if}
	<meta name="twitter:card" content="summary" />
	<meta name="twitter:title" content={data.embed.title} />
	<meta name="twitter:description" content={data.embed.description} />
</svelte:head>

<div class="container">
	<header class="header">
		<div class="header-left">
			<img src={siteIcon} alt="" class="site-icon" />
			<h1>
				<a href="/" class="brand-link"
					><span class="brand">{data.site.brand}</span>{data.site
						.suffix}</a
				>
			</h1>
			<nav class="nav">
				<a href="/" class="nav-link" class:active={!isGroupView}
					>index</a
				>
				<a href="/docs" class="nav-link">docs</a>
				{#if data.site.sourceUrl}
					<a
						href={data.site.sourceUrl}
						target="_blank"
						rel="noopener noreferrer"
						class="nav-link">source</a
					>
				{/if}
				{#if data.site.discordUrl}
					<a
						href={data.site.discordUrl}
						target="_blank"
						rel="noopener noreferrer"
						class="nav-link">discord</a
					>
				{/if}
			</nav>
		</div>
		<div class="header-actions">
			<ThemeToggle />
			{#if data.user}
				{#if editMode && !isGroupView}
					<div class="add-menu-container">
						<button
							type="button"
							class="btn sm"
							onclick={() => (showAddMenu = !showAddMenu)}
							aria-expanded={showAddMenu}
							aria-haspopup="menu"
						>
							add
						</button>
						{#if showAddMenu}
							<div class="add-menu" role="menu">
								<button
									type="button"
									class="add-menu-item"
									role="menuitem"
									onclick={() => {
										showAddMenu = false;
										openCreateModal(null);
									}}
								>
									service
								</button>
								<button
									type="button"
									class="add-menu-item"
									role="menuitem"
									onclick={() => {
										showAddMenu = false;
										creatingGroup = true;
									}}
								>
									group
								</button>
								<button
									type="button"
									class="add-menu-item"
									role="menuitem"
									onclick={() => {
										showAddMenu = false;
										creatingMasterGroup = true;
									}}
								>
									master group
								</button>
							</div>
						{/if}
					</div>
				{/if}
				{#if !isGroupView}
					<button
						type="button"
						class="btn sm edit-btn"
						class:primary={editMode}
						onclick={() => (editMode = !editMode)}
					>
						{editMode ? "done" : "edit"}
					</button>
				{/if}
				<UserMenu user={data.user} />
			{:else}
				<a href="/login" class="login-link">login</a>
			{/if}
		</div>
	</header>

	<main id="main-content" class="main centered" class:edit-mode={editMode}>
		{#if !data.services?.length}
			<div class="empty">
				{#if data.user}
					<p>No services configured yet.</p>
					<button
						type="button"
						class="add-link"
						onclick={() => openCreateModal()}
						>Add your first service</button
					>
				{:else}
					<p>No public services available.</p>
					<p class="login-hint">
						<a href="/login">Log in</a> to manage services.
					</p>
				{/if}
			</div>
		{:else}
			{#if overallUptime !== null}
				<div class="overall-uptime">
					<span class="uptime-label"
						>{isGroupView && data.isMasterGroup
							? "overall uptime"
							: isGroupView
								? "group uptime"
								: "overall uptime"}</span
					>
					<span
						class="uptime-value"
						class:is-success={overallUptime >= 90}
						class:is-warning={overallUptime >= 75 &&
							overallUptime < 90}
						class:is-error={overallUptime < 75}
						>{overallUptime.toFixed(2)}%</span
					>
				</div>
			{/if}

			{#if isGroupView && data.activeEvents && data.activeEvents.length > 0}
				<div class="active-events">
					{#each data.activeEvents as event}
						<div
							class="event-banner {getEventTypeClass(event.type)}"
						>
							<div class="event-header">
								<span class="event-type">{event.type}</span>
								<span class="event-status">{event.status}</span>
							</div>
							<h3 class="event-title">{event.title}</h3>
							{#if event.description}
								<p class="event-description">
									{event.description}
								</p>
							{/if}
							<span class="event-date"
								>started {formatEventDate(
									event.startedAt,
								)}</span
							>
						</div>
					{/each}
				</div>
			{/if}

			{#if isGroupView && showRecentEvents && data.recentEvents && data.recentEvents.length > 0}
				<div class="recent-events">
					<h3>recent events</h3>
					<div class="events-list">
						{#each data.recentEvents as event}
							<div
								class="event-item {getEventTypeClass(
									event.type,
								)}"
								class:resolved={event.status === "resolved"}
							>
								<div class="event-item-header">
									<span class="event-type">{event.type}</span>
									<span class="event-status"
										>{event.status}</span
									>
									<span class="event-date"
										>{formatEventDate(
											event.startedAt,
										)}</span
									>
								</div>
								<h4 class="event-title">{event.title}</h4>
								{#if event.description}
									<p class="event-description">
										{event.description}
									</p>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/if}

			{#each displayGroups as group, groupIndex (group.name)}
				{@const services = groupedServices.groups[group.name] || []}
				{#if services.length > 0 || editMode}
					<div class="service-group">
						<div class="group-header">
							{#if editingGroupName === group.name}
								<div class="group-rename-form">
									<input
										type="text"
										bind:value={newGroupName}
										class="group-rename-input"
										onkeydown={(e) => {
											if (e.key === "Enter")
												saveGroupName();
											if (e.key === "Escape")
												closeRenameGroup();
										}}
									/>
									<button
										type="button"
										class="btn sm"
										onclick={saveGroupName}>save</button
									>
									<button
										type="button"
										class="btn sm"
										onclick={closeRenameGroup}
										>cancel</button
									>
								</div>
							{:else}
								<a href="/{encodeURIComponent(group.name)}"
									><h2 class="group-title">
										{group.name}
									</h2></a
								>
								{#if editMode && !isGroupView}
									<div class="group-actions">
										<button
											type="button"
											class="btn sm icon-btn"
											onclick={() =>
												openCreateModal(group.name)}
											title="Add service"
											aria-label="Add service to {group.name}"
											><span
												class="btn-icon"
												aria-hidden="true">+</span
											><span class="btn-text">add</span
											></button
										>
										<button
											type="button"
											class="btn sm icon-btn"
											disabled={groupIndex === 0}
											onclick={() =>
												moveGroupUp(group.name)}
											title="Move up"
											aria-label="Move {group.name} up"
											><span
												class="btn-icon"
												aria-hidden="true">▲</span
											></button
										>
										<button
											type="button"
											class="btn sm icon-btn"
											disabled={groupIndex ===
												displayGroups.length - 1}
											onclick={() =>
												moveGroupDown(group.name)}
											title="Move down"
											aria-label="Move {group.name} down"
											><span
												class="btn-icon"
												aria-hidden="true">▼</span
											></button
										>
										<button
											type="button"
											class="btn sm icon-btn"
											onclick={() =>
												openRenameGroup(group.name)}
											title="Rename group"
											aria-label="Rename {group.name}"
											><span
												class="btn-icon"
												aria-hidden="true">/</span
											><span class="btn-text">rename</span
											></button
										>
										{#if data.user?.role === "admin"}
											<button
												type="button"
												class="btn sm icon-btn"
												class:active={group.emailNotifications}
												onclick={() =>
													toggleGroupEmail(
														group.name,
														!group.emailNotifications,
													)}
												title={group.emailNotifications
													? "Disable email notifications"
													: "Enable email notifications"}
												aria-label={group.emailNotifications
													? `Disable email notifications for ${group.name}`
													: `Enable email notifications for ${group.name}`}
												aria-pressed={group.emailNotifications}
												><span
													class="btn-icon"
													aria-hidden="true">✉</span
												><span class="btn-text"
													>{group.emailNotifications
														? "on"
														: "off"}</span
												></button
											>
										{/if}
										<select
											class="parent-select"
											value={group.parentGroupName ?? ""}
											onchange={(e) =>
												setGroupParent(
													group.name,
													e.currentTarget.value ||
														null,
												)}
											title="Set parent group"
											aria-label="Set parent group for {group.name}"
										>
											<option value="">no parent</option>
											{#each getAvailableParents(group.name) as parent}
												<option value={parent.name}
													>{parent.name}</option
												>
											{/each}
										</select>
										<button
											type="button"
											class="btn sm danger icon-btn"
											onclick={() =>
												deleteGroup(group.name)}
											title="Delete group"
											aria-label="Delete {group.name}"
											><span
												class="btn-icon"
												aria-hidden="true">✕</span
											><span class="btn-text">delete</span
											></button
										>
									</div>
								{/if}
							{/if}
							{#if groupUptime[group.name] !== null && groupUptime[group.name] !== undefined}
								<span
									class="group-uptime"
									class:is-success={groupUptime[
										group.name
									]! >= 90}
									class:is-warning={groupUptime[
										group.name
									]! >= 75 && groupUptime[group.name]! < 90}
									class:is-error={groupUptime[group.name]! <
										75}
									>{groupUptime[group.name]?.toFixed(
										2,
									)}%</span
								>
							{/if}
						</div>
						<div
							class="services-list"
							ondragover={(e) => {
								if (draggedService) {
									e.preventDefault();
								}
							}}
							ondrop={(e) =>
								handleServiceDrop(e, null, group.name)}
							role="list"
						>
							{#each services as service (service.id)}
								{@const check = checks[service.id]}
								{@const serviceUptime =
									data.uptime?.[service.id]}
								<div
									class="service-item"
									class:edit-mode={editMode}
								>
									<div
										class="service-card"
										class:dragging={draggedService?.id ===
											service.id}
										draggable={editMode && !isGroupView}
										ondragstart={(e) =>
											handleServiceDragStart(e, service)}
										ondragend={handleServiceDragEnd}
										ondragover={(e) => {
											if (
												draggedService &&
												draggedService.id !== service.id
											)
												e.preventDefault();
										}}
										ondrop={(e) =>
											handleServiceDrop(
												e,
												service,
												group.name,
											)}
										onclick={() =>
											openServiceDetail(service)}
										onkeydown={(e) => {
											if (
												e.key === "Enter" ||
												e.key === " "
											) {
												e.preventDefault();
												openServiceDetail(service);
											}
										}}
										role="button"
										tabindex="0"
									>
										{#if serviceUptime && serviceUptime.totalChecks > 0}
											<span
												class="service-uptime"
												class:is-success={serviceUptime.uptimePercent >=
													90}
												class:is-warning={serviceUptime.uptimePercent >=
													75 &&
													serviceUptime.uptimePercent <
														90}
												class:is-error={serviceUptime.uptimePercent <
													75}
												>{serviceUptime.uptimePercent.toFixed(
													1,
												)}%</span
											>
										{/if}
										<div class="service-info">
											<div class="service-header">
												<h3>{service.name}</h3>
												{#if data.user && !service.isPublic}
													<span
														class="visibility-badge private"
														>private</span
													>
												{/if}
											</div>
											<a
												href={service.displayUrl ||
													service.url}
												target="_blank"
												rel="noopener noreferrer"
												class="url"
												onclick={(e) =>
													e.stopPropagation()}
												>{service.displayUrl ||
													service.url}</a
											>
											<div class="meta">
												{#if check}
													<span class="response-time"
														>{formatTime(
															check.responseTime,
														)}</span
													>
													<span
														class="status-code"
														class:success={check.success}
														class:error={!check.success}
														>{check.statusCode ??
															"error"}</span
													>
													<span class="last-check"
														>checked {formatDate(
															check.checkedAt,
														)}</span
													>
												{:else}
													<span class="pending-text"
														>pending first check</span
													>
												{/if}
											</div>
											{#if service.description}
												{#if service.description.startsWith("http://") || service.description.startsWith("https://")}
													<a
														href={service.description}
														target="_blank"
														rel="noopener noreferrer"
														class="description description-link"
														onclick={(e) =>
															e.stopPropagation()}
														>{service.description}</a
													>
												{:else}
													<p class="description">
														{service.description}
													</p>
												{/if}
											{/if}
										</div>
										{#if editMode && !isGroupView}
											<div class="service-actions">
												<button
													type="button"
													class="btn sm icon-btn"
													title="Edit service"
													aria-label="Edit {service.name}"
													onclick={(e) => {
														e.stopPropagation();
														editingService = service;
													}}
													><span
														class="btn-icon"
														aria-hidden="true">/</span
													><span class="btn-text"
														>edit</span
													></button
												>
												<form
													method="POST"
													action="/?/delete"
													class="action-form"
													use:enhance
												>
													<input
														type="hidden"
														name="id"
														value={service.id}
													/>
													<button
														type="submit"
														class="btn sm danger icon-btn"
														title="Delete service"
														aria-label="Delete {service.name}"
														><span
															class="btn-icon"
															aria-hidden="true"
															>✕</span
														><span class="btn-text"
															>delete</span
														></button
													>
												</form>
											</div>
										{/if}
									</div>
								</div>
							{/each}
						</div>
					</div>
				{/if}
			{/each}

			{#if !isGroupView && (groupedServices.ungrouped.length > 0 || editMode)}
				<div
					class="services-list"
					class:has-groups={Object.keys(groupedServices.groups)
						.length > 0}
					ondragover={(e) => {
						if (draggedService) {
							e.preventDefault();
						}
					}}
					ondrop={(e) => handleServiceDrop(e, null, null)}
					role="list"
				>
					{#each groupedServices.ungrouped as service (service.id)}
						{@const check = checks[service.id]}
						{@const serviceUptime = data.uptime?.[service.id]}
						<div class="service-item" class:edit-mode={editMode}>
							<div
								class="service-card"
								class:dragging={draggedService?.id ===
									service.id}
								draggable={editMode}
								ondragstart={(e) =>
									handleServiceDragStart(e, service)}
								ondragend={handleServiceDragEnd}
								ondragover={(e) => {
									if (
										draggedService &&
										draggedService.id !== service.id
									)
										e.preventDefault();
								}}
								ondrop={(e) =>
									handleServiceDrop(e, service, null)}
								onclick={() => openServiceDetail(service)}
								onkeydown={(e) => {
									if (e.key === "Enter" || e.key === " ") {
										e.preventDefault();
										openServiceDetail(service);
									}
								}}
								role="button"
								tabindex="0"
							>
								{#if serviceUptime && serviceUptime.totalChecks > 0}
									<span
										class="service-uptime"
										class:is-success={serviceUptime.uptimePercent >=
											90}
										class:is-warning={serviceUptime.uptimePercent >=
											75 &&
											serviceUptime.uptimePercent < 90}
										class:is-error={serviceUptime.uptimePercent <
											75}
										>{serviceUptime.uptimePercent.toFixed(
											1,
										)}%</span
									>
								{/if}
								<div class="service-info">
									<div class="service-header">
										<h3>{service.name}</h3>
										{#if data.user && !service.isPublic}
											<span
												class="visibility-badge private"
												>private</span
											>
										{/if}
									</div>
									<a
										href={service.displayUrl || service.url}
										target="_blank"
										rel="noopener noreferrer"
										class="url"
										onclick={(e) => e.stopPropagation()}
										>{service.displayUrl || service.url}</a
									>
									<div class="meta">
										{#if check}
											<span class="response-time"
												>{formatTime(
													check.responseTime,
												)}</span
											>
											<span
												class="status-code"
												class:success={check.success}
												class:error={!check.success}
												>{check.statusCode ??
													"error"}</span
											>
											<span class="last-check"
												>checked {formatDate(
													check.checkedAt,
												)}</span
											>
										{:else}
											<span class="pending-text"
												>pending first check</span
											>
										{/if}
									</div>
									{#if service.description}
										{#if service.description.startsWith("http://") || service.description.startsWith("https://")}
											<a
												href={service.description}
												target="_blank"
												rel="noopener noreferrer"
												class="description description-link"
												onclick={(e) =>
													e.stopPropagation()}
												>{service.description}</a
											>
										{:else}
											<p class="description">
												{service.description}
											</p>
										{/if}
									{/if}
								</div>
								{#if editMode}
									<div class="service-actions">
										<button
											type="button"
											class="btn sm icon-btn"
											title="Edit service"
											aria-label="Edit {service.name}"
											onclick={(e) => {
												e.stopPropagation();
												editingService = service;
											}}
											><span
												class="btn-icon"
												aria-hidden="true">/</span
											><span class="btn-text">edit</span
											></button
										>
										<form
											method="POST"
											action="/?/delete"
											class="action-form"
											use:enhance
										>
											<input
												type="hidden"
												name="id"
												value={service.id}
											/>
											<button
												type="submit"
												class="btn sm danger icon-btn"
												title="Delete service"
												aria-label="Delete {service.name}"
												><span
													class="btn-icon"
													aria-hidden="true">✕</span
												><span class="btn-text">delete</span
												></button
											>
										</form>
									</div>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	</main>
</div>

{#if selectedService}
	<div
		class="modal-overlay"
		onclick={closeModal}
		onkeydown={(e) => e.key === "Escape" && closeModal()}
		role="presentation"
	>
		<div
			class="modal"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
			role="dialog"
			aria-modal="true"
			tabindex="-1"
		>
			<div class="modal-header">
				<div class="modal-title">
					<h2>{selectedService.name}</h2>
					<span
						class="modal-status"
						class:success={checks[selectedService.id]?.success}
						class:error={checks[selectedService.id] &&
							!checks[selectedService.id]?.success}
					>
						{checks[selectedService.id]?.success
							? "operational"
							: "degraded"}
					</span>
				</div>
				<button
					type="button"
					class="modal-close"
					onclick={closeModal}
					aria-label="Close modal">&times;</button
				>
			</div>

			<div class="modal-body">
				{#if loading}
					<div class="loading">Loading...</div>
				{:else}
					{#if serviceStats}
						<div class="stats-grid">
							<div class="stat">
								<span
									class="stat-value"
									class:is-success={serviceStats.uptimePercent >=
										90}
									>{serviceStats.uptimePercent.toFixed(
										2,
									)}%</span
								>
								<span class="stat-label">uptime (24h)</span>
							</div>
							<div class="stat">
								<span class="stat-value"
									>{formatTime(
										serviceStats.avgResponseTime,
									)}</span
								>
								<span class="stat-label">avg response</span>
							</div>
							<div class="stat">
								<span class="stat-value"
									>{serviceStats.totalChecks}</span
								>
								<span class="stat-label">checks (24h)</span>
							</div>
							<div class="stat">
								<span class="stat-value"
									>{formatTime(serviceStats.minResponseTime)} -
									{formatTime(
										serviceStats.maxResponseTime,
									)}</span
								>
								<span class="stat-label">response range</span>
							</div>
						</div>
					{/if}

					{#if serviceChecks.length > 1}
						<div class="graph-section">
							<h3>
								Response Time ({graphData.points.length} checks)
							</h3>
							<div class="graph-wrapper">
								<div class="y-axis">
									{#each graphData.yLabels as label}
										<span style="top: {label.y}%"
											>{label.label}</span
										>
									{/each}
								</div>
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div
									class="graph-container"
									onmouseleave={() => (hoveredPoint = null)}
								>
									<svg
										viewBox="0 0 100 100"
										preserveAspectRatio="none"
										class="graph"
									>
										<line
											x1="0"
											y1="10"
											x2="100"
											y2="10"
											class="grid-line"
										/>
										<line
											x1="0"
											y1="30"
											x2="100"
											y2="30"
											class="grid-line"
										/>
										<line
											x1="0"
											y1="50"
											x2="100"
											y2="50"
											class="grid-line"
										/>
										<line
											x1="0"
											y1="70"
											x2="100"
											y2="70"
											class="grid-line"
										/>
										<line
											x1="0"
											y1="90"
											x2="100"
											y2="90"
											class="grid-line"
										/>
										<line
											x1="0"
											y1="0"
											x2="0"
											y2="100"
											class="grid-line"
										/>
										<line
											x1="25"
											y1="0"
											x2="25"
											y2="100"
											class="grid-line"
										/>
										<line
											x1="50"
											y1="0"
											x2="50"
											y2="100"
											class="grid-line"
										/>
										<line
											x1="75"
											y1="0"
											x2="75"
											y2="100"
											class="grid-line"
										/>
										<line
											x1="100"
											y1="0"
											x2="100"
											y2="100"
											class="grid-line"
										/>
										{#each graphData.lineSegments as segment}
											<path
												d={segment}
												fill="none"
												stroke="var(--color-accent)"
												stroke-width="1.5"
												stroke-linejoin="round"
												stroke-linecap="round"
												vector-effect="non-scaling-stroke"
											/>
										{/each}
										{#each graphData.points as point}
											<circle
												cx={point.x}
												cy={point.y}
												r="6"
												fill="transparent"
												class="data-point-hitbox"
												onmouseenter={() =>
													(hoveredPoint = {
														check: point.check,
														x: point.x,
														y: point.y,
													})}
											/>
											<circle
												cx={point.x}
												cy={point.y}
												r="1.5"
												fill={point.check.success
													? "var(--color-success)"
													: "var(--color-error)"}
												class="data-point"
												role="img"
											/>
										{/each}
									</svg>

									{#if hoveredPoint}
										{@const showBelow = hoveredPoint.y < 30}
										{@const alignLeft = hoveredPoint.x > 80}
										{@const alignRight =
											hoveredPoint.x < 20}
										<div
											class="graph-tooltip"
											class:below={showBelow}
											class:align-left={alignLeft}
											class:align-right={alignRight}
											style="left: {hoveredPoint.x}%; top: {hoveredPoint.y}%"
										>
											<div class="tooltip-time">
												{formatDate(
													hoveredPoint.check
														.checkedAt,
												)}
											</div>
											<div class="tooltip-response">
												<span class="tooltip-label"
													>Response:</span
												>
												<span class="tooltip-value"
													>{formatTime(
														hoveredPoint.check
															.responseTime,
													)}</span
												>
											</div>
											<div class="tooltip-status">
												<span class="tooltip-label"
													>Status:</span
												>
												<span
													class="tooltip-value"
													class:success={hoveredPoint
														.check.success}
													class:error={!hoveredPoint
														.check.success}
												>
													{hoveredPoint.check
														.statusCode ?? "error"}
												</span>
											</div>
											{#if hoveredPoint.check.errorMessage}
												<div class="tooltip-error">
													{hoveredPoint.check
														.errorMessage}
												</div>
											{/if}
										</div>
									{/if}
								</div>
								<div class="x-axis">
									{#each graphData.timeLabels as label}
										<span style="left: {label.x}%"
											>{label.label}</span
										>
									{/each}
								</div>
							</div>
						</div>
					{/if}

					<div class="checks-section">
						<h3>Recent Checks</h3>
						<div class="checks-list">
							{#each serviceChecks.slice(0, 20) as check}
								<div
									class="check-item"
									class:success={check.success}
									class:error={!check.success}
								>
									<span class="check-status-dot"></span>
									<span class="check-time"
										>{formatShortTime(
											check.checkedAt,
										)}</span
									>
									<span class="check-response"
										>{formatTime(check.responseTime)}</span
									>
									<span class="check-code"
										>{check.statusCode ?? "err"}</span
									>
									{#if check.errorMessage}
										<span class="check-error"
											>{check.errorMessage}</span
										>
									{/if}
								</div>
							{/each}
						</div>
					</div>

					<div class="info-section">
						<h3>Service Info</h3>
						<dl class="info-list">
							<dt>URL</dt>
							<dd>
								<a
									href={selectedService.displayUrl ||
										selectedService.url}
									target="_blank"
									rel="noopener noreferrer"
									>{selectedService.displayUrl ||
										selectedService.url}</a
								>
							</dd>
							{#if selectedService.displayUrl}
								<dt>Check URL</dt>
								<dd>
									<a
										href={selectedService.url}
										target="_blank"
										rel="noopener noreferrer"
										>{selectedService.url}</a
									>
								</dd>
							{/if}
							{#if selectedService.description}
								<dt>Description</dt>
								<dd>{selectedService.description}</dd>
							{/if}
							<dt>Expected Status</dt>
							<dd>{selectedService.expectedStatus}</dd>
							{#if selectedService.expectedContentType}
								<dt>Expected Content-Type</dt>
								<dd>{selectedService.expectedContentType}</dd>
							{/if}
							{#if selectedService.expectedBody}
								<dt>Expected Body</dt>
								<dd>
									<pre
										class="expected-body">{selectedService.expectedBody}</pre>
								</dd>
							{/if}
							<dt>Check Interval</dt>
							<dd>{selectedService.checkInterval}s</dd>
						</dl>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

{#if editingService}
	<div
		class="modal-overlay"
		onclick={closeEditModal}
		onkeydown={(e) => e.key === "Escape" && closeEditModal()}
		role="presentation"
	>
		<div
			class="modal edit-modal"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
			role="dialog"
			aria-modal="true"
			tabindex="-1"
		>
			<div class="modal-header">
				<h2>edit service</h2>
				<button
					type="button"
					class="modal-close"
					onclick={closeEditModal}
					aria-label="Close modal">&times;</button
				>
			</div>

			{#if form?.editError}
				<div class="error-message" role="alert">{form.editError}</div>
			{/if}

			<form
				method="POST"
				action="/?/edit"
				class="form"
				use:enhance={handleFormResult}
			>
				<input type="hidden" name="id" value={editingService.id} />

				<div class="form-group">
					<input
						type="text"
						id="edit-name"
						name="name"
						placeholder=" "
						value={editingService.name}
						required
					/>
					<label for="edit-name">Service Name</label>
				</div>

				<div class="form-group">
					<input
						type="url"
						id="edit-url"
						name="url"
						placeholder=" "
						value={editingService.url}
						required
					/>
					<label for="edit-url">Check URL</label>
				</div>

				<div class="form-group">
					<input
						type="text"
						id="edit-displayUrl"
						name="displayUrl"
						placeholder=" "
						value={editingService.displayUrl ?? ""}
					/>
					<label for="edit-displayUrl">Display URL (optional)</label>
				</div>

				<div class="form-group">
					<input
						type="text"
						id="edit-description"
						name="description"
						placeholder=" "
						value={editingService.description ?? ""}
					/>
					<label for="edit-description">Description (optional)</label>
				</div>

				<div class="form-row">
					<div class="form-group">
						<input
							type="number"
							id="edit-expectedStatus"
							name="expectedStatus"
							value={editingService.expectedStatus}
							min="100"
							max="599"
							required
						/>
						<label for="edit-expectedStatus">Expected Status</label>
					</div>

					<div class="form-group">
						<input
							type="number"
							id="edit-checkInterval"
							name="checkInterval"
							value={editingService.checkInterval}
							min="10"
							max="3600"
							required
						/>
						<label for="edit-checkInterval">Interval (sec)</label>
					</div>
				</div>

				<div class="form-group">
					<input
						type="text"
						id="edit-expectedContentType"
						name="expectedContentType"
						placeholder=" "
						value={editingService.expectedContentType ?? ""}
					/>
					<label for="edit-expectedContentType"
						>Expected Content-Type (optional)</label
					>
				</div>

				<div class="form-group">
					<textarea
						id="edit-expectedBody"
						name="expectedBody"
						placeholder=" "
						rows="3">{editingService.expectedBody ?? ""}</textarea
					>
					<label for="edit-expectedBody"
						>Expected Body (optional)</label
					>
				</div>

				<div class="form-group">
					<input
						type="text"
						id="edit-groupName"
						name="groupName"
						placeholder=" "
						value={editingService.groupName ?? ""}
					/>
					<label for="edit-groupName">Group (optional)</label>
				</div>

				<div class="form-group checkbox-group">
					<label class="checkbox-label">
						<input
							type="checkbox"
							name="enabled"
							checked={editingService.enabled}
						/>
						enable monitoring
					</label>
					<label class="checkbox-label">
						<input
							type="checkbox"
							name="isPublic"
							checked={editingService.isPublic}
						/>
						public (visible to everyone)
					</label>
					{#if data.user?.role === "admin"}
						<label class="checkbox-label">
							<input
								type="checkbox"
								name="emailNotifications"
								checked={editingService.emailNotifications}
							/>
							email notifications
						</label>
					{/if}
				</div>

				<div class="form-actions">
					<button type="button" class="btn" onclick={closeEditModal}
						>cancel</button
					>
					<button type="submit" class="btn primary"
						>save changes</button
					>
				</div>
			</form>
		</div>
	</div>
{/if}

{#if creatingService}
	<div
		class="modal-overlay"
		onclick={closeCreateModal}
		onkeydown={(e) => e.key === "Escape" && closeCreateModal()}
		role="presentation"
	>
		<div
			class="modal edit-modal"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
			role="dialog"
			aria-modal="true"
			tabindex="-1"
		>
			<div class="modal-header">
				<h2>add service</h2>
				<button
					type="button"
					class="modal-close"
					onclick={closeCreateModal}
					aria-label="Close modal">&times;</button
				>
			</div>

			{#if form?.createError}
				<div class="error-message" role="alert">{form.createError}</div>
			{/if}

			<form
				method="POST"
				action="/?/create"
				class="form"
				use:enhance={handleFormResult}
			>
				<div class="form-group">
					<input
						type="text"
						id="create-name"
						name="name"
						placeholder=" "
						required
					/>
					<label for="create-name">Service Name</label>
				</div>

				<div class="form-group">
					<input
						type="url"
						id="create-url"
						name="url"
						placeholder=" "
						required
					/>
					<label for="create-url">Check URL</label>
				</div>

				<div class="form-group">
					<input
						type="text"
						id="create-displayUrl"
						name="displayUrl"
						placeholder=" "
					/>
					<label for="create-displayUrl">Display URL (optional)</label
					>
				</div>

				<div class="form-group">
					<input
						type="text"
						id="create-description"
						name="description"
						placeholder=" "
					/>
					<label for="create-description"
						>Description (optional)</label
					>
				</div>

				<div class="form-row">
					<div class="form-group">
						<input
							type="number"
							id="create-expectedStatus"
							name="expectedStatus"
							value="200"
							min="100"
							max="599"
							required
						/>
						<label for="create-expectedStatus"
							>Expected Status</label
						>
					</div>

					<div class="form-group">
						<input
							type="number"
							id="create-checkInterval"
							name="checkInterval"
							value="60"
							min="10"
							max="3600"
							required
						/>
						<label for="create-checkInterval">Interval (sec)</label>
					</div>
				</div>

				<div class="form-group">
					<input
						type="text"
						id="create-expectedContentType"
						name="expectedContentType"
						placeholder=" "
					/>
					<label for="create-expectedContentType"
						>Expected Content-Type (optional)</label
					>
				</div>

				<div class="form-group">
					<textarea
						id="create-expectedBody"
						name="expectedBody"
						placeholder=" "
						rows="3"
					></textarea>
					<label for="create-expectedBody"
						>Expected Body (optional)</label
					>
				</div>

				<div class="form-group">
					<input
						type="text"
						id="create-groupName"
						name="groupName"
						placeholder=" "
						value={creatingInGroup ?? ""}
					/>
					<label for="create-groupName">Group (optional)</label>
				</div>

				<div class="form-group checkbox-group">
					<label class="checkbox-label">
						<input type="checkbox" name="enabled" checked />
						enable monitoring
					</label>
					<label class="checkbox-label">
						<input type="checkbox" name="isPublic" />
						public (visible to everyone)
					</label>
					{#if data.user?.role === "admin"}
						<label class="checkbox-label">
							<input type="checkbox" name="emailNotifications" />
							email notifications
						</label>
					{/if}
				</div>

				<div class="form-actions">
					<button type="button" class="btn" onclick={closeCreateModal}
						>cancel</button
					>
					<button type="submit" class="btn primary"
						>add service</button
					>
				</div>
			</form>
		</div>
	</div>
{/if}

{#if creatingGroup}
	<div
		class="modal-overlay"
		onclick={() => (creatingGroup = false)}
		onkeydown={(e) => e.key === "Escape" && (creatingGroup = false)}
		role="presentation"
	>
		<div
			class="modal"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
			role="dialog"
			aria-modal="true"
			tabindex="-1"
		>
			<div class="modal-header">
				<h2>add group</h2>
				<button
					type="button"
					class="modal-close"
					onclick={() => (creatingGroup = false)}
					aria-label="Close modal">&times;</button
				>
			</div>

			<div class="modal-body">
				<div class="form">
					<div class="form-group">
						<input
							type="text"
							id="new-group-name"
							placeholder=" "
							bind:value={newGroupInput}
							onkeydown={(e) => {
								if (e.key === "Enter") createGroup();
								if (e.key === "Escape") creatingGroup = false;
							}}
						/>
						<label for="new-group-name">Group Name</label>
					</div>

					{#if masterGroupsList.length > 0}
						<div class="form-group">
							<select
								id="parent-group-select"
								bind:value={selectedMasterForSubGroup}
							>
								<option value={null}
									>-- No Parent (standalone group) --</option
								>
								{#each masterGroupsList as master}
									<option value={master.name}
										>{master.name}</option
									>
								{/each}
							</select>
							<label for="parent-group-select"
								>Parent Master Group (optional)</label
							>
						</div>
					{/if}

					<div class="form-actions">
						<button
							type="button"
							class="btn"
							onclick={() => (creatingGroup = false)}
						>
							cancel
						</button>
						<button
							type="button"
							class="btn primary"
							onclick={createGroup}
							disabled={!newGroupInput.trim()}
						>
							create group
						</button>
					</div>
				</div>
			</div>
		</div>
	</div>
{/if}

{#if creatingMasterGroup}
	<div
		class="modal-overlay"
		onclick={() => (creatingMasterGroup = false)}
		onkeydown={(e) => e.key === "Escape" && (creatingMasterGroup = false)}
		role="presentation"
	>
		<div
			class="modal"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
			role="dialog"
			aria-modal="true"
			tabindex="-1"
		>
			<div class="modal-header">
				<h2>add master group</h2>
				<button
					type="button"
					class="modal-close"
					onclick={() => (creatingMasterGroup = false)}
					aria-label="Close modal">&times;</button
				>
			</div>

			<div class="modal-body">
				<p class="modal-hint">
					A master group contains sub-groups. After creating it, you
					can assign groups to it.
				</p>
				<div class="form">
					<div class="form-group">
						<input
							type="text"
							id="new-master-group-name"
							placeholder=" "
							bind:value={newMasterGroupInput}
							onkeydown={(e) => {
								if (e.key === "Enter") createMasterGroup();
								if (e.key === "Escape")
									creatingMasterGroup = false;
							}}
						/>
						<label for="new-master-group-name"
							>Master Group Name</label
						>
					</div>

					<div class="form-actions">
						<button
							type="button"
							class="btn"
							onclick={() => (creatingMasterGroup = false)}
						>
							cancel
						</button>
						<button
							type="button"
							class="btn primary"
							onclick={createMasterGroup}
							disabled={!newMasterGroupInput.trim()}
						>
							create master group
						</button>
					</div>
				</div>
			</div>
		</div>
	</div>
{/if}
