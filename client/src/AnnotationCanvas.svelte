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
    import { drawStroke, thicknessPx } from "./draw";
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
        applyCircleRotation,
        applyCircleUniformScale,
        newBBoxFromCornerDrag,
        circleHandlePoints,
        computeRotationAngle,
        ellipseParams,
        distToSegSq,
        lastPoint,
        type BoundingBox,
        CIRCLE_HANDLE_TOP,
        CIRCLE_HANDLE_CENTER,
        CIRCLE_HANDLE_ROTATE,
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
    // Stable center for perfect-circle tool — set once on pointerDown,
    // never derived from currentPoints (which gets overwritten each move).
    let perfectCircleCenter: Point | null = null;

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
        | "resizing"
        | "rotating"
        | "scaling";
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

    // Rotation (circles only)
    let rotateOrigStroke: AnnotationStroke | null = null;
    let rotateGhost: AnnotationStroke | null = null;

    // Uniform scale via center handle (circles only)
    let scaleOrigStroke: AnnotationStroke | null = null;
    let scaleStartP: Point | null = null;
    let scaleGhost: AnnotationStroke | null = null;

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
            (selectPhase === "moving" ||
                selectPhase === "pending-move" ||
                selectPhase === "resizing" ||
                selectPhase === "rotating" ||
                selectPhase === "scaling")
        ) {
            // During drag: render ghosts in place of originals
            const ghostMap = new Map<string, AnnotationStroke>();
            const activeGhosts =
                selectPhase === "moving"
                    ? moveGhosts
                    : selectPhase === "resizing"
                      ? resizeGhosts
                      : selectPhase === "rotating" && rotateGhost
                        ? [rotateGhost]
                        : selectPhase === "scaling" && scaleGhost
                          ? [scaleGhost]
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
            // During rotate: draw all handles on the ghost
            if (selectPhase === "rotating" && rotateGhost) {
                drawSingleHandles(ctx, rotateGhost);
            }
            // During scale: draw all handles on the ghost
            if (selectPhase === "scaling" && scaleGhost) {
                drawSingleHandles(ctx, scaleGhost);
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
        if (resizeSingleStrokeId !== null) {
            // Single shape resize: draw only the active handle
            const ghost = ghosts[0];
            if (!ghost) return;
            const handles = getHandles(ghost, canvas.width, canvas.height);
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
        return (
            tool === "arrow" ||
            tool === "box" ||
            tool === "ellipse" ||
            tool === "perfect-circle"
        );
    }

    function isSelectableTool(tool: string): boolean {
        return (
            tool === "arrow" ||
            tool === "box" ||
            tool === "ellipse" ||
            tool === "ink" ||
            tool === "highlighter"
        );
    }

    const ERASER_RADIUS_NORM = 0.015;

    function hitTestStrokeEraser(stroke: AnnotationStroke, p: Point): boolean {
        // For arrows, also test the two arrowhead wings which are not part of
        // the shaft and therefore not covered by hitTestShape.
        if (stroke.tool === "arrow") {
            if (hitTestShape(stroke, p, ERASER_RADIUS_NORM)) return true;
            const b = lastPoint(stroke);
            const a = stroke.points[0];
            const headLenNorm =
                (16 + thicknessPx(stroke.thickness) * 2) / canvas.width;
            const angle = Math.atan2(b.y - a.y, b.x - a.x);
            const rSq = ERASER_RADIUS_NORM * ERASER_RADIUS_NORM;
            const wing1x = b.x - headLenNorm * Math.cos(angle - Math.PI / 6);
            const wing1y = b.y - headLenNorm * Math.sin(angle - Math.PI / 6);
            const wing2x = b.x - headLenNorm * Math.cos(angle + Math.PI / 6);
            const wing2y = b.y - headLenNorm * Math.sin(angle + Math.PI / 6);
            return (
                distToSegSq(p.x, p.y, b.x, b.y, wing1x, wing1y) < rSq ||
                distToSegSq(p.x, p.y, b.x, b.y, wing2x, wing2y) < rSq
            );
        }
        return hitTestShape(stroke, p, ERASER_RADIUS_NORM);
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
            const p = toNorm(e);
            currentPoints = [p];
            if ($activeTool === "perfect-circle") {
                perfectCircleCenter = p;
            }
        }
    }

    // Applies a single PointerEvent's position to currentPoints according to the
    // active tool. Extracted so onPointerMove can call it per coalesced event.
    function applyMoveEvent(e: PointerEvent) {
        if ($activeTool === "perfect-circle") {
            const center = perfectCircleCenter!;
            const current = toNorm(e);
            // Compute radius in CSS pixel space (what toNorm normalizes against)
            // so the rendered circle is round regardless of canvas aspect ratio.
            const rect = canvas.getBoundingClientRect();
            const dxPx = (current.x - center.x) * rect.width;
            const dyPx = (current.y - center.y) * rect.height;
            const rPx = Math.hypot(dxPx, dyPx);
            // Convert back to independent normalized radii: dividing by the CSS
            // display size (not the buffer size) keeps the result consistent with
            // how toNorm and drawStroke interpret coordinates.
            const rx = rPx / rect.width;
            const ry = rPx / rect.height;

            currentPoints = [
                { x: center.x - rx, y: center.y - ry },
                { x: center.x + rx, y: center.y + ry },
            ];
        } else if (isShapeTool($activeTool)) {
            currentPoints = [currentPoints[0], toNorm(e)];
        } else {
            currentPoints = [...currentPoints, toNorm(e)];
        }
    }

    function onPointerMove(e: PointerEvent) {
        e.preventDefault();
        if (e.pointerId !== activePointerId) return;

        if ($activeTool === "select") {
            onSelectPointerMove(toNorm(e), e.shiftKey);
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

        // Drain coalesced events to capture all buffered pen samples between
        // animation frames at full fidelity.
        const coalesced = e.getCoalescedEvents?.() ?? [e];
        for (const ce of coalesced) {
            applyMoveEvent(ce);
        }

        redraw();
        if (currentPoints.length >= 2) {
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
            onSelectPointerUp(toNorm(e), e.shiftKey);
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

        // Both "ellipse" and "perfect-circle" are stored as "ellipse" strokes.
        // perfect-circle already has constrained points from onPointerMove.
        const committedTool =
            $activeTool === "perfect-circle" ? "ellipse" : $activeTool;
        const stroke: AnnotationStroke = {
            id: uuidv4(),
            tool: committedTool,
            color: $activeTool === "highlighter" ? "yellow" : $activeColor,
            thickness: $activeThickness,
            points: isShapeTool($activeTool)
                ? [currentPoints[0], currentPoints[currentPoints.length - 1]]
                : currentPoints,
        };

        send({ type: "stroke_added", slide: $currentSlide, stroke });
        currentPoints = [];
        perfectCircleCenter = null;
    }

    // ---------------------------------------------------------------------------
    // Select-mode pointer handlers
    // ---------------------------------------------------------------------------

    function selectableStrokes(): AnnotationStroke[] {
        return ($annotations[$currentSlide] ?? []).filter((s) =>
            isSelectableTool(s.tool),
        );
    }

    function onSelectPointerDown(p: Point) {
        const ids = $selectedStrokeIds;
        const allStrokes = $annotations[$currentSlide] ?? [];
        const selected = allStrokes.filter((s) => ids.has(s.id));

        // ── 1. Check handles first ────────────────────────────────────────────

        if (selected.length === 1) {
            const stroke = selected[0];
            const hi = hitTestHandles(stroke, p, canvas.width, canvas.height);
            if (hi !== -1) {
                if (stroke.tool === "ellipse" && hi === CIRCLE_HANDLE_ROTATE) {
                    // Start rotation
                    selectPhase = "rotating";
                    rotateOrigStroke = stroke;
                    rotateGhost = stroke;
                    redraw();
                    return;
                }
                if (stroke.tool === "ellipse" && hi === CIRCLE_HANDLE_CENTER) {
                    // Center handle → uniform scale
                    selectPhase = "scaling";
                    scaleOrigStroke = stroke;
                    scaleStartP = p;
                    scaleGhost = stroke;
                    redraw();
                    return;
                }
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

    function onSelectPointerMove(p: Point, shiftKey = false) {
        if (selectPhase === "scaling" && scaleOrigStroke && scaleStartP) {
            scaleGhost = applyCircleUniformScale(
                scaleOrigStroke,
                scaleStartP,
                p,
            );
            redraw();
            return;
        }

        if (selectPhase === "rotating" && rotateOrigStroke) {
            const { cx, cy } = ellipseParams(rotateOrigStroke);
            const angle = computeRotationAngle(
                cx,
                cy,
                p.x,
                p.y,
                canvas.width,
                canvas.height,
            );
            rotateGhost = applyCircleRotation(
                rotateOrigStroke,
                angle,
                shiftKey,
            );
            redraw();
            return;
        }

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

    function onSelectPointerUp(p: Point, shiftKey = false) {
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
            if (moved) {
                commitGhosts(moveGhosts);
            }
            moveGhosts = [];
            moveOriginals = [];
            moveStartPos = null;
            selectPhase = "idle";
            redraw();
            return;
        }

        if (selectPhase === "scaling") {
            if (scaleGhost) {
                commitGhosts([scaleGhost]);
            }
            scaleOrigStroke = null;
            scaleStartP = null;
            scaleGhost = null;
            selectPhase = "idle";
            redraw();
            return;
        }

        if (selectPhase === "rotating") {
            if (rotateGhost) {
                commitGhosts([rotateGhost]);
            }
            rotateOrigStroke = null;
            rotateGhost = null;
            selectPhase = "idle";
            redraw();
            return;
        }

        if (selectPhase === "resizing") {
            commitGhosts(resizeGhosts);
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

    /**
     * Send updated strokes to the server and apply them optimistically to the
     * local store. No-ops if the array is empty.
     */
    function commitGhosts(ghosts: AnnotationStroke[]) {
        if (ghosts.length === 0) return;
        send({
            type: "strokes_updated",
            slide: $currentSlide,
            strokes: ghosts,
        });
        applyGhostsToStore(ghosts);
    }

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
