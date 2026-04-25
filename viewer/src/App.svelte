<script lang="ts">
    import * as pdfjsLib from "pdfjs-dist";
    import type { PDFDocumentProxy } from "pdfjs-dist";
    import PdfViewer from "../../client/src/PdfViewer.svelte";
    import StaticAnnotationCanvas from "../../client/src/StaticAnnotationCanvas.svelte";
    import ZipPicker from "./ZipPicker.svelte";
    import type { PdfAnnotationMap, SlidePosition } from "../../shared/types";
    import type { ZipContents } from "../../shared/pdf-utils";

    // Use the CDN worker so no server is needed for GitHub Pages
    const WORKER_SRC = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

    let pdfBytes = $state<ArrayBuffer | null>(null);
    let annotationMap = $state<PdfAnnotationMap>({});
    let position = $state<SlidePosition>({ slide: 0, page: 0 });
    let totalSlides = $state(0);
    let error = $state<string | null>(null);

    const strokes = $derived(
        annotationMap[position.slide]?.[position.page] ?? [],
    );

    function onFilePicked(contents: ZipContents) {
        pdfBytes = contents.pdfBytes;
        annotationMap = contents.annotationMap;
        position = { slide: 0, page: 0 };
        totalSlides = 0;
        error = null;
    }

    function onError(msg: string) {
        error = msg;
    }

    function onPdfLoaded(doc: PDFDocumentProxy | null) {
        totalSlides = doc?.numPages ?? 0;
    }

    function prevSlide() {
        if (position.page > 0) {
            position = { ...position, page: position.page - 1 };
        } else if (position.slide > 0) {
            position = { slide: position.slide - 1, page: 0 };
        }
    }

    function nextSlide() {
        const subCount = annotationMap[position.slide]?.length ?? 1;
        if (position.page < subCount - 1) {
            position = { ...position, page: position.page + 1 };
        } else if (position.slide < totalSlides - 1) {
            position = { slide: position.slide + 1, page: 0 };
        }
    }

    function onNavigateToSlide(slide: number) {
        position = { slide, page: 0 };
    }

    function reset() {
        pdfBytes = null;
        annotationMap = {};
        position = { slide: 0, page: 0 };
        totalSlides = 0;
        error = null;
    }
</script>

{#if !pdfBytes}
    {#if error}
        <div class="error-screen">
            <p class="error-msg">{error}</p>
            <button onclick={reset}>Try again</button>
        </div>
    {:else}
        <ZipPicker {onFilePicked} {onError} />
    {/if}
{:else}
    <div class="viewer">
        <PdfViewer
            pdfBytes={pdfBytes}
            position={position}
            workerSrc={WORKER_SRC}
            onPrevSlide={prevSlide}
            onNextSlide={nextSlide}
            onNavigateToSlide={onNavigateToSlide}
            onPdfLoaded={onPdfLoaded}
            readonly={true}
        >
            {#snippet children(sourceCanvas)}
                <StaticAnnotationCanvas {sourceCanvas} {strokes} />
            {/snippet}
        </PdfViewer>

        <nav class="nav-bar">
            <button onclick={reset} class="reset-btn" title="Open another file">✕</button>
            <div class="nav-controls">
                <button onclick={prevSlide} disabled={position.slide === 0 && position.page === 0}>
                    ‹
                </button>
                <span class="slide-label">
                    {position.slide + 1}{position.page > 0 ? `.${position.page + 1}` : ""} / {totalSlides}
                </span>
                <button
                    onclick={nextSlide}
                    disabled={position.slide >= totalSlides - 1 &&
                        position.page >= (annotationMap[position.slide]?.length ?? 1) - 1}
                >
                    ›
                </button>
            </div>
        </nav>
    </div>
{/if}

<style>
    .viewer {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: #1a1a1a;
    }

    .nav-bar {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0.5rem 1rem;
        background: #111;
        gap: 1rem;
        position: relative;
        flex-shrink: 0;
    }

    .nav-controls {
        display: flex;
        align-items: center;
        gap: 0.75rem;
    }

    .nav-bar button {
        background: #374151;
        color: #e0e0e0;
        border: none;
        border-radius: 6px;
        padding: 0.4rem 0.9rem;
        font-size: 1.2rem;
        cursor: pointer;
        transition: background 0.15s;
    }

    .nav-bar button:hover:not(:disabled) {
        background: #4b5563;
    }

    .nav-bar button:disabled {
        opacity: 0.35;
        cursor: default;
    }

    .reset-btn {
        position: absolute;
        left: 1rem;
        font-size: 0.9rem !important;
        padding: 0.35rem 0.65rem !important;
    }

    .slide-label {
        color: #9ca3af;
        font-family: system-ui, sans-serif;
        font-size: 0.9rem;
        min-width: 6rem;
        text-align: center;
    }

    .error-screen {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        gap: 1rem;
        background: #1a1a1a;
        font-family: system-ui, sans-serif;
    }

    .error-msg {
        color: #f87171;
    }

    .error-screen button {
        background: #374151;
        color: #e0e0e0;
        border: none;
        border-radius: 6px;
        padding: 0.5rem 1.5rem;
        cursor: pointer;
    }
</style>
