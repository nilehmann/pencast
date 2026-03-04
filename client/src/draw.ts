import { getStroke } from "perfect-freehand";
import type { AnnotationStroke, StrokeThickness } from "../../shared/types.ts";

export function thicknessPx(t: StrokeThickness): number {
  if (t === "thin") return 6;
  if (t === "medium") return 10;
  return 18;
}

function renderFreehandOutline(ctx: CanvasRenderingContext2D, pts: number[][]) {
  if (!pts.length) return;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const my = (pts[i][1] + pts[i + 1][1]) / 2;
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  ctx.closePath();
  ctx.fill();
}

export function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: AnnotationStroke,
  canvasWidth: number,
  canvasHeight: number,
) {
  if (stroke.points.length < 2) return;

  const px = (x: number) => x * canvasWidth;
  const py = (y: number) => y * canvasHeight;

  ctx.save();

  switch (stroke.tool) {
    case "ink": {
      const pixelPts = stroke.points.map((p) => [
        px(p.x),
        py(p.y),
        p.pressure ?? 0.5,
      ]);
      const outline = getStroke(pixelPts, {
        size: thicknessPx(stroke.thickness),
        thinning: 0.5,
        smoothing: 0.5,
        streamline: 0.5,
        simulatePressure: false,
      });
      ctx.globalAlpha = 1;
      ctx.fillStyle = stroke.color;
      renderFreehandOutline(ctx, outline);
      break;
    }
    case "highlighter": {
      const pixelPts = stroke.points.map((p) => [px(p.x), py(p.y), 0.5]);
      const outline = getStroke(pixelPts, {
        size: thicknessPx("thick") * 2,
        thinning: 0,
        smoothing: 0.5,
        streamline: 0.5,
        simulatePressure: false,
      });
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = "yellow";
      renderFreehandOutline(ctx, outline);
      break;
    }
    case "arrow": {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = thicknessPx(stroke.thickness);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      const a = { x: px(stroke.points[0].x), y: py(stroke.points[0].y) };
      const b = {
        x: px(stroke.points[stroke.points.length - 1].x),
        y: py(stroke.points[stroke.points.length - 1].y),
      };
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const headLen = 16 + thicknessPx(stroke.thickness) * 2;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(
        b.x - headLen * Math.cos(angle - Math.PI / 6),
        b.y - headLen * Math.sin(angle - Math.PI / 6),
      );
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(
        b.x - headLen * Math.cos(angle + Math.PI / 6),
        b.y - headLen * Math.sin(angle + Math.PI / 6),
      );
      ctx.stroke();
      break;
    }
    case "box": {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = thicknessPx(stroke.thickness);
      ctx.lineJoin = "round";
      const p1 = { x: px(stroke.points[0].x), y: py(stroke.points[0].y) };
      const p2 = {
        x: px(stroke.points[stroke.points.length - 1].x),
        y: py(stroke.points[stroke.points.length - 1].y),
      };
      ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
      break;
    }
  }

  ctx.restore();
}
