<script lang="ts">
    import * as pdfjsLib from "pdfjs-dist";
    import { onDestroy, untrack } from "svelte";
    import { stores } from "./stores.svelte";
    import { PdfViewerState } from "@pencast/shared/PdfViewerState.svelte";
    import StaticAnnotationCanvas from "./StaticAnnotationCanvas.svelte";

    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

    class StaticPdfViewerState extends PdfViewerState {
        constructor() {
            super(stores);
        }
        nextSlide() {
            stores.nextSlide();
        }
        prevSlide() {
            stores.prevSlide();
        }
        canInteract() {
            return true;
        }
    }

    const viewer = new StaticPdfViewerState();
    onDestroy(() => viewer.destroy());

    // Load PDF only when a new PDF is explicitly set (pdfLoadId increments in setPdfState).
    // pdfBytes is read via untrack so changing it alone doesn't re-trigger this effect.
    $effect(() => {
        void stores.pdfLoadId;
        void loadPdf(untrack(() => stores.pdfBytes)!, viewer.nextGen());
    });

    async function loadPdf(bytes: ArrayBuffer, gen: number) {
        viewer.resetLoadState();
        stores.updatePageCount(0);
        const doc = await viewer.parseDocument(bytes, gen);
        if (!doc) return;
        stores.updatePageCount(doc.numPages);
        viewer.finishLoad(doc, gen);
    }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    class="pdf-container"
    bind:this={viewer.container}
    onclick={(e) => viewer.onViewerClick(e)}
>
    {#if viewer.loadError}
        <p class="hint hint--error">{viewer.loadError}</p>
    {:else if stores.pdfBytes && !stores.pdfDoc}
        <p class="hint">Loading…</p>
    {/if}

    <canvas bind:this={viewer.pdfCanvas} class:hidden={viewer.subPage > 0}
    ></canvas>
    {#if viewer.subPage > 0}
        <canvas bind:this={viewer.blankCanvas}></canvas>
    {/if}

    {#if viewer.pdfReady}
        <StaticAnnotationCanvas
            sourceCanvas={viewer.subPage > 0
                ? viewer.blankCanvas
                : viewer.pdfCanvas}
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
