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
    import { send } from "./ws-client";
    import { drawStroke } from "./draw";
    import type { AnnotationStroke, Point } from "../../shared/types";
    import { v4 as uuidv4 } from "uuid";
    import {
        hitTestShape,
        hitTestHandles,
        hitTestBBoxHandles,
        lassoIntersectsShape,
        getHandles,
        computeBoundingBox,
        bboxCorners,
        applyTranslate,
        applyScaleToGroup,
        applySingleResize,
        newBBoxFromCornerDrag,
        type BoundingBox,
        HANDLE_RADIUS_NORM,
    } from "./geometry";

    // ---------------------------------------------------------------------------
    // Props
    // ---------------------------------------------------------------------------

    interface Props {
        pdfCanvas: HTMLCanvasElement | undefined;
    }
    let { pdfCanvas }: Props = $props();

    // ---------------------------------------------------------------------------
    // Canvas ref + basic drawing state
    // ---------------------------------------------------------------------------

    let canvas = $state<HTMLCanvasElement>(undefined!);
    let activePointerId: number | null = null;

    // Drawing (non-select) state
    let currentPoints: Point[] = [];

    // Eraser gesture batching
    let erasedThisGesture = new Set<string>();

    // ---------------------------------------------------------------------------
    // Select-tool state machine
    // ---------------------------------------------------------------------------

    type SelectPhase =
        | "idle"
        | "lasso"
        | "pending-move"
        | "moving"
        | "resizing";
    let selectPhase: SelectPhase = "idle";

    // Lasso
    let lassoPoints: Point[] = [];

    // Move
    let moveStartPos: Point | null = null;
    let moveGhosts: AnnotationStroke[] = [];
    let moveOriginals: AnnotationStroke[] = [];

    // Drag threshold: pointer must travel this many canvas-pixels before move activates
    const MOVE_THRESHOLD_PX = 12;

    // Resize
    let resizeHandleIndex = -1;
    let resizeSingleStrokeId: string | null = null; // null = group bounding-box resize
    let resizeOrigStrokes: AnnotationStroke[] = [];
    let resizeOrigBox: BoundingBox | null = null;
    let resizeGhosts: AnnotationStroke[] = [];

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
        return () => {
            canvas.removeEventListener("pointerdown", onPointerDown);
            canvas.removeEventListener("pointermove", onPointerMove);
            canvas.removeEventListener("pointerup", onPointerUp);
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
            (selectPhase === "moving" ||
                selectPhase === "pending-move" ||
                selectPhase === "resizing")
        ) {
            // During drag: render ghosts in place of originals, dim originals
            const ghostMap = new Map<string, AnnotationStroke>();
            // pending-move: no ghosts yet, render originals normally below
            const activeGhosts =
                selectPhase === "moving"
                    ? moveGhosts
                    : selectPhase === "resizing"
                      ? resizeGhosts
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
            if (selectPhase === "resizing") {
                drawResizeHandles(ctx, activeGhosts);
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
        if (selectPhase === "lasso" && lassoPoints.length >= 2) {
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

    function drawSingleHandles(
        ctx: CanvasRenderingContext2D,
        stroke: AnnotationStroke,
    ) {
        if (stroke.tool === "ink" || stroke.tool === "highlighter") {
            // Freehand strokes: show a dashed bounding box only (move only, no resize handles)
            const box = computeBoundingBox([stroke]);
            const corners = bboxCorners(box);
            ctx.save();
            ctx.setLineDash(LASSO_DASH);
            ctx.strokeStyle = HANDLE_COLOR;
            ctx.lineWidth = 1.5;
            ctx.globalAlpha = 0.7;
            const tl = normToCanvas(corners[0]);
            const br = normToCanvas(corners[2]);
            ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
            ctx.restore();
            return;
        }
        for (const handle of getHandles(stroke)) {
            drawDot(ctx, handle);
        }
    }

    function drawGroupHandles(
        ctx: CanvasRenderingContext2D,
        strokes: AnnotationStroke[],
    ) {
        const box = computeBoundingBox(strokes);
        const corners = bboxCorners(box);

        // Dashed bounding box rectangle
        ctx.save();
        ctx.setLineDash(LASSO_DASH);
        ctx.strokeStyle = HANDLE_COLOR;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.7;
        const tl = normToCanvas(corners[0]);
        const br = normToCanvas(corners[2]);
        ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
        ctx.restore();

        // Corner dots
        for (const corner of corners) {
            drawDot(ctx, corner);
        }
    }

    function drawResizeHandles(
        ctx: CanvasRenderingContext2D,
        ghosts: AnnotationStroke[],
    ) {
        if (resizeSingleStrokeId !== null) {
            // Single shape resize: draw only the active handle
            const ghost = ghosts[0];
            if (!ghost) return;
            const handles = getHandles(ghost);
            if (resizeHandleIndex >= 0 && resizeHandleIndex < handles.length) {
                drawDot(ctx, handles[resizeHandleIndex]);
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
        const first = normToCanvas(lassoPoints[0]);
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < lassoPoints.length; i++) {
            const { x, y } = normToCanvas(lassoPoints[i]);
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
    // Non-select helpers (eraser / drawing)
    // ---------------------------------------------------------------------------

    function isShapeTool(tool: string): boolean {
        return tool === "arrow" || tool === "box";
    }

    const ERASER_RADIUS_NORM = 0.03;

    function hitTestStrokeEraser(stroke: AnnotationStroke, p: Point): boolean {
        if (isShapeTool(stroke.tool)) {
            const xs = stroke.points.map((pt) => pt.x);
            const ys = stroke.points.map((pt) => pt.y);
            const minX = Math.min(...xs) - ERASER_RADIUS_NORM;
            const maxX = Math.max(...xs) + ERASER_RADIUS_NORM;
            const minY = Math.min(...ys) - ERASER_RADIUS_NORM;
            const maxY = Math.max(...ys) + ERASER_RADIUS_NORM;
            return p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
        }
        return stroke.points.some(
            (pt) => Math.hypot(pt.x - p.x, pt.y - p.y) < ERASER_RADIUS_NORM,
        );
    }

    // ---------------------------------------------------------------------------
    // Pointer events — dispatch between select and draw/erase modes
    // ---------------------------------------------------------------------------

    function onPointerDown(e: PointerEvent) {
        if ($deviceRole !== "annotator") return;
        e.preventDefault();
        if (activePointerId !== null) return;
        activePointerId = e.pointerId;
        canvas.setPointerCapture(e.pointerId);

        if ($activeTool === "select") {
            onSelectPointerDown(toNorm(e));
        } else {
            if ($activeTool === "eraser") {
                erasedThisGesture = new Set();
            }
            currentPoints = [toNorm(e)];
        }
    }

    function onPointerMove(e: PointerEvent) {
        e.preventDefault();
        if (e.pointerId !== activePointerId) return;

        if ($activeTool === "select") {
            onSelectPointerMove(toNorm(e));
            return;
        }

        if ($activeTool === "eraser") {
            const p = toNorm(e);
            const strokes = $annotations[$currentSlide] ?? [];
            const toErase = strokes.filter(
                (stroke) =>
                    !erasedThisGesture.has(stroke.id) &&
                    hitTestStrokeEraser(stroke, p),
            );
            if (toErase.length > 0) {
                for (const stroke of toErase) {
                    erasedThisGesture.add(stroke.id);
                }
                // Optimistically remove from local store so they vanish immediately
                const erasedIds = new Set(toErase.map((s) => s.id));
                annotations.update((ann) => {
                    const page = (ann[$currentSlide] ?? []).filter(
                        (s) => !erasedIds.has(s.id),
                    );
                    return { ...ann, [$currentSlide]: page };
                });
            }
            return;
        }

        if (isShapeTool($activeTool)) {
            currentPoints = [currentPoints[0], toNorm(e)];
        } else {
            currentPoints = [...currentPoints, toNorm(e)];
        }

        redraw();
        if (currentPoints.length >= 2) {
            const ctx = canvas.getContext("2d")!;
            drawStroke(
                ctx,
                {
                    id: "preview",
                    tool: $activeTool,
                    color:
                        $activeTool === "highlighter" ? "yellow" : $activeColor,
                    thickness: $activeThickness,
                    points: currentPoints,
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
            onSelectPointerUp(toNorm(e));
            return;
        }

        if ($activeTool === "eraser") {
            if (erasedThisGesture.size > 0) {
                send({
                    type: "strokes_removed",
                    slide: $currentSlide,
                    strokeIds: [...erasedThisGesture],
                });
                erasedThisGesture = new Set();
            }
            currentPoints = [];
            return;
        }

        if (currentPoints.length < 2) {
            currentPoints = [];
            return;
        }

        const stroke: AnnotationStroke = {
            id: uuidv4(),
            tool: $activeTool,
            color: $activeTool === "highlighter" ? "yellow" : $activeColor,
            thickness: $activeThickness,
            points: isShapeTool($activeTool)
                ? [currentPoints[0], currentPoints[currentPoints.length - 1]]
                : currentPoints,
        };

        send({ type: "stroke_added", slide: $currentSlide, stroke });
        currentPoints = [];
    }

    // ---------------------------------------------------------------------------
    // Select-mode pointer handlers
    // ---------------------------------------------------------------------------

    function selectableStrokes(): AnnotationStroke[] {
        return ($annotations[$currentSlide] ?? []).filter(
            (s) =>
                s.tool === "arrow" ||
                s.tool === "box" ||
                s.tool === "ink" ||
                s.tool === "highlighter",
        );
    }

    function onSelectPointerDown(p: Point) {
        const ids = $selectedStrokeIds;
        const allStrokes = $annotations[$currentSlide] ?? [];
        const selected = allStrokes.filter((s) => ids.has(s.id));

        // ── 1. Check handles first ────────────────────────────────────────────

        if (selected.length === 1) {
            const stroke = selected[0];
            const hi = hitTestHandles(stroke, p);
            if (hi !== -1) {
                selectPhase = "resizing";
                resizeHandleIndex = hi;
                resizeSingleStrokeId = stroke.id;
                resizeOrigStrokes = [stroke];
                resizeGhosts = [stroke];
                resizeOrigBox = null;
                redraw();
                return;
            }
        } else if (selected.length > 1) {
            const box = computeBoundingBox(selected);
            const corners = bboxCorners(box);
            const hi = hitTestBBoxHandles(corners, p);
            if (hi !== -1) {
                selectPhase = "resizing";
                resizeHandleIndex = hi;
                resizeSingleStrokeId = null;
                resizeOrigStrokes = [...selected];
                resizeGhosts = [...selected];
                resizeOrigBox = box;
                redraw();
                return;
            }
        }

        // ── 2. Check shape bodies (topmost first = last in array) ─────────────

        const shapesReversed = selectableStrokes().slice().reverse();
        for (const stroke of shapesReversed) {
            if (hitTestShape(stroke, p)) {
                if (!ids.has(stroke.id)) {
                    selectedStrokeIds.set(new Set([stroke.id]));
                }
                // Enter pending-move: wait for threshold before actually moving
                selectPhase = "pending-move";
                moveStartPos = p;
                const currentIds = ids.has(stroke.id)
                    ? ids
                    : new Set([stroke.id]);
                moveOriginals = allStrokes.filter((s) => currentIds.has(s.id));
                moveGhosts = [...moveOriginals];
                redraw();
                return;
            }
        }

        // ── 3. Nothing hit → start lasso ──────────────────────────────────────

        selectedStrokeIds.set(new Set());
        selectPhase = "lasso";
        lassoPoints = [p];
        redraw();
    }

    function onSelectPointerMove(p: Point) {
        if (selectPhase === "lasso") {
            lassoPoints = [...lassoPoints, p];
            redraw();
            return;
        }

        if (
            (selectPhase === "pending-move" || selectPhase === "moving") &&
            moveStartPos
        ) {
            const dx = p.x - moveStartPos.x;
            const dy = p.y - moveStartPos.y;
            // Convert delta to canvas pixels to check threshold
            const dxPx = dx * canvas.width;
            const dyPx = dy * canvas.height;
            if (
                selectPhase === "pending-move" &&
                Math.hypot(dxPx, dyPx) < MOVE_THRESHOLD_PX
            ) {
                return; // not yet past threshold, stay put
            }
            selectPhase = "moving";
            moveGhosts = moveOriginals.map((s) => applyTranslate(s, dx, dy));
            redraw();
            return;
        }

        if (selectPhase === "resizing") {
            if (resizeSingleStrokeId !== null) {
                // Single shape resize
                const orig = resizeOrigStrokes[0];
                if (orig) {
                    resizeGhosts = [
                        applySingleResize(orig, resizeHandleIndex, p),
                    ];
                }
            } else if (resizeOrigBox) {
                // Group bounding-box resize
                const newBox = newBBoxFromCornerDrag(
                    resizeOrigBox,
                    resizeHandleIndex,
                    p,
                );
                resizeGhosts = applyScaleToGroup(
                    resizeOrigStrokes,
                    resizeOrigBox,
                    newBox,
                );
            }
            redraw();
            return;
        }
    }

    function onSelectPointerUp(p: Point) {
        if (selectPhase === "lasso") {
            lassoPoints = [...lassoPoints, p];
            // Compute which shapes intersect the lasso
            const hits = selectableStrokes().filter((s) =>
                lassoIntersectsShape(lassoPoints, s),
            );
            selectedStrokeIds.set(new Set(hits.map((s) => s.id)));
            lassoPoints = [];
            selectPhase = "idle";
            redraw();
            return;
        }

        if (selectPhase === "pending-move") {
            // Released before threshold — treat as a tap, no move sent
            moveGhosts = [];
            moveOriginals = [];
            moveStartPos = null;
            selectPhase = "idle";
            redraw();
            return;
        }

        if (selectPhase === "moving") {
            // Only send if actually moved
            const moved = moveGhosts.some((ghost, i) => {
                const orig = moveOriginals[i];
                return (
                    orig &&
                    (ghost.points[0].x !== orig.points[0].x ||
                        ghost.points[0].y !== orig.points[0].y)
                );
            });
            if (moved && moveGhosts.length > 0) {
                if (moveGhosts.length === 1) {
                    send({
                        type: "stroke_updated",
                        slide: $currentSlide,
                        stroke: moveGhosts[0],
                    });
                } else {
                    send({
                        type: "strokes_updated",
                        slide: $currentSlide,
                        strokes: moveGhosts,
                    });
                }
                // Optimistically update the store
                applyGhostsToStore(moveGhosts);
            }
            moveGhosts = [];
            moveOriginals = [];
            moveStartPos = null;
            selectPhase = "idle";
            redraw();
            return;
        }

        if (selectPhase === "resizing") {
            if (resizeGhosts.length > 0) {
                if (resizeSingleStrokeId !== null) {
                    send({
                        type: "stroke_updated",
                        slide: $currentSlide,
                        stroke: resizeGhosts[0],
                    });
                } else {
                    send({
                        type: "strokes_updated",
                        slide: $currentSlide,
                        strokes: resizeGhosts,
                    });
                }
                applyGhostsToStore(resizeGhosts);
            }
            resizeGhosts = [];
            resizeOrigStrokes = [];
            resizeOrigBox = null;
            resizeHandleIndex = -1;
            resizeSingleStrokeId = null;
            selectPhase = "idle";
            redraw();
            return;
        }

        selectPhase = "idle";
    }

    // ---------------------------------------------------------------------------
    // Optimistic store update
    // ---------------------------------------------------------------------------

    function applyGhostsToStore(ghosts: AnnotationStroke[]) {
        const ghostMap = new Map(ghosts.map((g) => [g.id, g]));
        annotations.update((ann) => {
            const page = (ann[$currentSlide] ?? []).map((s) =>
                ghostMap.has(s.id) ? ghostMap.get(s.id)! : s,
            );
            return { ...ann, [$currentSlide]: page };
        });
    }
</script>

<canvas
    bind:this={canvas}
    style="position: absolute; touch-action: none; pointer-events: {$deviceRole ===
    'annotator'
        ? 'auto'
        : 'none'};"
></canvas>
