<script lang="ts">
    import * as pdfjsLib from "pdfjs-dist";
    import type { PDFDocumentProxy } from "pdfjs-dist";
    import PdfViewer from "./PdfViewer.svelte";
    import StaticAnnotationCanvas from "./StaticAnnotationCanvas.svelte";
    import ZipPicker from "./ZipPicker.svelte";
    import ZipBrowser from "./ZipBrowser.svelte";
    import Modal from "../../shared/components/Modal.svelte";
    import { listZip } from "../../shared/pdf-utils";
    import type { ZipEntry } from "../../shared/pdf-utils";
    import type { PdfAnnotationMap, SlidePosition } from "../../shared/types";

    const WORKER_SRC = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

    let zipEntries = $state<ZipEntry[] | null>(null);
    let zipLoadPdf = $state<((path: string) => Promise<{ pdfBytes: ArrayBuffer; annotationMap: PdfAnnotationMap; subPageCounts: Record<number, number> }>) | null>(null);
    let showBrowser = $state(false);
    let loading = $state(false);
    let pdfBytes = $state<ArrayBuffer | null>(null);
    let annotationMap = $state<PdfAnnotationMap>({});
    let subPageCounts = $state<Record<number, number>>({});
    let position = $state<SlidePosition>({ slide: 0, page: 0 });
    let totalSlides = $state(0);
    let error = $state<string | null>(null);

    const strokes = $derived(
        annotationMap[position.slide]?.[position.page] ?? [],
    );

    const currentSubPageCount = $derived(
        subPageCounts[position.slide] ?? annotationMap[position.slide]?.length ?? 1,
    );

    async function onFilePicked(file: File) {
        loading = true;
        error = null;
        try {
            const result = await listZip(file);
            zipEntries = result.entries;
            zipLoadPdf = result.loadPdf;
            showBrowser = true;
        } catch (err) {
            error = err instanceof Error ? err.message : String(err);
        } finally {
            loading = false;
        }
    }

    async function onPdfSelected(path: string) {
        loading = true;
        error = null;
        try {
            const contents = await zipLoadPdf!(path);
            pdfBytes = contents.pdfBytes;
            annotationMap = contents.annotationMap;
            subPageCounts = contents.subPageCounts;
            position = { slide: 0, page: 0 };
            totalSlides = 0;
            showBrowser = false;
        } catch (err) {
            error = err instanceof Error ? err.message : String(err);
        } finally {
            loading = false;
        }
    }

    function onPdfLoaded(doc: PDFDocumentProxy | null) {
        totalSlides = doc?.numPages ?? 0;
    }

    function prevSlide() {
        if (position.slide > 0) {
            position = { slide: position.slide - 1, page: 0 };
        }
    }

    function nextSlide() {
        if (position.slide < totalSlides - 1) {
            position = { slide: position.slide + 1, page: 0 };
        }
    }

    function prevSubPage() {
        if (position.page > 0) {
            position = { ...position, page: position.page - 1 };
        }
    }

    function nextSubPage() {
        if (position.page < currentSubPageCount - 1) {
            position = { ...position, page: position.page + 1 };
        }
    }

    function onNavigateToSlide(slide: number) {
        position = { slide, page: 0 };
    }

    function reset() {
        zipEntries = null;
        zipLoadPdf = null;
        showBrowser = false;
        pdfBytes = null;
        annotationMap = {};
        subPageCounts = {};
        position = { slide: 0, page: 0 };
        totalSlides = 0;
        error = null;
    }
</script>

{#if loading}
    <div class="loading-screen">
        <span>Loading…</span>
    </div>
{:else if error}
    <div class="error-screen">
        <p class="error-msg">{error}</p>
        <button onclick={reset}>Try again</button>
    </div>
{:else if pdfBytes}
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
            <button onclick={() => showBrowser = true} class="reset-btn" title="Open another PDF">☰</button>
            <div class="nav-controls">
                <button onclick={prevSlide} disabled={position.slide === 0}>‹</button>
                <span class="slide-label">{position.slide + 1} / {totalSlides}</span>
                <button onclick={nextSlide} disabled={position.slide >= totalSlides - 1}>›</button>
            </div>
            {#if currentSubPageCount > 1}
                <div class="subpage-controls">
                    <button onclick={prevSubPage} disabled={position.page === 0}>↑</button>
                    <span class="subpage-label">{position.page + 1} / {currentSubPageCount}</span>
                    <button onclick={nextSubPage} disabled={position.page >= currentSubPageCount - 1}>↓</button>
                </div>
            {/if}
        </nav>
    </div>
{:else}
    <ZipPicker {onFilePicked} />
{/if}

{#if zipEntries && showBrowser}
    <Modal wide dismissible={!!pdfBytes} ondismiss={() => showBrowser = false}>
        <h2>Select a PDF</h2>
        <ZipBrowser entries={zipEntries} onSelectPdf={onPdfSelected} onCancel={reset} />
    </Modal>
{/if}

<style>
    .loading-screen {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        background: #1a1a1a;
        color: #9ca3af;
        font-family: system-ui, sans-serif;
        font-size: 1rem;
    }

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
        gap: 1.5rem;
        position: relative;
        flex-shrink: 0;
    }

    .nav-controls,
    .subpage-controls {
        display: flex;
        align-items: center;
        gap: 0.75rem;
    }

    .subpage-controls {
        border-left: 1px solid #2a2a2a;
        padding-left: 1.5rem;
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

    .slide-label,
    .subpage-label {
        color: #9ca3af;
        font-family: system-ui, sans-serif;
        font-size: 0.9rem;
        min-width: 4rem;
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
