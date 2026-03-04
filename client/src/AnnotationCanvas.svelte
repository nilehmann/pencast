<script lang="ts">
    import {
        currentSlide,
        annotations,
        deviceRole,
        activeTool,
        activeColor,
        activeThickness,
        selectedStrokeIds,
    } from "./stores";
    import { drawStroke } from "./draw";
    import type { AnnotationStroke, Point } from "../../shared/types";
    import {
        getHandles,
        computeBoundingBox,
        bboxCorners,
        circleHandlePoints,
        CIRCLE_HANDLE_TOP,
        CIRCLE_HANDLE_CENTER,
        CIRCLE_HANDLE_ROTATE,
    } from "./geometry";
    import { DrawGesture, SelectGesture } from "./gestures.svelte";

    // ---------------------------------------------------------------------------
    // Props
    // ---------------------------------------------------------------------------

    interface Props {
        pdfCanvas: HTMLCanvasElement | undefined;
    }
    let { pdfCanvas }: Props = $props();

    // ---------------------------------------------------------------------------
    // Canvas ref + gesture objects
    // ---------------------------------------------------------------------------

    let canvas = $state<HTMLCanvasElement>(undefined!);

    const draw = new DrawGesture(() => canvas);
    const select = new SelectGesture(() => canvas);

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
        canvas.addEventListener("pointerdown", onPointerDown, {
            passive: false,
        });
        canvas.addEventListener("pointermove", onPointerMove, {
            passive: false,
        });
        canvas.addEventListener("pointerup", onPointerUp, { passive: false });

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
        return () => {
            canvas.removeEventListener("pointerdown", onPointerDown);
            canvas.removeEventListener("pointermove", onPointerMove);
            canvas.removeEventListener("pointerup", onPointerUp);
            canvas.removeEventListener("touchmove", suppressScribble);
        };
    });

    $effect(() => {
        if (!pdfCanvas) return;
        const observer = new ResizeObserver(() => syncSize());
        observer.observe(pdfCanvas);
        syncSize();
        return () => observer.disconnect();
    });

    function syncSize() {
        if (!pdfCanvas || !canvas) return;
        canvas.width = pdfCanvas.width;
        canvas.height = pdfCanvas.height;
        canvas.style.width = pdfCanvas.style.width;
        canvas.style.height = pdfCanvas.style.height;
        redraw();
    }

    // Redraw on slide or annotations change
    $effect(() => {
        void $currentSlide;
        void $annotations;
        void $activeTool;
        void $selectedStrokeIds;
        redraw();
    });

    // ---------------------------------------------------------------------------
    // Coordinate helpers
    // ---------------------------------------------------------------------------

    function toNorm(e: PointerEvent): Point {
        const rect = canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) / rect.width,
            y: (e.clientY - rect.top) / rect.height,
            pressure: e.pressure || 0.5,
        };
    }

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

        const allStrokes = $annotations[$currentSlide] ?? [];

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
                drawStroke(ctx, stroke, canvas.width, canvas.height);
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

    // ---------------------------------------------------------------------------
    // Pointer events — dispatch between select and draw/erase modes
    // ---------------------------------------------------------------------------

    let activePointerId: number | null = null;

    function onPointerDown(e: PointerEvent) {
        if ($deviceRole !== "annotator") return;
        e.preventDefault();
        if (activePointerId !== null) return;
        activePointerId = e.pointerId;
        canvas.setPointerCapture(e.pointerId);

        if ($activeTool === "select") {
            select.onPointerDown(toNorm(e));
            redraw();
        } else {
            draw.onPointerDown(toNorm(e), $activeTool);
        }
    }

    function onPointerMove(e: PointerEvent) {
        e.preventDefault();
        if (e.pointerId !== activePointerId) return;

        if ($activeTool === "select") {
            select.onPointerMove(toNorm(e), e.shiftKey);
            redraw();
            return;
        }

        const eraserHandled = draw.onPointerMove(e, toNorm);
        if (eraserHandled) return;

        redraw();
        if (draw.currentPoints.length >= 2) {
            const ctx = canvas.getContext("2d")!;
            // Always preview as "ellipse" — perfect-circle is drawing-only
            const previewTool =
                $activeTool === "perfect-circle" ? "ellipse" : $activeTool;
            drawStroke(
                ctx,
                {
                    id: "preview",
                    tool: previewTool,
                    color:
                        $activeTool === "highlighter" ? "yellow" : $activeColor,
                    thickness: $activeThickness,
                    points: draw.currentPoints,
                },
                canvas.width,
                canvas.height,
            );
        }
    }

    function onPointerUp(e: PointerEvent) {
        e.preventDefault();
        if (e.pointerId !== activePointerId) return;
        activePointerId = null;

        if ($activeTool === "select") {
            select.onPointerUp(toNorm(e));
            redraw();
            return;
        }

        draw.onPointerUp();
    }
</script>

<canvas
    bind:this={canvas}
    style="position: absolute; touch-action: none; pointer-events: {$deviceRole ===
    'annotator'
        ? 'auto'
        : 'none'};"
></canvas>
