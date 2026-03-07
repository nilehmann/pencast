<script lang="ts">
    import { whiteboardMode, htmlMode, deviceRole } from "./stores";
    import PdfViewer from "./PdfViewer.svelte";
    import WhiteboardViewer from "./WhiteboardViewer.svelte";
    import HtmlViewer from "./HtmlViewer.svelte";
    import HtmlPresenter from "./HtmlPresenter.svelte";
</script>

{#if $htmlMode}
    {#if $deviceRole === "viewer"}
        <HtmlViewer />
    {:else}
        <HtmlPresenter />
    {/if}
{:else if $whiteboardMode}
    <WhiteboardViewer />
{:else}
    <PdfViewer />
{/if}
