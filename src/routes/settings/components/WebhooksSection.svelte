<script lang="ts">
	import { enhance } from "$app/forms";
	import { notifications } from "$lib";
	import type { Webhook, Group, SiteSettings } from "$lib";
	import WebhookItem from "./WebhookItem.svelte";

	const {
		webhooks,
		groups,
		settings,
	}: {
		webhooks: Webhook[];
		groups: Group[];
		settings: SiteSettings | null;
	} = $props();

	let editingId = $state<string | null>(null);
	let createType = $state<"discord" | "webhook">("discord");
	let createIsGlobal = $state(true);
	let createGroups = $state<string[]>([]);
	let editTypes = $state<Record<string, "discord" | "webhook">>({});
	let editIsGlobal = $state<Record<string, boolean>>({});
	let editGroups = $state<Record<string, string[]>>({});

	const globalWebhooks = $derived(webhooks.filter((w) => w.isGlobal));
	const groupWebhooks = $derived(webhooks.filter((w) => !w.isGlobal));

	let retryCount = $state(0);
	let smtpHost = $state("");
	let smtpPort = $state("587");
	let smtpUser = $state("");
	let smtpPass = $state("");
	let smtpFrom = $state("");
	let smtpSecure = $state(false);
	let smtpEnabled = $state(false);
	let emailTo = $state("");
	let emailIsGlobal = $state(true);
	let emailGroups = $state<string[]>([]);

	let sendingTestEmail = $state(false);
	let testEmailError = $state("");
	let testEmailSuccess = $state(false);

	const portWarning = $derived.by(() => {
		const port = parseInt(smtpPort, 10);
		if (smtpSecure && (port === 587 || port === 25 || port === 2525)) {
			return `port ${port} typically uses STARTTLS, not SSL/TLS. try disabling "use ssl/tls" or use port 465.`;
		}
		if (!smtpSecure && port === 465) {
			return `port 465 typically requires SSL/TLS. try enabling "use ssl/tls" or use port 587.`;
		}
		return null;
	});

	$effect(() => {
		if (settings) {
			retryCount = settings.retryCount || 0;
			smtpHost = settings.smtpHost || "";
			smtpPort = settings.smtpPort || "587";
			smtpUser = settings.smtpUser || "";
			smtpPass = settings.smtpPass || "";
			smtpFrom = settings.smtpFrom || "";
			smtpSecure = settings.smtpSecure || false;
			smtpEnabled = settings.smtpEnabled || false;
			emailTo = settings.emailTo || "";
			emailIsGlobal = settings.emailIsGlobal !== false;
			emailGroups = settings.emailGroups || [];
		}
	});

	async function sendTestEmail() {
		if (sendingTestEmail) return;
		sendingTestEmail = true;
		testEmailError = "";
		testEmailSuccess = false;

		try {
			const response = await fetch("?/testEmail", {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
			});
			const result = await response.json();

			if (result.type === "success") {
				testEmailSuccess = true;
			} else {
				testEmailError = result.data?.emailError || result.error || "failed to send test email";
			}
		} catch (err) {
			testEmailError = err instanceof Error ? err.message : "failed to send test email";
		} finally {
			sendingTestEmail = false;
		}
	}

	function toggleEmailGroup(groupName: string) {
		if (emailGroups.includes(groupName)) {
			emailGroups = emailGroups.filter((g) => g !== groupName);
		} else {
			emailGroups = [...emailGroups, groupName];
		}
	}

	function toggleCreateGroup(groupName: string) {
		if (createGroups.includes(groupName)) {
			createGroups = createGroups.filter((g) => g !== groupName);
		} else {
			createGroups = [...createGroups, groupName];
		}
	}

</script>

<section class="settings-section">
	<h3>retry</h3>

	<form
		method="POST"
		action="?/updateSiteSettings"
		class="form"
		use:enhance={() => {
			return async ({ result, update }) => {
				if (result.type === "success") {
					notifications.success("retry settings saved");
					await update();
				} else if (result.type === "failure") {
					const error = result.data?.siteError as string | undefined;
					notifications.error(error || "failed to save retry settings");
				}
			};
		}}
	>
		<div class="form-group">
			<input
				type="number"
				id="retryCount"
				name="retryCount"
				placeholder=" "
				min="0"
				max="10"
				bind:value={retryCount}
			/>
			<label for="retryCount">retry count (0-10)</label>
			<p class="field-hint">failed checks before sending notifications</p>
		</div>

		<button type="submit" class="btn">save</button>
	</form>
</section>

