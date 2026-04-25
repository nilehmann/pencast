<script lang="ts">
    import * as pdfjsLib from "pdfjs-dist";
    import type {
        PDFDocumentProxy,
        PDFPageProxy,
        PageViewport,
    } from "pdfjs-dist";
    import type { Snippet } from "svelte";
    import type { SlidePosition } from "../../shared/types";
    import { handleAnnotationClick } from "../../shared/pdf-annotation-handler";

    interface Props {
        // Exactly one of these is provided:
        pdfBytes?: ArrayBuffer;
        pdfUrl?: string;

        position: SlidePosition;

        onPrevSlide?: () => void;
        onNextSlide?: () => void;
        onNavigateToSlide?: (slide: number) => void;
        onPdfLoaded?: (doc: PDFDocumentProxy | null) => void;

        // true = suppress click-navigation (viewer role)
        readonly?: boolean;

        // PDF.js worker URL; defaults to /pdf.worker.min.mjs
        workerSrc?: string;

        // Annotation overlay injected by the parent
        children?: Snippet<[HTMLCanvasElement | undefined]>;
    }

    let {
        pdfBytes,
        pdfUrl,
        position,
        onPrevSlide,
        onNextSlide,
        onNavigateToSlide,
        onPdfLoaded,
        readonly = false,
        workerSrc = "/pdf.worker.min.mjs",
        children,
    }: Props = $props();

    // Set workerSrc before any PDF is loaded. $effect.pre runs before DOM
    // updates, so it fires before the load effect below.
    $effect.pre(() => {
        pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
    });

    let pdfCanvas = $state<HTMLCanvasElement>(undefined!);
    let blankCanvas = $state<HTMLCanvasElement>(undefined!);
    let container = $state<HTMLDivElement>(undefined!);
    let pdfDoc = $state<PDFDocumentProxy | null>(null);
    let currentPage = $state<PDFPageProxy | null>(null);
    let currentViewport = $state<PageViewport | null>(null);
    let pdfReady = $state(false);
    let rendering = false;
    let pendingSlide: number | null = null;
    let subPage = $derived(position.page ?? 0);

    // Generation counter: incremented on every loadPdf call so that work
    // belonging to a superseded load is discarded when it eventually resolves.
    let loadGen = 0;
    let loadError = $state<string | null>(null);

    // Load PDF when source changes
    $effect(() => {
        if (pdfBytes) {
            void loadPdfFromBytes(pdfBytes, ++loadGen);
        } else if (pdfUrl) {
            void loadPdfFromUrl(pdfUrl, ++loadGen);
        }
    });

    // Re-render PDF slide when slide or sub-page changes
    $effect(() => {
        const pos = position;
        if (pdfDoc && pos !== undefined) void renderSlide(pos.slide);
    });

    // Resize observer
    $effect(() => {
        if (!container) return;
        const observer = new ResizeObserver(() => {
            if (pdfDoc) void renderSlide(position.slide);
        });
        observer.observe(container);
        return () => observer.disconnect();
    });

    function resetDoc(gen: number) {
        if (gen !== loadGen) return false;
        pdfDoc = null;
        onPdfLoaded?.(null);
        pdfReady = false;
        loadError = null;
        return true;
    }

    async function loadPdfFromBytes(bytes: ArrayBuffer, gen: number) {
        if (!resetDoc(gen)) return;
        let doc: PDFDocumentProxy;
        try {
            doc = await pdfjsLib.getDocument({ data: bytes }).promise;
        } catch {
            if (gen !== loadGen) return;
            loadError = "Failed to parse PDF";
            return;
        }
        if (gen !== loadGen) return;
        pdfDoc = doc;
        onPdfLoaded?.(doc);
        void renderSlide(position.slide);
    }

    async function loadPdfFromUrl(url: string, gen: number) {
        if (!resetDoc(gen)) return;

        let res: Response;
        try {
            res = await fetch(url);
        } catch {
            if (gen !== loadGen) return;
            loadError = "Network error — could not fetch PDF";
            return;
        }

        if (gen !== loadGen) return;

        if (!res.ok) {
            loadError = `Failed to load PDF (${res.status})`;
            return;
        }

        let buffer: ArrayBuffer;
        try {
            buffer = await res.arrayBuffer();
        } catch {
            if (gen !== loadGen) return;
            loadError = "Network error — download interrupted";
            return;
        }

        if (gen !== loadGen) return;

        let doc: PDFDocumentProxy;
        try {
            doc = await pdfjsLib.getDocument({ data: buffer }).promise;
        } catch {
            if (gen !== loadGen) return;
            loadError = "Failed to parse PDF";
            return;
        }

        if (gen !== loadGen) return;

        pdfDoc = doc;
        onPdfLoaded?.(doc);
        void renderSlide(position.slide);
    }

    async function renderSlide(s: number) {
        if (!pdfDoc || !pdfCanvas || !container) return;
        if (rendering) {
            pendingSlide = s;
            return;
        }
        rendering = true;

        // Clear stale content so the old slide doesn't flash when
        // unhiding the PDF canvas (e.g. navigating away from a sub-page).
        pdfCanvas.getContext("2d")!.clearRect(0, 0, pdfCanvas.width, pdfCanvas.height);

        try {
            const page = await pdfDoc.getPage(s + 1);
            const containerWidth = container.clientWidth;
            const containerHeight = container.clientHeight;
            const viewport = page.getViewport({ scale: 1 });
            const scale = Math.min(
                containerWidth / viewport.width,
                containerHeight / viewport.height,
            );
            const scaled = page.getViewport({ scale });

            const dpr = window.devicePixelRatio || 1;

            const offscreen = document.createElement("canvas");
            offscreen.width = scaled.width * dpr;
            offscreen.height = scaled.height * dpr;
            const offCtx = offscreen.getContext("2d")!;
            offCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
            await page.render({ canvasContext: offCtx, viewport: scaled })
                .promise;
            currentPage = page;
            currentViewport = scaled;
            page.cleanup();

            pdfCanvas.width = scaled.width * dpr;
            pdfCanvas.height = scaled.height * dpr;
            pdfCanvas.style.width = `${scaled.width}px`;
            pdfCanvas.style.height = `${scaled.height}px`;
            pdfCanvas.getContext("2d")!.drawImage(offscreen, 0, 0);

            // Update blank canvas dimensions to match PDF canvas
            if (blankCanvas) {
                blankCanvas.width = pdfCanvas.width;
                blankCanvas.height = pdfCanvas.height;
                blankCanvas.style.width = pdfCanvas.style.width;
                blankCanvas.style.height = pdfCanvas.style.height;
                const bctx = blankCanvas.getContext("2d")!;
                bctx.fillStyle = "#ffffff";
                bctx.fillRect(0, 0, blankCanvas.width, blankCanvas.height);
            }

            pdfReady = true;
        } finally {
            rendering = false;
            if (pendingSlide !== null) {
                const next = pendingSlide;
                pendingSlide = null;
                void renderSlide(next);
            }
        }
    }

    async function handleAnnotationClickLocal(e: MouseEvent) {
        if (!currentPage || !currentViewport || !pdfCanvas || !pdfDoc) return;
        await handleAnnotationClick(e, currentPage, currentViewport, pdfCanvas, pdfDoc, {
            page: position.slide,
            subPage: position.page,
            onNavigateToSlide,
            onPrevSlide,
            onNextSlide,
        });
    }

    function onViewerClick(e: MouseEvent) {
        if (!readonly) return;
        if (e.ctrlKey && e.shiftKey) {
            void handleAnnotationClickLocal(e);
            return;
        }
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const isLeftQuarter = e.clientX - rect.left < rect.width / 4;
        if (isLeftQuarter) {
            onPrevSlide?.();
        } else {
            onNextSlide?.();
        }
    }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="pdf-container" bind:this={container} onclick={onViewerClick}>
    {#if loadError}
        <p class="hint hint--error">{loadError}</p>
    {:else if (pdfUrl || pdfBytes) && !pdfDoc}
        <p class="hint">Loading…</p>
    {/if}

    <canvas bind:this={pdfCanvas} class:hidden={subPage > 0}></canvas>
    {#if subPage > 0}
        <canvas bind:this={blankCanvas}></canvas>
    {/if}

    {#if pdfReady}
        {@render children?.(subPage > 0 ? blankCanvas : pdfCanvas)}
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
