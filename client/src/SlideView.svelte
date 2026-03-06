<script lang="ts">
    import { whiteboardMode } from "./stores";
    import PdfViewer from "./PdfViewer.svelte";
    import WhiteboardViewer from "./WhiteboardViewer.svelte";
</script>

{#if $whiteboardMode}
    <WhiteboardViewer />
{:else}
    <PdfViewer />
{/if}
