<script lang="ts">
    import { stores } from "./stores.svelte";

    const SNAP_THRESHOLD = 20;
    const SNAP_PADDING = 12;
    const MIN_SIZE = 120;
    let canvas = $state<HTMLCanvasElement>(undefined!);
    let box = $state<HTMLDivElement>(undefined!);

    // Position & size (viewport pixels)
    let x = $state(SNAP_PADDING);
    let y = $state(SNAP_PADDING);
    let w = $state(Math.round(window.innerWidth * 0.2));
    let h = $state(Math.round(window.innerHeight * 0.2));

    let dragging = $state(false);
    let resizing = $state(false);
    let dragOffset = { dx: 0, dy: 0 };

    // Aspect ratio of the PDF page (updated on render)
    let pageAspect = 1; // width / height
    let renderedW = $state(0);
    let renderedH = $state(0);

    let previewSlide = $derived((stores.activePdf?.currentSlide ?? -1) + 1);
    let pageCount = $derived(stores.activePdf?.pageCount ?? 0);
    let isLastSlide = $derived(previewSlide >= pageCount);

    // Render preview when slide or pdfDoc changes
    let rendering = false;
    let pendingRender = false;
    // Render on slide/doc change
    $effect(() => {
        void previewSlide;
        void stores.pdfDoc;
        void renderPreview();
    });

    // Re-render on resize end
    $effect(() => {
        void w;
        void h;
        if (resizing) return;
        void renderPreview();
    });

    async function renderPreview() {
        const doc = stores.pdfDoc;
        if (!doc || !canvas) return;
        if (isLastSlide) {
            const ctx = canvas.getContext("2d");
            if (ctx) {
                canvas.width = 1;
                canvas.height = 1;
                ctx.clearRect(0, 0, 1, 1);
            }
            return;
        }
        if (rendering) {
            pendingRender = true;
            return;
        }
        rendering = true;
        try {
            const page = await doc.getPage(previewSlide + 1); // 1-based
            const vp = page.getViewport({ scale: 1 });
            pageAspect = vp.width / vp.height;

            // Fit to box
            const scale = Math.min(w / vp.width, h / vp.height);
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

            renderedW = scaled.width;
            renderedH = scaled.height;

            // Adjust box to match rendered aspect ratio
            h = Math.round(w / pageAspect);
        } finally {
            rendering = false;
            if (pendingRender) {
                pendingRender = false;
                void renderPreview();
            }
        }
    }

    // ── Drag ────────────────────────────────────────────────────────────────────
    function onDragStart(e: PointerEvent) {
        if (resizing) return;
        if ((e.target as HTMLElement).closest(".resize-handle")) return;
        dragging = true;
        dragOffset = { dx: e.clientX - x, dy: e.clientY - y };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        e.preventDefault();
    }

    function onDragMove(e: PointerEvent) {
        if (!dragging) return;
        x = e.clientX - dragOffset.dx;
        y = e.clientY - dragOffset.dy;
    }

    function onDragEnd(_e: PointerEvent) {
        if (!dragging) return;
        dragging = false;
        snapToEdge();
    }

    function snapToEdge() {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        // Snap X
        if (x < SNAP_THRESHOLD) x = SNAP_PADDING;
        else if (x + w > vw - SNAP_THRESHOLD) x = vw - w - SNAP_PADDING;
        // Snap Y
        if (y < SNAP_THRESHOLD) y = SNAP_PADDING;
        else if (y + h > vh - SNAP_THRESHOLD) y = vh - h - SNAP_PADDING;
    }

    // ── Resize ──────────────────────────────────────────────────────────────────
    function onResizeStart(e: PointerEvent) {
        resizing = true;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        e.preventDefault();
        e.stopPropagation();
    }

    function onResizeMove(e: PointerEvent) {
        if (!resizing) return;
        const maxW = window.innerWidth * 0.5;
        const maxH = window.innerHeight * 0.5;
        let newW = Math.max(MIN_SIZE, Math.min(maxW, e.clientX - x));
        let newH = Math.round(newW / pageAspect);
        if (newH > maxH) {
            newH = Math.max(MIN_SIZE, Math.min(maxH, e.clientY - y));
            newW = Math.round(newH * pageAspect);
        }
        w = newW;
        h = newH;
    }

    async function onResizeEnd(_e: PointerEvent) {
        await renderPreview();
        resizing = false;
    }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    class="slide-preview"
    class:dragging
    bind:this={box}
    style="left:{x}px; top:{y}px; width:{w}px; height:{h}px;"
    onpointerdown={(e) => {
        e.stopPropagation();
        onDragStart(e);
    }}
    onpointermove={onDragMove}
    onpointerup={onDragEnd}
    onpointercancel={onDragEnd}
>
    <div class="preview-body" class:resizing>
        {#if isLastSlide}
            <span class="no-next">No next slide</span>
        {:else}
            <canvas
                bind:this={canvas}
                style={resizing && renderedW > 0
                    ? `width:${renderedW}px;height:${renderedH}px;transform:scale(${w / renderedW},${h / renderedH});transform-origin:top left`
                    : ""}
            ></canvas>
        {/if}
    </div>
    <div
        class="resize-handle"
        onpointerdown={onResizeStart}
        onpointermove={onResizeMove}
        onpointerup={onResizeEnd}
        onpointercancel={onResizeEnd}
    ></div>
</div>

<style>
    .slide-preview {
        position: fixed;
        z-index: 40;
        display: flex;
        flex-direction: column;
        border-radius: 8px;
        overflow: hidden;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.6);
        border: 1px solid rgba(255, 255, 255, 0.12);
        touch-action: none;
        cursor: grab;
        user-select: none;
    }
    .slide-preview.dragging {
        cursor: grabbing;
    }
    .preview-body {
        flex: 1;
        background: #1a1a1a;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        min-height: 0;
    }
    .preview-body.resizing {
        align-items: flex-start;
        justify-content: flex-start;
    }
    .preview-body canvas {
        display: block;
    }
    .no-next {
        color: #666;
        font-size: 0.8rem;
    }
    .resize-handle {
        position: absolute;
        bottom: 0;
        right: 0;
        width: 50px;
        height: 50px;
        cursor: nwse-resize;
        touch-action: none;
    }
    .resize-handle::after {
        content: "";
        position: absolute;
        bottom: 3px;
        right: 3px;
        width: 8px;
        height: 8px;
        border-right: 2px solid rgba(255, 255, 255, 0.3);
        border-bottom: 2px solid rgba(255, 255, 255, 0.3);
    }
</style>
