<script lang="ts">
    import { untrack } from "svelte";
    import { stores } from "./stores.svelte";
    import { drawStroke } from "./draw";
    import {
        getStrokeColor,
        type AnnotationSource,
        type AnnotationStroke,
        type NormalizedPoint,
        type CanvasPoint,
    } from "../../shared/types";
    import {
        getHandles,
        computeBoundingBox,
        bboxCorners,
        circleHandlePoints,
        boxHandlePoints,
        hitTestShape,
        CIRCLE_HANDLE_TOP,
        CIRCLE_HANDLE_CENTER,
        CIRCLE_HANDLE_ROTATE,
        BOX_HANDLE_TL,
        BOX_HANDLE_TR,
        BOX_HANDLE_BR,
        BOX_HANDLE_BL,
        BOX_HANDLE_CENTER,
        BOX_HANDLE_ROTATE,
    } from "./geometry";
    import {
        DrawGesture,
        SelectGesture,
        PointerDispatcher,
        isSelectableTool,
    } from "./gestures.svelte";
    import ContextMenu from "./ContextMenu.svelte";

    // ---------------------------------------------------------------------------
    // Props
    // ---------------------------------------------------------------------------

    interface Props {
        sourceCanvas: HTMLElement | undefined;
        readonly?: boolean;
    }
    let { sourceCanvas, readonly = false }: Props = $props();

    // ---------------------------------------------------------------------------
    // Canvas ref + gesture objects
    // ---------------------------------------------------------------------------

    let canvas = $state<HTMLCanvasElement>(undefined!);

    // Offscreen canvas caches finalized (committed) strokes so we only
    // re-render them when they actually change, not on every pointer move.
    const staticCanvas = document.createElement("canvas");
    let staticDirty = true;

    const draw = new DrawGesture(() => canvas);
    const select = new SelectGesture(() => canvas);
    const dispatcher = new PointerDispatcher(
        () => canvas,
        draw,
        select,
        redraw,
    );

    // ---------------------------------------------------------------------------
    // Context menu state
    // ---------------------------------------------------------------------------

    type ContextMenuState = {
        kind: "selection" | "paste";
        cssX: number; // menu anchor CSS px relative to container
        cssY: number;
        normX: number; // normalized coords (paste target)
        normY: number;
    } | null;

    type ContextMenuAction = "copy" | "paste" | "cut" | "delete" | "duplicate";

    let contextMenu = $state<ContextMenuState>(null);

    // ---------------------------------------------------------------------------
    // Rendering constants
    // ---------------------------------------------------------------------------

    const HANDLE_DRAW_PX = 10;
    const HANDLE_COLOR = "#3b82f6";
    const LASSO_DASH: number[] = [6, 4];

    // ---------------------------------------------------------------------------
    // Canvas sizing
    // ---------------------------------------------------------------------------

    $effect(() => {
        if (!canvas || readonly) return;
        const onPointerDown = (e: PointerEvent) => {
            if (e.pointerType === "pen") penPointerActive = true;
            dispatcher.onPointerDown(e);
        };
        const onPointerMove = (e: PointerEvent) => dispatcher.onPointerMove(e);
        const onPointerUp = (e: PointerEvent) => {
            if (e.pointerType === "pen") penPointerActive = false;
            dispatcher.onPointerUp(e);
        };
        const onPointerCancel = (e: PointerEvent) => {
            if (e.pointerType === "pen") penPointerActive = false;
            dispatcher.onPointerCancel(e);
        };
        canvas.addEventListener("pointerdown", onPointerDown, {
            passive: false,
        });
        canvas.addEventListener("pointermove", onPointerMove, {
            passive: false,
        });
        canvas.addEventListener("pointerup", onPointerUp, { passive: false });
        canvas.addEventListener("pointercancel", onPointerCancel, {
            passive: false,
        });

        // iOS Scribble (iPadOS 14+) intercepts Apple Pencil PointerEvents at the
        // UIKit layer when it recognises a potential handwriting gesture, causing
        // entire strokes to go missing.  Adding a touchmove listener that calls
        // preventDefault() stops Scribble from claiming the gesture before it
        // reaches the web content.  Touch events are not fired by the stylus
        // itself, but the presence of this handler is enough to signal to the
        // system that the page is handling input and Scribble should back off.
        // See: https://mikepk.com/2020/10/iOS-safari-scribble-bug
        //      https://bugs.webkit.org/show_bug.cgi?id=217430
        const suppressScribble = (e: TouchEvent) => e.preventDefault();
        canvas.addEventListener("touchmove", suppressScribble, {
            passive: false,
        });

        const onTouchStartCB = (e: TouchEvent) => onTouchStart(e);
        const onTouchMoveCB = (e: TouchEvent) => onTouchMove(e);
        const onTouchEndCB = (e: TouchEvent) => onTouchEnd(e);
        const onTouchCancelCB = (e: TouchEvent) => onTouchCancel(e);

        canvas.addEventListener("touchstart", onTouchStartCB, {
            passive: true,
        });
        canvas.addEventListener("touchmove", onTouchMoveCB, { passive: true });
        canvas.addEventListener("touchend", onTouchEndCB, { passive: true });
        canvas.addEventListener("touchcancel", onTouchCancelCB, {
            passive: true,
        });

        return () => {
            canvas.removeEventListener("pointerdown", onPointerDown);
            canvas.removeEventListener("pointermove", onPointerMove);
            canvas.removeEventListener("pointerup", onPointerUp);
            canvas.removeEventListener("pointercancel", onPointerCancel);
            canvas.removeEventListener("touchmove", suppressScribble);
            canvas.removeEventListener("touchstart", onTouchStartCB);
            canvas.removeEventListener("touchmove", onTouchMoveCB);
            canvas.removeEventListener("touchend", onTouchEndCB);
            canvas.removeEventListener("touchcancel", onTouchCancelCB);
        };
    });

    $effect(() => {
        if (!sourceCanvas) return;
        const observer = new ResizeObserver(() => syncSize());
        observer.observe(sourceCanvas);
        syncSize();
        return () => observer.disconnect();
    });

    function syncSize() {
        if (!sourceCanvas || !canvas) return;
        if (sourceCanvas instanceof HTMLCanvasElement) {
            canvas.width = sourceCanvas.width;
            canvas.height = sourceCanvas.height;
            canvas.style.width = sourceCanvas.style.width;
            canvas.style.height = sourceCanvas.style.height;
        } else {
            const dpr = window.devicePixelRatio || 1;
            canvas.width = Math.round(sourceCanvas.clientWidth * dpr);
            canvas.height = Math.round(sourceCanvas.clientHeight * dpr);
            canvas.style.width = `${sourceCanvas.clientWidth}px`;
            canvas.style.height = `${sourceCanvas.clientHeight}px`;
        }
        staticDirty = true;
        redraw();
    }

    // React to tap-on-selected trigger from SelectGesture
    $effect(() => {
        const trigger = select.selectionMenuTrigger;
        if (!trigger) return;
        select.selectionMenuTrigger = null;

        const allStrokes: AnnotationStroke[] = stores.activeStrokes();
        const selected = allStrokes.filter((s) =>
            stores.selectedStrokeIds.has(s.id),
        );
        if (selected.length === 0) return;

        const box = computeBoundingBox(selected);
        contextMenu = {
            kind: "selection",
            cssX:
                canvas.offsetLeft +
                ((box.minX + box.maxX) / 2) * canvas.offsetWidth,
            cssY: canvas.offsetTop + box.minY * canvas.offsetHeight,
            normX: trigger.normX,
            normY: trigger.normY,
        };
    });

    // Dismiss context menu on slide change
    $effect(() => {
        void stores.activePdf?.currentSlide;
        void stores.whiteboard.slide;
        void stores.activeHtml?.slide;
        contextMenu = null;
    });

    // ---------------------------------------------------------------------------
    // Long-press (paste menu)
    // ---------------------------------------------------------------------------

    const LONG_PRESS_MS = 500;
    const LONG_PRESS_MOVE_PX = 10;
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;
    let penPointerActive = false;
    let longPressStartX = 0;
    let longPressStartY = 0;

    function touchToCoords(touch: Touch) {
        const rect = canvas.getBoundingClientRect();
        const normX = Math.max(
            0,
            Math.min(1, (touch.clientX - rect.left) / rect.width),
        );
        const normY = Math.max(
            0,
            Math.min(1, (touch.clientY - rect.top) / rect.height),
        );
        return {
            normX,
            normY,
            cssX: canvas.offsetLeft + normX * canvas.offsetWidth,
            cssY: canvas.offsetTop + normY * canvas.offsetHeight,
        };
    }

    function onTouchStart(e: TouchEvent): void {
        if (stores.deviceRole !== "presenter") return;
        if (penPointerActive) return;
        if (e.touches.length !== 1) {
            clearLongPress();
            return;
        }
        const t = e.touches[0];
        longPressStartX = t.clientX;
        longPressStartY = t.clientY;
        longPressTimer = setTimeout(() => {
            longPressTimer = null;
            fireLongPress(t);
        }, LONG_PRESS_MS);
    }

    function onTouchMove(e: TouchEvent): void {
        if (!longPressTimer || !e.touches[0]) return;
        if (
            Math.hypot(
                e.touches[0].clientX - longPressStartX,
                e.touches[0].clientY - longPressStartY,
            ) > LONG_PRESS_MOVE_PX
        )
            clearLongPress();
    }

    function onTouchEnd(e: TouchEvent): void {
        if (longPressTimer !== null) {
            // Touch ended before long-press fired → it's a quick tap
            clearLongPress();
            if (e.changedTouches.length > 0) {
                fireTapSelect(e.changedTouches[0]);
            }
        }
        // longPressTimer === null means either the long-press already fired
        // or the touch moved too far (clearLongPress called from onTouchMove).
        // In both cases we do nothing here.
    }
    function onTouchCancel(_e: TouchEvent): void {
        clearLongPress();
    }

    function clearLongPress(): void {
        if (longPressTimer !== null) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    }

    function fireTapSelect(touch: Touch): void {
        const { normX, normY } = touchToCoords(touch);
        const allStrokes: AnnotationStroke[] = stores.activeStrokes();
        const selectable = allStrokes.filter((s) => isSelectableTool(s.tool));
        const hit = selectable
            .slice()
            .reverse()
            .find((s) => hitTestShape(s, { normX, normY }));

        if (!hit) return; // miss → do nothing

        const ids = stores.selectedStrokeIds;
        if (ids.size > 0 && ids.has(hit.id)) {
            // Tapped an already-selected stroke → open selection menu
            const selected = allStrokes.filter((s) => ids.has(s.id));
            const box = computeBoundingBox(selected);
            contextMenu = {
                kind: "selection",
                cssX:
                    canvas.offsetLeft +
                    ((box.minX + box.maxX) / 2) * canvas.offsetWidth,
                cssY: canvas.offsetTop + box.minY * canvas.offsetHeight,
                normX,
                normY,
            };
        } else {
            // Tap on unselected stroke → select it and switch to select tool
            stores.selectedStrokeIds = new Set([hit.id]);
            stores.activeTool = "select";
        }
    }

    function fireLongPress(touch: Touch): void {
        if (stores.clipboard.length === 0) return;
        const { normX, normY, cssX, cssY } = touchToCoords(touch);

        // Only open paste menu if no shape is under the finger.
        const allStrokes: AnnotationStroke[] = stores.activeStrokes();
        const selectable = allStrokes.filter((s) => isSelectableTool(s.tool));
        const hit = selectable
            .slice()
            .reverse()
            .find((s) => hitTestShape(s, { normX, normY }));
        if (hit) return;

        contextMenu = { kind: "paste", cssX, cssY, normX, normY };
    }

    // ---------------------------------------------------------------------------
    // Context menu callbacks
    // ---------------------------------------------------------------------------
    //
    function onContextMenuAction(action: ContextMenuAction): void {
        switch (action) {
            case "cut":
                select.cut();
                break;
            case "duplicate":
                select.duplicate();
                break;
            case "copy":
                select.copy();
                break;
            case "delete":
                select.delete();
                break;
            case "paste":
                if (!contextMenu) return;
                select.paste({
                    normX: contextMenu.normX,
                    normY: contextMenu.normY,
                });
                break;
        }
        contextMenu = null;
        redraw();
    }

    // Effect A: finalized strokes changed → rebuild static layer + redraw.
    // Watches everything that affects which committed strokes are rendered
    // (slide/annotations, move previews, drag-phase ghosts).
    $effect(() => {
        void stores.activePdf;
        void stores.activeMode;
        void stores.whiteboard;
        void stores.activeHtml;
        void stores.movePreviewHiddenIds;
        void select.phase;
        staticDirty = true;
        untrack(() => {
            syncSize();
            redraw();
        });
    });

    // Effect B: dynamic-only content changed → redraw without rebuilding
    // the static layer.  Pending strokes, selection handles, and tool
    // changes are cheap to repaint on every frame.
    // Ghost fields (moveGhosts, resizeGhosts, rotateGhost, scaleGhost) are
    // NOT watched here — PointerDispatcher drives those redraws imperatively
    // after every pointer event, matching the DrawGesture.currentPoints pattern.
    $effect(() => {
        void stores.activeTool;
        void stores.selectedStrokeIds;
        void stores.pendingStrokes;
        void stores.movePreviewStrokes;
        untrack(() => redraw());
    });

    // ---------------------------------------------------------------------------
    // Coordinate helpers
    // ---------------------------------------------------------------------------

    function normToCanvas(p: NormalizedPoint): CanvasPoint {
        return { x: p.normX * canvas.width, y: p.normY * canvas.height };
    }

    // ---------------------------------------------------------------------------
    // Redraw
    // ---------------------------------------------------------------------------

    function redraw() {
        if (!canvas) return;

        // ── Sync offscreen canvas size ──────────────────────────────
        if (
            staticCanvas.width !== canvas.width ||
            staticCanvas.height !== canvas.height
        ) {
            staticCanvas.width = canvas.width;
            staticCanvas.height = canvas.height;
            staticDirty = true;
        }

        // ── Static layer: finalized strokes (only when dirty) ──────
        if (staticDirty) {
            const sctx = staticCanvas.getContext("2d")!;
            sctx.clearRect(0, 0, staticCanvas.width, staticCanvas.height);

            const allStrokes: AnnotationStroke[] = stores.activeStrokes();

            const isDragging =
                select.phase === "moving" ||
                select.phase === "resizing" ||
                select.phase === "rotating" ||
                select.phase === "scaling";

            if (isDragging) {
                // During drag: skip selected strokes — ghosts are drawn in the dynamic layer
                const selectedIds = stores.selectedStrokeIds;
                for (const stroke of allStrokes) {
                    if (!selectedIds.has(stroke.id)) {
                        drawStroke(sctx, stroke, canvas.width, canvas.height);
                    }
                }
            } else {
                // Normal rendering: exclude strokes being previewed remotely
                const hiddenIds = stores.movePreviewHiddenIds;
                for (const stroke of allStrokes) {
                    if (!hiddenIds.has(stroke.id)) {
                        drawStroke(sctx, stroke, canvas.width, canvas.height);
                    }
                }
            }

            staticDirty = false;
        }

        // ── Composite static layer onto visible canvas ─────────────
        const ctx = canvas.getContext("2d")!;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(staticCanvas, 0, 0);

        // ── Dynamic: selection / drag handles ──────────────────────
        if (
            select.phase === "moving" ||
            select.phase === "pending-move" ||
            select.phase === "resizing" ||
            select.phase === "rotating" ||
            select.phase === "scaling"
        ) {
            const activeGhosts =
                select.phase === "moving"
                    ? select.moveGhosts
                    : select.phase === "resizing"
                      ? select.resizeGhosts
                      : select.phase === "rotating" && select.rotateGhost
                        ? [select.rotateGhost]
                        : select.phase === "scaling" && select.scaleGhost
                          ? [select.scaleGhost]
                          : [];

            // Render ghosts in dynamic layer (originals are hidden in static layer during drag)
            if (select.phase !== "pending-move") {
                for (const ghost of activeGhosts) {
                    drawStroke(ctx, ghost, canvas.width, canvas.height);
                }
            }

            if (select.phase === "resizing") {
                drawResizeHandles(ctx, activeGhosts);
            }
            if (select.phase === "rotating" && select.rotateGhost) {
                drawSingleHandles(ctx, select.rotateGhost);
            }
            if (select.phase === "scaling" && select.scaleGhost) {
                drawSingleHandles(ctx, select.scaleGhost);
            }
        } else if (stores.activeTool === "select") {
            const allStrokes: AnnotationStroke[] = stores.activeStrokes();
            const ids = stores.selectedStrokeIds;
            const selected = allStrokes.filter((s) => ids.has(s.id));

            if (selected.length === 1) {
                drawSingleHandles(ctx, selected[0]);
            } else if (selected.length > 1) {
                drawGroupHandles(ctx, selected);
            }
        }

        // ── Dynamic: pending remote strokes ────────────────────────
        const activeSource: AnnotationSource = stores.activeMode.whiteboard
            ? "whiteboard"
            : stores.activeMode.base;
        const activeSlide = stores.activeSlide();
        for (const [, pending] of stores.pendingStrokes) {
            if (pending.source !== activeSource) continue;
            if (pending.slide !== activeSlide) continue;
            if (pending.points.length < 2) continue;
            if (pending.strokeId === draw.currentStrokeId) continue;
            drawStroke(
                ctx,
                {
                    id: pending.strokeId,
                    tool: pending.tool,
                    color: pending.color,
                    thickness: pending.thickness,
                    points: pending.points,
                },
                canvas.width,
                canvas.height,
            );
        }

        // ── Dynamic: remote move preview strokes ───────────────────
        for (const preview of stores.movePreviewStrokes.values()) {
            drawStroke(ctx, preview, canvas.width, canvas.height);
        }

        // ── Dynamic: in-progress stroke preview ────────────────────
        if (draw.currentPoints.length >= 2) {
            const previewTool =
                stores.activeTool === "perfect-circle"
                    ? "ellipse"
                    : stores.activeTool;
            drawStroke(
                ctx,
                {
                    id: "preview",
                    tool: previewTool,
                    color: getStrokeColor(
                        stores.activeTool,
                        stores.activeColor,
                    ),
                    thickness: stores.activeThickness,
                    points: draw.currentPoints,
                },
                canvas.width,
                canvas.height,
            );
        }

        // ── Dynamic: lasso overlay ─────────────────────────────────
        if (select.phase === "lasso" && select.lassoPoints.length >= 2) {
            drawLasso(ctx);
        }
    }

    // ---------------------------------------------------------------------------
    // Rendering helpers: handles and lasso
    // ---------------------------------------------------------------------------

    function drawDot(
        ctx: CanvasRenderingContext2D,
        p: NormalizedPoint,
        radiusPx = HANDLE_DRAW_PX,
    ) {
        const { x, y } = normToCanvas(p);
        ctx.beginPath();
        ctx.arc(x, y, radiusPx, 0, Math.PI * 2);
        ctx.fillStyle = HANDLE_COLOR;
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    function drawDashedRect(
        ctx: CanvasRenderingContext2D,
        corners: ReturnType<typeof bboxCorners>,
    ) {
        ctx.save();
        ctx.setLineDash(LASSO_DASH);
        ctx.strokeStyle = HANDLE_COLOR;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.7;
        const tl = normToCanvas(corners[0]);
        const br = normToCanvas(corners[2]);
        ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
        ctx.restore();
    }

    function drawRotatedBoxOutline(
        ctx: CanvasRenderingContext2D,
        corners: [
            NormalizedPoint,
            NormalizedPoint,
            NormalizedPoint,
            NormalizedPoint,
        ],
    ) {
        ctx.save();
        ctx.setLineDash(LASSO_DASH);
        ctx.strokeStyle = HANDLE_COLOR;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        const pts = corners.map(normToCanvas);
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
    }

    function drawSingleHandles(
        ctx: CanvasRenderingContext2D,
        stroke: AnnotationStroke,
    ) {
        if (stroke.tool === "ink" || stroke.tool === "highlighter") {
            const box = computeBoundingBox([stroke]);
            const corners = bboxCorners(box);
            drawDashedRect(ctx, corners);
            for (const corner of corners) {
                drawDot(ctx, corner);
            }
            return;
        }

        if (stroke.tool === "ellipse") {
            const handles = circleHandlePoints(
                stroke,
                canvas.width,
                canvas.height,
            );
            // Draw a dashed line from top cardinal to rotation handle
            const topC = normToCanvas(handles[CIRCLE_HANDLE_TOP]);
            const rotH = normToCanvas(handles[CIRCLE_HANDLE_ROTATE]);
            ctx.save();
            ctx.setLineDash([3, 3]);
            ctx.strokeStyle = HANDLE_COLOR;
            ctx.lineWidth = 1;
            ctx.globalAlpha = 0.6;
            ctx.beginPath();
            ctx.moveTo(topC.x, topC.y);
            ctx.lineTo(rotH.x, rotH.y);
            ctx.stroke();
            ctx.restore();

            // Cardinal + center handles as filled dots
            for (let i = 0; i <= CIRCLE_HANDLE_CENTER; i++) {
                drawDot(ctx, handles[i]);
            }
            // Rotation handle: distinct appearance (hollow diamond-ish, slightly smaller)
            drawRotationHandle(ctx, handles[CIRCLE_HANDLE_ROTATE]);
            return;
        }

        if (stroke.tool === "box") {
            const handles = boxHandlePoints(
                stroke,
                canvas.width,
                canvas.height,
            );
            // Draw rotated box outline as dashed polygon
            drawRotatedBoxOutline(ctx, [
                handles[BOX_HANDLE_TL],
                handles[BOX_HANDLE_TR],
                handles[BOX_HANDLE_BR],
                handles[BOX_HANDLE_BL],
            ]);
            // Draw dashed line from top-center to rotation handle
            const tlC = normToCanvas(handles[BOX_HANDLE_TL]);
            const trC = normToCanvas(handles[BOX_HANDLE_TR]);
            const topCenterC = {
                x: (tlC.x + trC.x) / 2,
                y: (tlC.y + trC.y) / 2,
            };
            const rotH = normToCanvas(handles[BOX_HANDLE_ROTATE]);
            ctx.save();
            ctx.setLineDash([3, 3]);
            ctx.strokeStyle = HANDLE_COLOR;
            ctx.lineWidth = 1;
            ctx.globalAlpha = 0.6;
            ctx.beginPath();
            ctx.moveTo(topCenterC.x, topCenterC.y);
            ctx.lineTo(rotH.x, rotH.y);
            ctx.stroke();
            ctx.restore();
            // Corner + center handles as filled dots
            for (let i = 0; i <= BOX_HANDLE_CENTER; i++) {
                drawDot(ctx, handles[i]);
            }
            // Rotation handle: diamond
            drawRotationHandle(ctx, handles[BOX_HANDLE_ROTATE]);
            return;
        }

        for (const handle of getHandles(stroke)) {
            drawDot(ctx, handle);
        }
    }

    function drawRotationHandle(
        ctx: CanvasRenderingContext2D,
        p: NormalizedPoint,
    ) {
        const { x, y } = normToCanvas(p);
        const r = HANDLE_DRAW_PX * 0.85;
        ctx.save();
        ctx.beginPath();
        // Diamond shape
        ctx.moveTo(x, y - r);
        ctx.lineTo(x + r, y);
        ctx.lineTo(x, y + r);
        ctx.lineTo(x - r, y);
        ctx.closePath();
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.strokeStyle = HANDLE_COLOR;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
    }

    function drawGroupHandles(
        ctx: CanvasRenderingContext2D,
        strokes: AnnotationStroke[],
    ) {
        const box = computeBoundingBox(strokes);
        const corners = bboxCorners(box);

        // Dashed bounding box rectangle
        drawDashedRect(ctx, corners);

        // Corner dots
        for (const corner of corners) {
            drawDot(ctx, corner);
        }
    }

    function drawResizeHandles(
        ctx: CanvasRenderingContext2D,
        ghosts: AnnotationStroke[],
    ) {
        if (select.resizeSingleStrokeId !== null) {
            // Single shape resize: draw only the active handle
            const ghost = ghosts[0];
            if (!ghost) return;
            const handles = getHandles(ghost, canvas.width, canvas.height);
            if (
                select.resizeHandleIndex >= 0 &&
                select.resizeHandleIndex < handles.length
            ) {
                drawDot(ctx, handles[select.resizeHandleIndex]);
            }
        } else {
            // Group resize: draw bounding box + active corner
            drawGroupHandles(ctx, ghosts);
        }
    }

    function drawLasso(ctx: CanvasRenderingContext2D) {
        ctx.save();
        ctx.setLineDash(LASSO_DASH);
        ctx.strokeStyle = "#6366f1";
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        const first = normToCanvas(select.lassoPoints[0]);
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < select.lassoPoints.length; i++) {
            const { x, y } = normToCanvas(select.lassoPoints[i]);
            ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();

        // Light fill
        ctx.globalAlpha = 0.05;
        ctx.fillStyle = "#6366f1";
        ctx.fill();
        ctx.restore();
    }
</script>

<canvas
    bind:this={canvas}
    style="position: absolute; touch-action: none; pointer-events: {readonly ||
    stores.deviceRole !== 'presenter'
        ? 'none'
        : 'auto'};"
></canvas>

{#if contextMenu !== null}
    <ContextMenu
        x={contextMenu.cssX}
        y={contextMenu.cssY}
        actions={contextMenu.kind === "selection"
            ? [
                  { id: "cut", name: "Cut" },
                  { id: "copy", name: "Copy" },
                  { id: "duplicate", name: "Duplicate" },
                  {
                      id: "delete",
                      name: "Delete",
                      danger: true,
                  },
              ]
            : [{ id: "paste", name: "Paste" }]}
        handler={onContextMenuAction}
        onclose={() => (contextMenu = null)}
    />
{/if}
