<script lang="ts">
    import { activeMode, deviceRole } from "./stores";
    import PdfViewer from "./PdfViewer.svelte";
    import WhiteboardViewer from "./WhiteboardViewer.svelte";
    import HtmlViewer from "./HtmlViewer.svelte";
    import HtmlPresenter from "./HtmlPresenter.svelte";
</script>

{#if $activeMode.base === "html" && !$activeMode.whiteboard}
    {#if $deviceRole === "viewer"}
        <HtmlViewer />
    {:else}
        <HtmlPresenter />
    {/if}
{:else if $activeMode.whiteboard}
    <WhiteboardViewer />
{:else}
    <PdfViewer />
{/if}
