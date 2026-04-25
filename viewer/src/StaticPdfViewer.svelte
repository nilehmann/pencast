<script lang="ts">
    import * as pdfjsLib from "pdfjs-dist";
    import type {
        PDFDocumentProxy,
        PDFPageProxy,
        PageViewport,
    } from "pdfjs-dist";
    import { handleAnnotationClick } from "../../shared/pdf-annotation-handler";
    import { stores } from "./stores.svelte";
    import StaticAnnotationCanvas from "./StaticAnnotationCanvas.svelte";

    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

    interface Props {
        pdfBytes: ArrayBuffer;
        readonly?: boolean;
    }

    let { pdfBytes, readonly = false }: Props = $props();

    let pdfCanvas = $state<HTMLCanvasElement>(undefined!);
    let blankCanvas = $state<HTMLCanvasElement>(undefined!);
    let container = $state<HTMLDivElement>(undefined!);
    let currentPage = $state<PDFPageProxy | null>(null);
    let currentViewport = $state<PageViewport | null>(null);
    let pdfReady = $state(false);
    let rendering = false;
    let pendingSlide: number | null = null;

    // Generation counter: incremented on every loadPdf call so that work
    // belonging to a superseded load is discarded when it eventually resolves.
    let loadGen = 0;
    let loadError = $state<string | null>(null);

    // Load PDF when bytes change
    $effect(() => {
        void loadPdf(pdfBytes, ++loadGen);
    });

    // Re-render PDF slide when slide or sub-page changes
    $effect(() => {
        const pos = stores.activePdf?.position;
        if (stores.pdfDoc && pos !== undefined) void renderSlide(pos.slide);
    });

    // Resize observer
    $effect(() => {
        if (!container) return;
        const observer = new ResizeObserver(() => {
            const s = stores.activePdf?.position.slide;
            if (stores.pdfDoc && s !== undefined) void renderSlide(s);
        });
        observer.observe(container);
        return () => observer.disconnect();
    });

    function resetDoc(gen: number) {
        if (gen !== loadGen) return false;
        stores.pdfDoc = null;
        stores.updatePageCount(0);
        pdfReady = false;
        loadError = null;
        return true;
    }

    async function loadPdf(bytes: ArrayBuffer, gen: number) {
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
        stores.pdfDoc = doc;
        stores.updatePageCount(doc.numPages);
        void renderSlide(stores.activePdf?.position.slide ?? 0);
    }

    async function renderSlide(s: number) {
        if (!stores.pdfDoc || !pdfCanvas || !container) return;
        if (rendering) {
            pendingSlide = s;
            return;
        }
        rendering = true;

        // Clear stale content so the old slide doesn't flash when
        // unhiding the PDF canvas (e.g. navigating away from a sub-page).
        pdfCanvas
            .getContext("2d")!
            .clearRect(0, 0, pdfCanvas.width, pdfCanvas.height);

        try {
            const page = await stores.pdfDoc.getPage(s + 1);
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
        if (!currentPage || !currentViewport || !pdfCanvas || !stores.pdfDoc)
            return;
        if (!stores.activePdf) return;
        await handleAnnotationClick(
            e,
            currentPage,
            currentViewport,
            pdfCanvas,
            stores.pdfDoc,
            {
                page: stores.activePdf.position.slide,
                subPage: stores.activePdf.position.page,
                onNavigateToSlide: stores.navigateToSlide.bind(stores),
                onPrevSlide: stores.prevSlide.bind(stores),
                onNextSlide: stores.nextSlide.bind(stores),
            },
        );
    }

    function onViewerClick(e: MouseEvent) {
        if (readonly) return;
        if (e.ctrlKey && e.shiftKey) {
            void handleAnnotationClickLocal(e);
            return;
        }
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const isLeftQuarter = e.clientX - rect.left < rect.width / 4;
        if (isLeftQuarter) {
            stores.prevSlide();
        } else {
            stores.nextSlide();
        }
    }

    const subPage = $derived(stores.activePdf?.position.page ?? 0);
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="pdf-container" bind:this={container} onclick={onViewerClick}>
    {#if loadError}
        <p class="hint hint--error">{loadError}</p>
    {:else if pdfBytes && !stores.pdfDoc}
        <p class="hint">Loading…</p>
    {/if}

    <canvas bind:this={pdfCanvas} class:hidden={subPage > 0}></canvas>
    {#if subPage > 0}
        <canvas bind:this={blankCanvas}></canvas>
    {/if}

    {#if pdfReady}
        <StaticAnnotationCanvas
            sourceCanvas={subPage > 0 ? blankCanvas : pdfCanvas}
            strokes={stores.strokes}
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
