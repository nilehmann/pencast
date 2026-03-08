<script lang="ts">
    import { activeMode, deviceRole } from "./stores";
    import PdfViewer from "./PdfViewer.svelte";
    import WhiteboardViewer from "./WhiteboardViewer.svelte";
    import HtmlViewer from "./HtmlViewer.svelte";
    import HtmlPresenter from "./HtmlPresenter.svelte";

    interface Props {
        onChangePdf?: () => void;
        onLoadHtml?: () => void;
        onChangeRole?: () => void;
    }
    let { onChangePdf, onLoadHtml, onChangeRole }: Props = $props();
</script>

{#if $activeMode.base === "html" && !$activeMode.whiteboard}
    {#if $deviceRole === "viewer"}
        <HtmlViewer />
    {:else}
        <HtmlPresenter />
    {/if}
{:else if $activeMode.whiteboard}
    <WhiteboardViewer {onChangePdf} {onLoadHtml} {onChangeRole} />
{:else}
    <PdfViewer {onChangePdf} {onLoadHtml} {onChangeRole} />
{/if}
