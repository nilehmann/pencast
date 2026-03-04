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
    } from "./stores";
    import { send } from "./ws-client";
    import AnnotationCanvas from "./AnnotationCanvas.svelte";

    pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

    let canvas = $state<HTMLCanvasElement>(undefined!);
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

    // Load PDF when activePdfPath changes
    $effect(() => {
        const path = $activePdfPath;
        const token = $authToken;
        if (!path) return;
        void loadPdf(path, token, ++loadGen);
    });

    // Re-render when slide changes
    $effect(() => {
        const s = $currentSlide;
        if (pdfDoc) void renderSlide(s);
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
            logout(true); // token is invalid — full logout to PIN screen
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
        if (!pdfDoc || !canvas || !container) return;
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
            canvas.width = scaled.width * dpr;
            canvas.height = scaled.height * dpr;
            canvas.style.width = `${scaled.width}px`;
            canvas.style.height = `${scaled.height}px`;

            const ctx = canvas.getContext("2d")!;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            await page.render({ canvasContext: ctx, viewport: scaled }).promise;
            page.cleanup();
        } finally {
            rendering = false;
            if (pendingSlide !== null) {
                const next = pendingSlide;
                pendingSlide = null;
                void renderSlide(next);
            }
        }
    }

    function prevSlide() {
        if (slide <= 0) return;
        send({ type: "slide_change", slide: slide - 1 });
    }

    function nextSlide() {
        if (slide >= pages - 1) return;
        send({ type: "slide_change", slide: slide + 1 });
    }

    // Resize observer
    $effect(() => {
        if (!container) return;
        const observer = new ResizeObserver(() => {
            if (pdfDoc) void renderSlide($currentSlide);
        });
        observer.observe(container);
        return () => observer.disconnect();
    });
</script>

<div class="pdf-container" bind:this={container}>
    {#if loadError}
        <p class="hint hint--error">{loadError}</p>
    {:else if !$activePdfPath}
        <p class="hint">No PDF loaded</p>
    {:else if !pdfDoc}
        <p class="hint">Loading…</p>
    {/if}
    <canvas bind:this={canvas}></canvas>
    <AnnotationCanvas pdfCanvas={canvas} />
</div>

{#if $deviceRole !== "presenter"}
    <div class="nav-bar">
        <button onclick={prevSlide} disabled={slide <= 0}>← Prev</button>
        <span>{pages > 0 ? `${slide + 1} / ${pages}` : "—"}</span>
        <button onclick={nextSlide} disabled={slide >= pages - 1}>Next →</button
        >
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
