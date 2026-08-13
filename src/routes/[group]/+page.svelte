<script lang="ts">
	import { StatusPage } from "$lib";
	import type { ActionData, PageData } from "./$types";
	import "../page.css";

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<StatusPage {data} {form} />
