<script lang="ts">
    import * as pdfjsLib from "pdfjs-dist";
    import type { PDFDocumentProxy } from "pdfjs-dist";
    import {
        authToken,
        activePdfPath,
        currentSlide,
        pageCount,
        deviceRole,
    } from "./stores";
    import { send } from "./ws-client";
    import AnnotationCanvas from "./AnnotationCanvas.svelte";

    pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

    let canvas = $state<HTMLCanvasElement>(undefined!);
    let container = $state<HTMLDivElement>(undefined!);
    let pdfDoc = $state<PDFDocumentProxy | null>(null);
    let rendering = false;
    let pendingSlide: number | null = null;

    let slide = $derived($currentSlide);
    let pages = $derived($pageCount);

    // Load PDF when activePdfPath changes
    $effect(() => {
        const path = $activePdfPath;
        const token = $authToken;
        if (!path) return;
        loadPdf(path, token);
    });

    // Re-render when slide changes
    $effect(() => {
        const s = $currentSlide;
        if (pdfDoc) renderSlide(s);
    });

    async function loadPdf(path: string, token: string) {
        pdfDoc = null;
        const url = `/api/pdf?path=${encodeURIComponent(path)}&token=${encodeURIComponent(token)}`;
        const res = await fetch(url);
        if (!res.ok) {
            console.error("Failed to fetch PDF");
            return;
        }
        const buffer = await res.arrayBuffer();
        pdfDoc = await pdfjsLib.getDocument({ data: buffer }).promise;
        pageCount.set(pdfDoc.numPages);
        renderSlide($currentSlide);
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
                renderSlide(next);
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
            if (pdfDoc) renderSlide($currentSlide);
        });
        observer.observe(container);
        return () => observer.disconnect();
    });
</script>

<div class="pdf-container" bind:this={container}>
    {#if !$activePdfPath}
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
