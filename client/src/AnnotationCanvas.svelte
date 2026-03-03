<script lang="ts">
  import { getStroke } from 'perfect-freehand';
  import { currentSlide, annotations, deviceRole } from './stores.ts';
  import type { AnnotationStroke, Point, StrokeThickness } from '../../shared/types.ts';

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
    canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
    canvas.addEventListener('pointermove', onPointerMove, { passive: false });
    canvas.addEventListener('pointerup',   onPointerUp,   { passive: false });
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup',   onPointerUp);
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

  function fromNorm(p: Point): { x: number; y: number } {
    return { x: p.x * canvas.width, y: p.y * canvas.height };
  }

  function redraw() {
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const strokes = $annotations[$currentSlide] ?? [];
    for (const stroke of strokes) drawStroke(ctx, stroke);
  }

  // Convert perfect-freehand output points into a filled canvas path
  function renderFreehandStroke(ctx: CanvasRenderingContext2D, outlinePoints: number[][]) {
    if (!outlinePoints.length) return;
    ctx.beginPath();
    ctx.moveTo(outlinePoints[0][0], outlinePoints[0][1]);
    for (let i = 1; i < outlinePoints.length - 1; i++) {
      const mx = (outlinePoints[i][0] + outlinePoints[i + 1][0]) / 2;
      const my = (outlinePoints[i][1] + outlinePoints[i + 1][1]) / 2;
      ctx.quadraticCurveTo(outlinePoints[i][0], outlinePoints[i][1], mx, my);
    }
    ctx.closePath();
    ctx.fill();
  }

  export function drawStroke(ctx: CanvasRenderingContext2D, stroke: AnnotationStroke) {
    if (stroke.points.length < 2) return;
    ctx.save();

    switch (stroke.tool) {
      case 'ink': {
        // Convert normalized points to canvas pixels with pressure
        const pixelPoints = stroke.points.map((p) => [
          p.x * canvas.width,
          p.y * canvas.height,
          p.pressure ?? 0.5,
        ]);
        const outline = getStroke(pixelPoints, {
          size: thicknessPx(stroke.thickness),
          thinning: 0.5,
          smoothing: 0.5,
          streamline: 0.5,
          simulatePressure: false,
        });
        ctx.globalAlpha = 1;
        ctx.fillStyle = stroke.color;
        renderFreehandStroke(ctx, outline);
        break;
      }
      case 'highlighter': {
        const pixelPoints = stroke.points.map((p) => [
          p.x * canvas.width,
          p.y * canvas.height,
          0.5,
        ]);
        const outline = getStroke(pixelPoints, {
          size: thicknessPx('thick') * 2,
          thinning: 0,
          smoothing: 0.5,
          streamline: 0.5,
          simulatePressure: false,
        });
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = 'yellow';
        renderFreehandStroke(ctx, outline);
        break;
      }
      case 'arrow': {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = thicknessPx(stroke.thickness);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        const a = fromNorm(stroke.points[0]);
        const b = fromNorm(stroke.points[stroke.points.length - 1]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        const headLen = 16 + thicknessPx(stroke.thickness) * 2;
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - headLen * Math.cos(angle - Math.PI / 6), b.y - headLen * Math.sin(angle - Math.PI / 6));
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - headLen * Math.cos(angle + Math.PI / 6), b.y - headLen * Math.sin(angle + Math.PI / 6));
        ctx.stroke();
        break;
      }
      case 'box': {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = thicknessPx(stroke.thickness);
        ctx.lineJoin = 'round';
        const p1 = fromNorm(stroke.points[0]);
        const p2 = fromNorm(stroke.points[stroke.points.length - 1]);
        ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
        break;
      }
    }
    ctx.restore();
  }

  function thicknessPx(t: StrokeThickness): number {
    if (t === 'thin') return 8;
    if (t === 'medium') return 16;
    return 28;
  }

  function onPointerDown(e: PointerEvent) {
    if ($deviceRole !== 'annotator') return;
    e.preventDefault();
    if (activePointerId !== null) return;
    activePointerId = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    currentPoints = [toNorm(e)];
  }

  function onPointerMove(e: PointerEvent) {
    e.preventDefault();
    if (e.pointerId !== activePointerId) return;
    currentPoints = [...currentPoints, toNorm(e)];
    redraw();
    // Draw live preview of current stroke
    if (currentPoints.length >= 2) {
      const ctx = canvas.getContext('2d')!;
      drawStroke(ctx, {
        id: 'preview',
        tool: 'ink',
        color: 'orange',
        thickness: 'medium',
        points: currentPoints,
      });
    }
  }

  function onPointerUp(e: PointerEvent) {
    e.preventDefault();
    if (e.pointerId !== activePointerId) return;
    activePointerId = null;
    if (currentPoints.length < 2) { currentPoints = []; return; }

    const stroke: AnnotationStroke = {
      id: crypto.randomUUID(),
      tool: 'ink',
      color: 'orange',
      thickness: 'medium',
      points: currentPoints,
    };

    annotations.update((ann) => {
      const slide = $currentSlide;
      return { ...ann, [slide]: [...(ann[slide] ?? []), stroke] };
    });

    currentPoints = [];
  }
</script>

<canvas
  bind:this={canvas}
  style="position: absolute; touch-action: none; pointer-events: {$deviceRole === 'annotator' ? 'auto' : 'none'};"
></canvas>
