<script lang="ts">
    import {
        currentSlide,
        annotations,
        deviceRole,
        activeTool,
        activeColor,
        activeThickness,
    } from "./stores";
    import { send } from "./ws-client";
    import { drawStroke } from "./draw";
    import type { AnnotationStroke, Point } from "../../shared/types";

    interface Props {
        pdfCanvas: HTMLCanvasElement | undefined;
    }
    let { pdfCanvas }: Props = $props();

    let canvas = $state<HTMLCanvasElement>(undefined!);
    let activePointerId: number | null = null;
    let currentPoints: Point[] = [];

    // Register pointer listeners as non-passive so preventDefault() works
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

    // Mirror PDF canvas size whenever it changes
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
        redraw();
    });

    function toNorm(e: PointerEvent): Point {
        const rect = canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) / rect.width,
            y: (e.clientY - rect.top) / rect.height,
            pressure: e.pressure || 0.5,
        };
    }

    function redraw() {
        if (!canvas) return;
        const ctx = canvas.getContext("2d")!;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const strokes = $annotations[$currentSlide] ?? [];
        for (const stroke of strokes)
            drawStroke(ctx, stroke, canvas.width, canvas.height);
    }

    function onPointerDown(e: PointerEvent) {
        if ($deviceRole !== "annotator") return;
        e.preventDefault();
        if (activePointerId !== null) return;
        activePointerId = e.pointerId;
        canvas.setPointerCapture(e.pointerId);
        currentPoints = [toNorm(e)];
    }

    function isShapeTool(tool: string) {
        return tool === "arrow" || tool === "box";
    }

    const ERASER_RADIUS_NORM = 0.03; // normalized hit radius

    function hitTestStroke(stroke: AnnotationStroke, p: Point): boolean {
        if (isShapeTool(stroke.tool)) {
            // Bounding box hit-test
            const xs = stroke.points.map((pt) => pt.x);
            const ys = stroke.points.map((pt) => pt.y);
            const minX = Math.min(...xs) - ERASER_RADIUS_NORM;
            const maxX = Math.max(...xs) + ERASER_RADIUS_NORM;
            const minY = Math.min(...ys) - ERASER_RADIUS_NORM;
            const maxY = Math.max(...ys) + ERASER_RADIUS_NORM;
            return p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
        }
        // Point proximity hit-test for ink/highlighter
        return stroke.points.some(
            (pt) => Math.hypot(pt.x - p.x, pt.y - p.y) < ERASER_RADIUS_NORM,
        );
    }

    function onPointerMove(e: PointerEvent) {
        e.preventDefault();
        if (e.pointerId !== activePointerId) return;

        if ($activeTool === "eraser") {
            const p = toNorm(e);
            const strokes = $annotations[$currentSlide] ?? [];
            for (const stroke of strokes) {
                if (hitTestStroke(stroke, p)) {
                    send({
                        type: "stroke_removed",
                        slide: $currentSlide,
                        strokeId: stroke.id,
                    });
                }
            }
            return;
        }

        // Shapes only need start + current end point; freehand tools collect all points
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
        if (currentPoints.length < 2) {
            currentPoints = [];
            return;
        }

        // For eraser: handled in step 14; skip sending a stroke
        if ($activeTool === "eraser") {
            currentPoints = [];
            return;
        }

        const stroke: AnnotationStroke = {
            id: crypto.randomUUID(),
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
</script>

<canvas
    bind:this={canvas}
    style="position: absolute; touch-action: none; pointer-events: {$deviceRole ===
    'annotator'
        ? 'auto'
        : 'none'};"
></canvas>
