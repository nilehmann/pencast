<script lang="ts">
    import * as pdfjsLib from "pdfjs-dist";
    import type {
        PDFDocumentProxy,
        PDFPageProxy,
        PageViewport,
    } from "pdfjs-dist";
    import { stores } from "./stores.svelte";
    import { prevSlide, nextSlide } from "./navigation";
    import AnnotationCanvas from "./AnnotationCanvas.svelte";

    pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

    let pdfCanvas = $state<HTMLCanvasElement>(undefined!);
    let container = $state<HTMLDivElement>(undefined!);
    let pdfDoc = $state<PDFDocumentProxy | null>(null);
    let currentPage = $state<PDFPageProxy | null>(null);
    let currentViewport = $state<PageViewport | null>(null);
    let pdfReady = $state(false);
    let rendering = false;
    let pendingSlide: number | null = null;

    // Generation counter: incremented on every loadPdf call so that work
    // belonging to a superseded load is discarded when it eventually resolves.
    let loadGen = 0;
    let loadError = $state<string | null>(null);

    // Load PDF when activePdfPath changes
    $effect(() => {
        const path = stores.activePdf?.path;
        if (!path) return;
        void loadPdf(path, ++loadGen);
    });

    // Re-render PDF slide when slide changes
    $effect(() => {
        const s = stores.activePdf?.currentSlide;
        if (pdfDoc && s !== undefined) void renderSlide(s);
    });

    // Resize observer
    $effect(() => {
        if (!container) return;
        const observer = new ResizeObserver(() => {
            const s = stores.activePdf?.currentSlide;
            if (pdfDoc && s !== undefined) void renderSlide(s);
        });
        observer.observe(container);
        return () => observer.disconnect();
    });

    async function loadPdf(path: string, gen: number) {
        pdfDoc = null;
        pdfReady = false;
        loadError = null;

        const url = `/api/pdf?path=${encodeURIComponent(path)}`;

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
        void renderSlide(stores.activePdf?.currentSlide || 0);
    }

    async function renderSlide(s: number) {
        if (!pdfDoc || !pdfCanvas || !container) return;
        if (rendering) {
            pendingSlide = s;
            return;
        }
        rendering = true;

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

    async function handleAnnotationClick(e: MouseEvent) {
        const activePdf = stores.activePdf;
        if (!activePdf) return;

        if (!currentPage || !currentViewport || !pdfCanvas || !pdfDoc) return;
        const rect = pdfCanvas.getBoundingClientRect();
        const cssX = e.clientX - rect.left;
        const cssY = e.clientY - rect.top;
        const [pdfX, pdfY] = currentViewport.convertToPdfPoint(cssX, cssY);

        const annotations = await currentPage.getAnnotations();
        for (const ann of annotations) {
            if (ann.subtype !== "Link") continue;
            const [x1, y1, x2, y2]: number[] = ann.rect;
            if (
                pdfX >= Math.min(x1, x2) &&
                pdfX <= Math.max(x1, x2) &&
                pdfY >= Math.min(y1, y2) &&
                pdfY <= Math.max(y1, y2)
            ) {
                if (ann.url) {
                    const tab = window.open(ann.url, "_blank");
                    tab?.focus();
                } else if (ann.dest != null) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const dest: any[] | null =
                        typeof ann.dest === "string"
                            ? await pdfDoc.getDestination(ann.dest)
                            : ann.dest;
                    if (dest) {
                        const pageIndex = await pdfDoc.getPageIndex(dest[0]);
                        activePdf.currentSlide = pageIndex;
                    }
                } else if (ann.action) {
                    const pc = activePdf.pageCount;
                    if (ann.action === "GoToNextPage") nextSlide();
                    else if (ann.action === "GoToPrevPage") prevSlide();
                    else if (ann.action === "FirstPage")
                        activePdf.currentSlide = 0;
                    else if (ann.action === "LastPage")
                        activePdf.currentSlide = pc - 1;
                }
                break;
            }
        }
    }

    // A click on the left quarter of the slide area goes to the previous slide and a click
    // elsewhere advances to the next slide. ctrl+click performs a PDF annotation hit-test and
    // follows any link under the cursor.
    function onViewerClick(e: MouseEvent) {
        if (stores.deviceRole !== "viewer") return;
        if (e.ctrlKey && e.shiftKey) {
            void handleAnnotationClick(e);
            return;
        }
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const isLeftQuarter = e.clientX - rect.left < rect.width / 4;
        if (isLeftQuarter) {
            prevSlide();
        } else {
            nextSlide();
        }
    }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="pdf-container" bind:this={container} onclick={onViewerClick}>
    {#if loadError}
        <p class="hint hint--error">{loadError}</p>
    {:else if stores.activePdf?.path && !pdfDoc}
        <p class="hint">Loading…</p>
    {/if}

    <canvas bind:this={pdfCanvas}></canvas>

    {#if pdfReady}
        <AnnotationCanvas sourceCanvas={pdfCanvas} />
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

    .hint {
        color: #888;
        position: absolute;
    }

    .hint--error {
        color: #f87171;
    }
</style>
