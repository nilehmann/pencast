<script lang="ts">
    import {
        currentSlide,
        annotations,
        deviceRole,
        activeTool,
        selectedStrokeIds,
        pendingStrokes,
        movePreviewStrokes,
        activeColor,
        activeThickness,
        whiteboardMode,
        whiteboardSlide,
        whiteboardAnnotations,
        clipboard,
    } from "./stores";
    import { drawStroke } from "./draw";
    import {
        getStrokeColor,
        type AnnotationStroke,
        type Point,
    } from "../../shared/types";
    import {
        getHandles,
        computeBoundingBox,
        bboxCorners,
        circleHandlePoints,
        hitTestShape,
        CIRCLE_HANDLE_TOP,
        CIRCLE_HANDLE_CENTER,
        CIRCLE_HANDLE_ROTATE,
    } from "./geometry";
    import {
        DrawGesture,
        SelectGesture,
        PointerDispatcher,
        isSelectableTool,
        activeContext,
    } from "./gestures.svelte";
    import ContextMenu from "./ContextMenu.svelte";

    // ---------------------------------------------------------------------------
    // Props
    // ---------------------------------------------------------------------------

    interface Props {
        sourceCanvas: HTMLCanvasElement | undefined;
    }
    let { sourceCanvas }: Props = $props();

    // ---------------------------------------------------------------------------
    // Canvas ref + gesture objects
    // ---------------------------------------------------------------------------

    let canvas = $state<HTMLCanvasElement>(undefined!);

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
        if (!canvas) return;
        const onPointerDown = (e: PointerEvent) => dispatcher.onPointerDown(e);
        const onPointerMove = (e: PointerEvent) => dispatcher.onPointerMove(e);
        const onPointerUp = (e: PointerEvent) => dispatcher.onPointerUp(e);
        const onPointerCancel = (e: PointerEvent) =>
            dispatcher.onPointerCancel(e);
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
        canvas.width = sourceCanvas.width;
        canvas.height = sourceCanvas.height;
        canvas.style.width = sourceCanvas.style.width;
        canvas.style.height = sourceCanvas.style.height;
        redraw();
    }

    // React to tap-on-selected trigger from SelectGesture
    $effect(() => {
        const trigger = select.selectionMenuTrigger;
        if (!trigger) return;
        select.selectionMenuTrigger = null;

        const activeSlide = $whiteboardMode ? $whiteboardSlide : $currentSlide;
        const activeAnns = $whiteboardMode
            ? $whiteboardAnnotations
            : $annotations;
        const selected = (activeAnns[activeSlide] ?? []).filter((s) =>
            $selectedStrokeIds.has(s.id),
        );
        if (selected.length === 0) return;

        const box = computeBoundingBox(selected);
        contextMenu = {
            kind: "selection",
            cssX:
                canvas.offsetLeft +
                ((box.minX + box.maxX) / 2) * canvas.offsetWidth,
            cssY: canvas.offsetTop + box.minY * canvas.offsetHeight,
            normX: trigger.x,
            normY: trigger.y,
        };
    });

    // Dismiss context menu on slide change
    $effect(() => {
        void $currentSlide;
        void $whiteboardSlide;
        contextMenu = null;
    });

    // ---------------------------------------------------------------------------
    // Long-press (paste menu)
    // ---------------------------------------------------------------------------

    const LONG_PRESS_MS = 500;
    const LONG_PRESS_MOVE_PX = 10;
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;
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
        if ($deviceRole !== "presenter") return;
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
            if ($activeTool === "select" && e.changedTouches.length > 0) {
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
        const ids = $selectedStrokeIds;
        if (ids.size === 0) return; // nothing selected, nothing to do

        const { normX, normY } = touchToCoords(touch);
        const activeSlide = $whiteboardMode ? $whiteboardSlide : $currentSlide;
        const activeAnns = $whiteboardMode
            ? $whiteboardAnnotations
            : $annotations;

        const selectable = (activeAnns[activeSlide] ?? []).filter((s) =>
            isSelectableTool(s.tool),
        );
        const hit = selectable
            .slice()
            .reverse()
            .find((s) => hitTestShape(s, { x: normX, y: normY }));

        if (!hit || !ids.has(hit.id)) return; // not a selected stroke → ignore

        // Tapped an already-selected stroke → open selection menu
        const selected = (activeAnns[activeSlide] ?? []).filter((s) =>
            ids.has(s.id),
        );
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
    }

    function fireLongPress(touch: Touch): void {
        if ($clipboard.length === 0) return;
        const { normX, normY, cssX, cssY } = touchToCoords(touch);

        // Only open paste menu if no shape is under the finger.
        const activeSlide = $whiteboardMode ? $whiteboardSlide : $currentSlide;
        const activeAnns = $whiteboardMode
            ? $whiteboardAnnotations
            : $annotations;
        const selectable = (activeAnns[activeSlide] ?? []).filter((s) =>
            isSelectableTool(s.tool),
        );
        const hit = selectable
            .slice()
            .reverse()
            .find((s) => hitTestShape(s, { x: normX, y: normY }));
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
                select.paste({ x: contextMenu.normX, y: contextMenu.normY });
                break;
        }
        contextMenu = null;
        redraw();
    }

    // Redraw on slide or annotations change (PDF or whiteboard)
    $effect(() => {
        void $currentSlide;
        void $annotations;
        void $whiteboardMode;
        void $whiteboardSlide;
        void $whiteboardAnnotations;
        void $activeTool;
        void $selectedStrokeIds;
        void $pendingStrokes;
        void $movePreviewStrokes;
        syncSize();
        redraw();
    });

    // ---------------------------------------------------------------------------
    // Coordinate helpers
    // ---------------------------------------------------------------------------

    function normToCanvas(p: Point): { x: number; y: number } {
        return { x: p.x * canvas.width, y: p.y * canvas.height };
    }

    // ---------------------------------------------------------------------------
    // Redraw
    // ---------------------------------------------------------------------------

    function redraw() {
        if (!canvas) return;
        const ctx = canvas.getContext("2d")!;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const activeSlide = $whiteboardMode ? $whiteboardSlide : $currentSlide;
        const activeAnnotations = $whiteboardMode
            ? $whiteboardAnnotations
            : $annotations;
        const allStrokes = activeAnnotations[activeSlide] ?? [];

        if (
            $activeTool === "select" &&
            (select.phase === "moving" ||
                select.phase === "pending-move" ||
                select.phase === "resizing" ||
                select.phase === "rotating" ||
                select.phase === "scaling")
        ) {
            // During drag: render ghosts in place of originals
            const ghostMap = new Map<string, AnnotationStroke>();
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
            for (const g of activeGhosts) ghostMap.set(g.id, g);

            for (const stroke of allStrokes) {
                const ghost = ghostMap.get(stroke.id);
                if (ghost) {
                    drawStroke(ctx, ghost, canvas.width, canvas.height);
                } else {
                    drawStroke(ctx, stroke, canvas.width, canvas.height);
                }
            }

            // During resize: draw the active handle dot
            if (select.phase === "resizing") {
                drawResizeHandles(ctx, activeGhosts);
            }
            // During rotate: draw all handles on the ghost
            if (select.phase === "rotating" && select.rotateGhost) {
                drawSingleHandles(ctx, select.rotateGhost);
            }
            // During scale: draw all handles on the ghost
            if (select.phase === "scaling" && select.scaleGhost) {
                drawSingleHandles(ctx, select.scaleGhost);
            }
            // During move: no handles
        } else {
            // Normal rendering
            for (const stroke of allStrokes) {
                const preview = $movePreviewStrokes.get(stroke.id);
                drawStroke(ctx, preview ?? stroke, canvas.width, canvas.height);
            }

            if ($activeTool === "select") {
                const ids = $selectedStrokeIds;
                const selected = allStrokes.filter((s) => ids.has(s.id));

                if (selected.length === 1) {
                    drawSingleHandles(ctx, selected[0]);
                } else if (selected.length > 1) {
                    drawGroupHandles(ctx, selected);
                }
            }
        }

        // Render in-flight pending strokes (skip our own to avoid doubling the live preview)
        for (const [, pending] of $pendingStrokes) {
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

        // Draw in-progress stroke preview (presenter only, all redraw paths)
        if (draw.currentPoints.length >= 2) {
            const previewTool =
                $activeTool === "perfect-circle" ? "ellipse" : $activeTool;
            drawStroke(
                ctx,
                {
                    id: "preview",
                    tool: previewTool,
                    color: getStrokeColor($activeTool, $activeColor),
                    thickness: $activeThickness,
                    points: draw.currentPoints,
                },
                canvas.width,
                canvas.height,
            );
        }

        // Lasso overlay
        if (select.phase === "lasso" && select.lassoPoints.length >= 2) {
            drawLasso(ctx);
        }
    }

    // ---------------------------------------------------------------------------
    // Rendering helpers: handles and lasso
    // ---------------------------------------------------------------------------

    function drawDot(
        ctx: CanvasRenderingContext2D,
        p: Point,
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

    function drawSingleHandles(
        ctx: CanvasRenderingContext2D,
        stroke: AnnotationStroke,
    ) {
        if (stroke.tool === "ink" || stroke.tool === "highlighter") {
            // Freehand strokes: show a dashed bounding box only (move only, no resize handles)
            const box = computeBoundingBox([stroke]);
            const corners = bboxCorners(box);
            drawDashedRect(ctx, corners);
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

        for (const handle of getHandles(stroke)) {
            drawDot(ctx, handle);
        }
    }

    function drawRotationHandle(ctx: CanvasRenderingContext2D, p: Point) {
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
    style="position: absolute; touch-action: none; pointer-events: {$deviceRole ===
    'presenter'
        ? 'auto'
        : 'none'};"
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
