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
    import { prevSlide, nextSlide } from "./navigation";
    import AnnotationCanvas from "./AnnotationCanvas.svelte";
    import NavBar from "./NavBar.svelte";

    interface Props {
        onChangePdf?: () => void;
        onLoadHtml?: () => void;
        onChangeRole?: () => void;
    }
    let { onChangePdf, onLoadHtml, onChangeRole }: Props = $props();

    pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

    let pdfCanvas = $state<HTMLCanvasElement>(undefined!);
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

    // Re-render PDF slide when slide changes
    $effect(() => {
        const s = $currentSlide;
        if (pdfDoc) void renderSlide(s);
    });

    // Resize observer
    $effect(() => {
        if (!container) return;
        const observer = new ResizeObserver(() => {
            if (pdfDoc) void renderSlide($currentSlide);
        });
        observer.observe(container);
        return () => observer.disconnect();
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

    // Viewers have no nav bar, so a click on the left quarter of the slide area
    // goes to the previous slide and a click elsewhere advances to the next slide.
    function onViewerClick(e: MouseEvent) {
        if ($deviceRole !== "viewer") return;
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
    {:else if $activePdfPath && !pdfDoc}
        <p class="hint">Loading…</p>
    {/if}

    <canvas bind:this={pdfCanvas}></canvas>

    <AnnotationCanvas sourceCanvas={pdfCanvas} />
</div>

{#if $deviceRole !== "viewer"}
    <NavBar
        {slide}
        {pages}
        onPrev={prevSlide}
        onNext={nextSlide}
        {onChangePdf}
        {onLoadHtml}
        {onChangeRole}
    />
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
</style>