<section class="settings-section">
	<h3>email</h3>

	{#if portWarning}
		<div class="warning-banner">{portWarning}</div>
	{/if}

	<form
		method="POST"
		action="?/updateSiteSettings"
		class="form"
		use:enhance={() => {
			return async ({ result, update }) => {
				if (result.type === "success") {
					notifications.success("email settings saved");
					await update();
				} else if (result.type === "failure") {
					const error = result.data?.siteError as string | undefined;
					notifications.error(error || "failed to save email settings");
				}
			};
		}}
	>
		<div class="checkbox-group">
			<label class="checkbox-label">
				<input type="checkbox" name="smtpEnabled" bind:checked={smtpEnabled} />
				enable email notifications
			</label>
			<label class="checkbox-label">
				<input type="checkbox" name="smtpSecure" bind:checked={smtpSecure} />
				use ssl/tls
			</label>
		</div>

		<div class="form-group">
			<input type="text" id="smtpHost" name="smtpHost" placeholder=" " bind:value={smtpHost} />
			<label for="smtpHost">smtp host</label>
		</div>

		<div class="form-group">
			<input type="text" id="smtpPort" name="smtpPort" placeholder=" " bind:value={smtpPort} />
			<label for="smtpPort">smtp port</label>
		</div>

		<div class="form-group">
			<input type="text" id="smtpUser" name="smtpUser" placeholder=" " bind:value={smtpUser} />
			<label for="smtpUser">smtp username</label>
		</div>

		<div class="form-group">
			<input type="password" id="smtpPass" name="smtpPass" placeholder=" " bind:value={smtpPass} />
			<label for="smtpPass">smtp password</label>
		</div>

		<div class="form-group">
			<input type="email" id="smtpFrom" name="smtpFrom" placeholder=" " bind:value={smtpFrom} />
			<label for="smtpFrom">from address</label>
		</div>

		<div class="form-group">
			<input type="email" id="emailTo" name="emailTo" placeholder=" " bind:value={emailTo} />
			<label for="emailTo">notification recipient</label>
		</div>

		<div class="scope-section">
			<span class="scope-label">scope</span>
			<input type="hidden" name="emailIsGlobal" value={emailIsGlobal} />
			<input type="hidden" name="emailGroups" value={JSON.stringify(emailGroups)} />
			<div class="scope-options">
				<label class="checkbox-label">
					<input type="checkbox" bind:checked={emailIsGlobal} />
					global (all groups)
				</label>
				{#if !emailIsGlobal}
					<div class="group-checkboxes">
						{#each groups as group (group.id)}
							<label class="checkbox-label">
								<input
									type="checkbox"
									checked={emailGroups.includes(group.name)}
									onchange={() => toggleEmailGroup(group.name)}
								/>
								{group.name}
							</label>
						{/each}
					</div>
				{/if}
			</div>
		</div>

		<div class="form-actions">
			<button type="submit" class="btn">save email settings</button>
			<button type="button" class="btn" onclick={sendTestEmail} disabled={sendingTestEmail}>
				{sendingTestEmail ? "sending..." : "send test email"}
			</button>
		</div>

		{#if testEmailError}
			<p class="error-message">{testEmailError}</p>
		{/if}
		{#if testEmailSuccess}
			<p class="success-message">test email sent</p>
		{/if}
	</form>
</section>

<section class="settings-section">
	<h3>webhooks</h3>

	<form
		method="POST"
		action="?/createWebhook"
		use:enhance={() => {
			return async ({ result, update }) => {
				if (result.type === "success") {
					notifications.success("webhook created");
					createGroups = [];
					createIsGlobal = true;
					await update();
				} else if (result.type === "failure") {
					const error = result.data?.webhookError as
						| string
						| undefined;
					notifications.error(error || "failed to create webhook");
				}
			};
		}}
		class="form webhook-form"
	>
		<div class="form-group">
			<input
				type="text"
				id="webhookName"
				name="name"
				placeholder=" "
				required
			/>
			<label for="webhookName">name</label>
		</div>

		<div class="form-group">
			<input
				type="url"
				id="webhookUrl"
				name="url"
				placeholder=" "
				required
			/>
			<label for="webhookUrl">url</label>
		</div>

		<div class="select-group">
			<label for="webhookType">type</label>
			<select
				id="webhookType"
				name="type"
				required
				bind:value={createType}
			>
				<option value="discord">discord</option>
				<option value="webhook">webhook</option>
			</select>
		</div>

		<div class="scope-section">
			<span class="scope-label">scope</span>
			<input type="hidden" name="isGlobal" value={createIsGlobal} />
			<input
				type="hidden"
				name="groups"
				value={JSON.stringify(createGroups)}
			/>
			<div class="scope-options">
				<label class="checkbox-label">
					<input type="checkbox" bind:checked={createIsGlobal} />
					global (all groups)
				</label>
				{#if !createIsGlobal}
					<div class="group-checkboxes">
						{#each groups as group (group.id)}
							<label class="checkbox-label">
								<input
									type="checkbox"
									checked={createGroups.includes(group.name)}
									onchange={() =>
										toggleCreateGroup(group.name)}
								/>
								{group.name}
							</label>
						{/each}
					</div>
				{/if}
			</div>
		</div>

		{#if createType === "discord"}
			<div class="form-group">
				<input
					type="url"
					id="avatarUrl"
					name="avatarUrl"
					placeholder=" "
				/>
				<label for="avatarUrl">avatar url (optional)</label>
			</div>
		{/if}

		<div class="form-group">
			<input
				type="text"
				id="messageDown"
				name="messageDown"
				placeholder=" "
				value={"{service} is down"}
			/>
			<label for="messageDown">down message</label>
		</div>

		<div class="form-group">
			<input
				type="text"
				id="messageUp"
				name="messageUp"
				placeholder=" "
				value={"{service} is back up"}
			/>
			<label for="messageUp">up message</label>
		</div>

		<button type="submit" class="btn">add webhook</button>
	</form>

	{#if globalWebhooks.length > 0}
		<h4 class="webhook-section-title">global webhooks</h4>
		<div class="webhooks-list">
			{#each globalWebhooks as webhook (webhook.id)}
				<WebhookItem
					{webhook}
					{groups}
					bind:editingId
					bind:editTypes
					bind:editIsGlobal
					bind:editGroups
				/>
			{/each}
		</div>
	{/if}

	{#if groupWebhooks.length > 0}
		<h4 class="webhook-section-title">group webhooks</h4>
		<div class="webhooks-list">
			{#each groupWebhooks as webhook (webhook.id)}
				<WebhookItem
					{webhook}
					{groups}
					bind:editingId
					bind:editTypes
					bind:editIsGlobal
					bind:editGroups
					showGroups={true}
				/>
			{/each}
		</div>
	{/if}

	{#if webhooks.length === 0}
		<p class="no-webhooks">no webhooks configured yet</p>
	{/if}
</section>
