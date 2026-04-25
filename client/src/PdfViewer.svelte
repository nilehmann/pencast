<script lang="ts">
    import * as pdfjsLib from "pdfjs-dist";
    import { onDestroy } from "svelte";
    import { stores } from "./stores.svelte";
    import { prevSlide, nextSlide } from "./navigation";
    import { PdfViewerState } from "../../shared/PdfViewerState.svelte";
    import AnnotationCanvas from "./AnnotationCanvas.svelte";

    pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

    class LivePdfViewerState extends PdfViewerState {
        constructor() { super(stores); }
        nextSlide() { nextSlide(); }
        prevSlide() { prevSlide(); }
        canInteract() { return stores.deviceRole === "viewer"; }
    }

    const viewer = new LivePdfViewerState();
    onDestroy(() => viewer.destroy());

    // Generation counter: incremented on every loadPdf call so that work
    // belonging to a superseded load is discarded when it eventually resolves.
    let loadGen = 0;

    // Load PDF when activePdfPath changes
    $effect(() => {
        const path = stores.activePdf?.path;
        if (!path) return;
        void loadPdf(path, ++loadGen);
    });

    async function loadPdf(path: string, gen: number) {
        stores.pdfDoc = null;
        viewer.pdfReady = false;
        viewer.loadError = null;

        const url = `/api/pdf?path=${encodeURIComponent(path)}`;

        let res: Response;
        try {
            res = await fetch(url);
        } catch {
            if (gen !== loadGen) return;
            viewer.loadError = "Network error — could not fetch PDF";
            return;
        }

        if (gen !== loadGen) return;

        if (!res.ok) {
            viewer.loadError = `Failed to load PDF (${res.status})`;
            return;
        }

        let buffer: ArrayBuffer;
        try {
            buffer = await res.arrayBuffer();
        } catch {
            if (gen !== loadGen) return;
            viewer.loadError = "Network error — download interrupted";
            return;
        }

        if (gen !== loadGen) return;

        let doc: pdfjsLib.PDFDocumentProxy;
        try {
            doc = await pdfjsLib.getDocument({ data: buffer }).promise;
        } catch {
            if (gen !== loadGen) return;
            viewer.loadError = "Failed to parse PDF";
            return;
        }

        if (gen !== loadGen) return;

        stores.pdfDoc = doc;
        void viewer.renderSlide(stores.activePdf?.position.slide ?? 0);
    }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="pdf-container" bind:this={viewer.container} onclick={(e) => viewer.onViewerClick(e)}>
    {#if viewer.loadError}
        <p class="hint hint--error">{viewer.loadError}</p>
    {:else if stores.activePdf?.path && !stores.pdfDoc}
        <p class="hint">Loading…</p>
    {/if}

    <canvas bind:this={viewer.pdfCanvas} class:hidden={viewer.subPage > 0}></canvas>
    {#if viewer.subPage > 0}
        <canvas bind:this={viewer.blankCanvas}></canvas>
    {/if}

    {#if viewer.pdfReady}
        <AnnotationCanvas
            sourceCanvas={viewer.subPage > 0 ? viewer.blankCanvas : viewer.pdfCanvas}
        />
    {/if}
</div>

<style>
    .pdf-container {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #1a1a1a;
        overflow: hidden;
        position: relative;
        min-height: 0;
    }

    canvas {
        display: block;
        box-shadow: 0 2px 16px rgba(0, 0, 0, 0.5);
    }

    canvas.hidden {
        display: none;
    }

    .hint {
        color: #888;
        position: absolute;
    }

    .hint--error {
        color: #f87171;
    }
</style>
