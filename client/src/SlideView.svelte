<script lang="ts">
    import { stores } from "./stores.svelte";
    import PdfViewer from "./PdfViewer.svelte";
    import WhiteboardViewer from "./WhiteboardViewer.svelte";
    import HtmlViewer from "./HtmlViewer.svelte";
    import HtmlPresenter from "./HtmlPresenter.svelte";
</script>

{#if stores.activeMode.base === "html" && !stores.activeMode.whiteboard}
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
