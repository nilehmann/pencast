<script lang="ts">
    import { stores } from "./stores.svelte";
    import PdfViewer from "./PdfViewer.svelte";
    import WhiteboardViewer from "./WhiteboardViewer.svelte";
    import HtmlViewer from "./HtmlViewer.svelte";
    import HtmlPresenter from "./HtmlPresenter.svelte";
    import ScreenViewer from "./ScreenViewer.svelte";
    import ScreenPresenter from "./ScreenPresenter.svelte";
</script>

{#if stores.activeMode.base === "screen" && !stores.activeMode.whiteboard}
    {#if stores.deviceRole === "viewer"}
        <ScreenViewer />
    {:else}
        <ScreenPresenter />
    {/if}
{:else if stores.activeMode.base === "html" && !stores.activeMode.whiteboard}
    {#if stores.deviceRole === "viewer"}
        <HtmlViewer />
    {:else}
        <HtmlPresenter />
    {/if}
{:else if stores.activeMode.whiteboard}
    <WhiteboardViewer />
{:else}
    <PdfViewer />
{/if}
