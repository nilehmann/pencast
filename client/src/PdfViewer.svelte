<script lang="ts">
    import * as pdfjsLib from "pdfjs-dist";
    import type { PDFDocumentProxy } from "pdfjs-dist";
    import {
        authToken,
        activePdfPath,
        currentSlide,
        pageCount,
        deviceRole,
        logout,
        whiteboardMode,
        whiteboardSlide,
        whiteboardPageCount,
    } from "./stores";
    import { send } from "./ws-client";
    import AnnotationCanvas from "./AnnotationCanvas.svelte";

    pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

    let pdfCanvas = $state<HTMLCanvasElement>(undefined!);
    let whiteboardCanvas = $state<HTMLCanvasElement>(undefined!);
    let container = $state<HTMLDivElement>(undefined!);
    let pdfDoc = $state<PDFDocumentProxy | null>(null);
    let rendering = false;
    let pendingSlide: number | null = null;

    // Generation counter: incremented on every loadPdf call so that work
    // belonging to a superseded load is discarded when it eventually resolves.
    let loadGen = 0;
    let loadError = $state<string | null>(null);

    let slide = $derived($currentSlide);
    let pages = $derived($pageCount);
    let wbSlide = $derived($whiteboardSlide);
    let wbPages = $derived($whiteboardPageCount);
    let isWhiteboard = $derived($whiteboardMode);

    // Load PDF when activePdfPath changes
    $effect(() => {
        const path = $activePdfPath;
        const token = $authToken;
        if (!path) return;
        void loadPdf(path, token, ++loadGen);
    });

    // Re-render PDF slide when slide changes (only in PDF mode)
    $effect(() => {
        const s = $currentSlide;
        if (pdfDoc && !$whiteboardMode) void renderSlide(s);
    });

    // Re-render when switching back from whiteboard mode
    $effect(() => {
        if (!$whiteboardMode && pdfDoc) void renderSlide($currentSlide);
    });

    // Resize the whiteboard canvas to fill the container when in whiteboard mode
    $effect(() => {
        if ($whiteboardMode) syncWhiteboardSize();
    });

    async function loadPdf(path: string, token: string, gen: number) {
        pdfDoc = null;
        loadError = null;

        const url = `/api/pdf?path=${encodeURIComponent(path)}&token=${encodeURIComponent(token)}`;

        let res: Response;
        try {
            res = await fetch(url);
        } catch {
            if (gen !== loadGen) return;
            loadError = "Network error — could not fetch PDF";
            return;
        }

        if (gen !== loadGen) return;

        if (res.status === 401) {
            logout(true);
            return;
        }
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
        pageCount.set(pdfDoc.numPages);
        void renderSlide($currentSlide);
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
            page.cleanup();

            pdfCanvas.width = scaled.width * dpr;
            pdfCanvas.height = scaled.height * dpr;
            pdfCanvas.style.width = `${scaled.width}px`;
            pdfCanvas.style.height = `${scaled.height}px`;
            pdfCanvas.getContext("2d")!.drawImage(offscreen, 0, 0);
        } finally {
            rendering = false;
            if (pendingSlide !== null) {
                const next = pendingSlide;
                pendingSlide = null;
                void renderSlide(next);
            }
        }
    }

    function syncWhiteboardSize() {
        if (!whiteboardCanvas || !container) return;
        const dpr = window.devicePixelRatio || 1;
        // Use the same aspect ratio as A4 landscape (4:3) by default,
        // but fit within the container.
        const cw = container.clientWidth;
        const ch = container.clientHeight;

        // Use a fixed 4:3 aspect ratio for the whiteboard page.
        const aspect = 4 / 3;
        let w = cw;
        let h = w / aspect;
        if (h > ch) {
            h = ch;
            w = h * aspect;
        }

        whiteboardCanvas.width = Math.round(w * dpr);
        whiteboardCanvas.height = Math.round(h * dpr);
        whiteboardCanvas.style.width = `${Math.round(w)}px`;
        whiteboardCanvas.style.height = `${Math.round(h)}px`;

        // Fill with white
        const ctx = whiteboardCanvas.getContext("2d")!;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, whiteboardCanvas.width, whiteboardCanvas.height);
    }

    // PDF navigation
    function prevSlide() {
        if (slide <= 0) return;
        send({ type: "slide_change", source: "pdf", slide: slide - 1 });
    }

    function nextSlide() {
        if (slide >= pages - 1) return;
        send({ type: "slide_change", source: "pdf", slide: slide + 1 });
    }

    // Whiteboard navigation
    function prevWbSlide() {
        if (wbSlide <= 0) return;
        send({
            type: "slide_change",
            source: "whiteboard",
            slide: wbSlide - 1,
        });
    }

    function nextWbSlide() {
        if (wbSlide >= wbPages - 1) {
            // Auto-add a new page
            send({ type: "whiteboard_add_page" });
        } else {
            send({
                type: "slide_change",
                source: "whiteboard",
                slide: wbSlide + 1,
            });
        }
    }

    // ── Viewer click-to-navigate ──────────────────────────────────────────────
    // Viewers have no nav bar, so a click on the left half of the slide area
    // goes to the previous slide and a click on the right half advances to the
    // next slide. In whiteboard mode navigation is presenter-only, so we skip it.
    function onViewerClick(e: MouseEvent) {
        if ($deviceRole !== "viewer") return;
        if ($whiteboardMode) return;
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const isLeftHalf = e.clientX - rect.left < rect.width / 4;
        if (isLeftHalf) {
            prevSlide();
        } else {
            nextSlide();
        }
    }

    // Resize observer for PDF mode
    $effect(() => {
        if (!container) return;
        const observer = new ResizeObserver(() => {
            if ($whiteboardMode) {
                syncWhiteboardSize();
            } else if (pdfDoc) {
                void renderSlide($currentSlide);
            }
        });
        observer.observe(container);
        return () => observer.disconnect();
    });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="pdf-container" bind:this={container} onclick={onViewerClick}>
    {#if loadError && !isWhiteboard}
        <p class="hint hint--error">{loadError}</p>
    {:else if $activePdfPath && !pdfDoc && !isWhiteboard}
        <p class="hint">Loading…</p>
    {/if}

    <!-- PDF canvas: hidden in whiteboard mode -->
    <canvas
        bind:this={pdfCanvas}
        style="display: {isWhiteboard ? 'none' : 'block'};"
    ></canvas>

    <!-- Whiteboard canvas: shown in whiteboard mode, sized to container -->
    <canvas
        bind:this={whiteboardCanvas}
        class="whiteboard-canvas"
        style="display: {isWhiteboard ? 'block' : 'none'};"
    ></canvas>

    <AnnotationCanvas
        pdfCanvas={isWhiteboard ? undefined : pdfCanvas}
        whiteboardCanvas={isWhiteboard ? whiteboardCanvas : undefined}
    />
</div>

{#if $deviceRole !== "viewer"}
    <div class="nav-bar">
        {#if isWhiteboard}
            <button onclick={prevWbSlide} disabled={wbSlide <= 0}>← Prev</button
            >
            <span>{wbPages > 0 ? `${wbSlide + 1} / ${wbPages}` : "—"}</span>
            <button onclick={nextWbSlide}>Next →</button>
        {:else}
            <button onclick={prevSlide} disabled={slide <= 0}>← Prev</button>
            <span>{pages > 0 ? `${slide + 1} / ${pages}` : "—"}</span>
            <button onclick={nextSlide} disabled={slide >= pages - 1}
                >Next →</button
            >
        {/if}
    </div>
{/if}

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
    .whiteboard-canvas {
        background: #ffffff;
    }
    .hint {
        color: #888;
        position: absolute;
    }
    .hint--error {
        color: #f87171;
    }
    .nav-bar {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 1.5rem;
        padding: 0.5rem;
        background: #222;
        color: #ddd;
        font-size: 0.95rem;
    }
    .nav-bar button {
        padding: 0.4rem 1.2rem;
        font-size: 0.95rem;
        cursor: pointer;
    }
    .nav-bar button:disabled {
        opacity: 0.3;
        cursor: default;
    }
</style>
