<script lang="ts">
  import { currentSlide, annotations, deviceRole } from './stores.ts';
  import type { AnnotationStroke, Point, StrokeThickness } from '../../shared/types.ts';

  interface Props {
    pdfCanvas: HTMLCanvasElement | undefined;
  }
  let { pdfCanvas }: Props = $props();

  let canvas: HTMLCanvasElement;
  let activePointerId: number | null = null;
  let currentPoints: Point[] = [];

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

  export function drawStroke(ctx: CanvasRenderingContext2D, stroke: AnnotationStroke) {
    if (stroke.points.length < 2) return;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    switch (stroke.tool) {
      case 'ink':
        ctx.globalAlpha = 1;
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = thicknessPx(stroke.thickness);
        drawPath(ctx, stroke.points);
        break;
      case 'highlighter':
        ctx.globalAlpha = 0.3;
        ctx.strokeStyle = 'yellow';
        ctx.lineWidth = thicknessPx('thick');
        drawPath(ctx, stroke.points);
        break;
      case 'arrow': {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = thicknessPx(stroke.thickness);
        const [a, b] = [fromNorm(stroke.points[0]), fromNorm(stroke.points[stroke.points.length - 1])];
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        // Arrowhead
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
        const [p1, p2] = [fromNorm(stroke.points[0]), fromNorm(stroke.points[stroke.points.length - 1])];
        ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
        break;
      }
    }
    ctx.restore();
  }

  function drawPath(ctx: CanvasRenderingContext2D, points: Point[]) {
    const first = fromNorm(points[0]);
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < points.length; i++) {
      const p = fromNorm(points[i]);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }

  function thicknessPx(t: StrokeThickness): number {
    if (t === 'thin') return 2;
    if (t === 'medium') return 5;
    return 12;
  }

  function onPointerDown(e: PointerEvent) {
    if ($deviceRole !== 'annotator') return;
    if (activePointerId !== null) return;
    activePointerId = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    currentPoints = [toNorm(e)];
  }

  function onPointerMove(e: PointerEvent) {
    if (e.pointerId !== activePointerId) return;
    currentPoints = [...currentPoints, toNorm(e)];
    // Draw committed strokes + live preview
    redraw();
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
  style="position: absolute; pointer-events: {$deviceRole === 'annotator' ? 'auto' : 'none'};"
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
></canvas>
