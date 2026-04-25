<script lang="ts">
    import { stores } from "./stores.svelte";
    import { prevSlide, nextSlide } from "./navigation";
    import PdfViewer from "./PdfViewer.svelte";
    import AnnotationCanvas from "./AnnotationCanvas.svelte";
    import WhiteboardViewer from "./WhiteboardViewer.svelte";
    import HtmlViewer from "./HtmlViewer.svelte";
    import HtmlPresenter from "./HtmlPresenter.svelte";
    import ScreenViewer from "./ScreenViewer.svelte";
    import ScreenPresenter from "./ScreenPresenter.svelte";
    import type { PDFDocumentProxy } from "pdfjs-dist";

    const pdfUrl = $derived(
        stores.activePdf?.path
            ? `/api/pdf?path=${encodeURIComponent(stores.activePdf.path)}`
            : undefined,
    );
    const position = $derived(
        stores.activePdf?.position ?? { slide: 0, page: 0 },
    );

    function onPdfLoaded(doc: PDFDocumentProxy | null) {
        stores.pdfDoc = doc;
    }
    function onNavigateToSlide(slide: number) {
        if (stores.activePdf) stores.activePdf.position.slide = slide;
    }
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
    <PdfViewer
        pdfUrl={pdfUrl}
        position={position}
        onPrevSlide={prevSlide}
        onNextSlide={nextSlide}
        onNavigateToSlide={onNavigateToSlide}
        onPdfLoaded={onPdfLoaded}
        readonly={stores.deviceRole === "viewer"}
    >
        {#snippet children(sourceCanvas)}
            <AnnotationCanvas {sourceCanvas} />
        {/snippet}
    </PdfViewer>
{/if}
