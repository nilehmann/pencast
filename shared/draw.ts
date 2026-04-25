import type { AnnotationStroke } from "./types";
export { thicknessPx } from "./stroke-draw";
import { thicknessPx, getStrokeOutlinePoints } from "./stroke-draw";
import { ellipseParams, lastPoint } from "./geometry";

const STROKE_COLOR_CSS: Record<string, string> = {
  orange: "#f97316",
  red:    "#ef4444",
  green:  "#22c55e",
  yellow: "#eab308",
  black:  "#111111",
  gray:   "#9ca3af",
  blue:   "#3b82f6",
};

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
    case "ink":
    case "pointer": {
      const outline = getStrokeOutlinePoints(stroke, canvasWidth, canvasHeight);
      ctx.globalAlpha = 1;
      ctx.fillStyle = STROKE_COLOR_CSS[stroke.color] ?? stroke.color;
      renderFreehandOutline(ctx, outline);
      break;
    }
    case "highlighter": {
      const outline = getStrokeOutlinePoints(stroke, canvasWidth, canvasHeight);
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = "yellow";
      renderFreehandOutline(ctx, outline);
      break;
    }
    case "line": {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = STROKE_COLOR_CSS[stroke.color] ?? stroke.color;
      ctx.lineWidth = thicknessPx(stroke.thickness);
      ctx.lineCap = "round";
      const la = { x: px(stroke.points[0].normX), y: py(stroke.points[0].normY) };
      const lb = { x: px(lastPoint(stroke).normX), y: py(lastPoint(stroke).normY) };
      ctx.beginPath();
      ctx.moveTo(la.x, la.y);
      ctx.lineTo(lb.x, lb.y);
      ctx.stroke();
      break;
    }
    case "arrow": {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = STROKE_COLOR_CSS[stroke.color] ?? stroke.color;
      ctx.lineWidth = thicknessPx(stroke.thickness);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      const a = { x: px(stroke.points[0].normX), y: py(stroke.points[0].normY) };
      const b = {
        x: px(lastPoint(stroke).normX),
        y: py(lastPoint(stroke).normY),
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
      const bp0 = stroke.points[0];
      const bp1 = lastPoint(stroke);
      const bcx = (bp0.normX + bp1.normX) / 2;
      const bcy = (bp0.normY + bp1.normY) / 2;
      const bhw = Math.abs(bp1.normX - bp0.normX) / 2;
      const bhh = Math.abs(bp1.normY - bp0.normY) / 2;
      const bangle = stroke.rotation ?? 0;
      ctx.globalAlpha = 1;
      ctx.strokeStyle = STROKE_COLOR_CSS[stroke.color] ?? stroke.color;
      ctx.lineWidth = thicknessPx(stroke.thickness);
      ctx.lineJoin = "round";
      ctx.translate(px(bcx), py(bcy));
      ctx.rotate(bangle);
      ctx.strokeRect(-px(bhw), -py(bhh), px(bhw) * 2, py(bhh) * 2);
      break;
    }
    case "ellipse": {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = STROKE_COLOR_CSS[stroke.color] ?? stroke.color;
      ctx.lineWidth = thicknessPx(stroke.thickness);
      ctx.lineJoin = "round";
      const { cx, cy, rx, ry, angle } = ellipseParams(stroke);
      ctx.beginPath();
      ctx.ellipse(
        px(cx),
        py(cy),
        Math.max(1, rx * canvasWidth),
        Math.max(1, ry * canvasHeight),
        angle,
        0,
        2 * Math.PI,
      );
      ctx.stroke();
      break;
    }
  }

  ctx.restore();
}
