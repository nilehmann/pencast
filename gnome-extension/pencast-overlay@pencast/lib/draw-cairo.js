// Cairo port of client/src/draw.ts
// Renders annotation strokes onto a Cairo context.

import { getStroke } from './perfect-freehand.js';

const STROKE_COLORS = {
  orange: [0.976, 0.451, 0.086],
  red:    [0.937, 0.267, 0.267],
  green:  [0.133, 0.773, 0.369],
  yellow: [0.918, 0.702, 0.031],
  black:  [0.067, 0.067, 0.067],
  gray:   [0.612, 0.639, 0.686],
  blue:   [0.231, 0.510, 0.965],
};

function thicknessPx(t) {
  if (t === 'thin') return 6;
  if (t === 'medium') return 10;
  return 18;
}

function parseColor(color) {
  return STROKE_COLORS[color] ?? [0.231, 0.510, 0.965];
}

function setColor(cr, color, alpha = 1) {
  const [r, g, b] = parseColor(color);
  cr.setSourceRGBA(r, g, b, alpha);
}

function lastPoint(stroke) {
  return stroke.points[stroke.points.length - 1];
}

function ellipseParams(stroke) {
  const p0 = stroke.points[0];
  const p1 = lastPoint(stroke);
  const cx = (p0.normX + p1.normX) / 2;
  const cy = (p0.normY + p1.normY) / 2;
  const rx = Math.abs(p1.normX - p0.normX) / 2;
  const ry = Math.abs(p1.normY - p0.normY) / 2;
  const angle = stroke.rotation ?? 0;
  return { cx, cy, rx, ry, angle };
}

// Render a freehand outline polygon using Cairo cubic bezier approximation
// of quadratic curves (same algorithm as renderFreehandOutline in draw.ts).
function renderFreehandOutlineCairo(cr, pts) {
  if (!pts.length) return;
  cr.newPath();
  cr.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const my = (pts[i][1] + pts[i + 1][1]) / 2;
    // Quadratic bezier → cubic: duplicate control point
    cr.curveTo(pts[i][0], pts[i][1], pts[i][0], pts[i][1], mx, my);
  }
  cr.closePath();
  cr.fill();
}

/**
 * Draw a single stroke onto a Cairo context.
 *
 * @param {object} cr       Cairo context
 * @param {object} stroke   AnnotationStroke
 * @param {number} w        screen width in pixels
 * @param {number} h        screen height in pixels
 * @param {number} cropTop  pixels cropped from top of screen
 */
export function drawStrokeCairo(cr, stroke, w, h, cropTop) {
  if (!stroke.points || stroke.points.length < 2) return;

  // Map normalized coords to screen pixels.
  // X spans full width; Y spans the uncropped region [cropTop..h].
  const px = (x) => x * w;
  const py = (y) => cropTop + y * (h - cropTop);

  cr.save();

  switch (stroke.tool) {
    case 'ink':
    case 'pointer': {
      const pixelPts = stroke.points.map((p) => [
        px(p.normX),
        py(p.normY),
        p.pressure ?? 0.5,
      ]);
      const outline = getStroke(pixelPts, {
        size: thicknessPx(stroke.thickness),
        thinning: 0.5,
        smoothing: 0.5,
        streamline: 0.5,
        simulatePressure: false,
      });
      setColor(cr, stroke.color, 1);
      renderFreehandOutlineCairo(cr, outline);
      break;
    }
    case 'highlighter': {
      const pixelPts = stroke.points.map((p) => [px(p.normX), py(p.normY), 0.5]);
      const outline = getStroke(pixelPts, {
        size: thicknessPx('thick') * 2,
        thinning: 0,
        smoothing: 0.5,
        streamline: 0.5,
        simulatePressure: false,
      });
      setColor(cr, 'yellow', 0.3);
      renderFreehandOutlineCairo(cr, outline);
      break;
    }
    case 'line': {
      setColor(cr, stroke.color, 1);
      cr.setLineWidth(thicknessPx(stroke.thickness));
      cr.setLineCap(1 /* Cairo.LineCap.ROUND */);
      const la = { x: px(stroke.points[0].normX), y: py(stroke.points[0].normY) };
      const lb = { x: px(lastPoint(stroke).normX), y: py(lastPoint(stroke).normY) };
      cr.newPath();
      cr.moveTo(la.x, la.y);
      cr.lineTo(lb.x, lb.y);
      cr.stroke();
      break;
    }
    case 'arrow': {
      setColor(cr, stroke.color, 1);
      cr.setLineWidth(thicknessPx(stroke.thickness));
      cr.setLineJoin(0 /* Cairo.LineJoin.MITER */);
      cr.setLineCap(1 /* Cairo.LineCap.ROUND */);
      const a = { x: px(stroke.points[0].normX), y: py(stroke.points[0].normY) };
      const b = { x: px(lastPoint(stroke).normX), y: py(lastPoint(stroke).normY) };
      cr.newPath();
      cr.moveTo(a.x, a.y);
      cr.lineTo(b.x, b.y);
      cr.stroke();
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const headLen = 16 + thicknessPx(stroke.thickness) * 2;
      cr.newPath();
      cr.moveTo(b.x, b.y);
      cr.lineTo(
        b.x - headLen * Math.cos(angle - Math.PI / 6),
        b.y - headLen * Math.sin(angle - Math.PI / 6),
      );
      cr.moveTo(b.x, b.y);
      cr.lineTo(
        b.x - headLen * Math.cos(angle + Math.PI / 6),
        b.y - headLen * Math.sin(angle + Math.PI / 6),
      );
      cr.stroke();
      break;
    }
    case 'box': {
      const bp0 = stroke.points[0];
      const bp1 = lastPoint(stroke);
      const bcx = (bp0.normX + bp1.normX) / 2;
      const bcy = (bp0.normY + bp1.normY) / 2;
      const bhw = Math.abs(bp1.normX - bp0.normX) / 2;
      const bhh = Math.abs(bp1.normY - bp0.normY) / 2;
      const bangle = stroke.rotation ?? 0;
      setColor(cr, stroke.color, 1);
      cr.setLineWidth(thicknessPx(stroke.thickness));
      cr.setLineJoin(0 /* Cairo.LineJoin.MITER */);
      cr.translate(px(bcx), py(bcy));
      cr.rotate(bangle);
      cr.rectangle(-px(bhw), -py(bhh), px(bhw) * 2, py(bhh) * 2);
      cr.stroke();
      break;
    }
    case 'ellipse': {
      const { cx, cy, rx, ry, angle } = ellipseParams(stroke);
      setColor(cr, stroke.color, 1);
      cr.setLineWidth(thicknessPx(stroke.thickness));
      cr.setLineJoin(0 /* Cairo.LineJoin.MITER */);
      // Cairo has no native ellipse — scale + arc trick
      cr.save();
      cr.translate(px(cx), py(cy));
      cr.rotate(angle);
      const radiusX = Math.max(1, rx * w);
      const radiusY = Math.max(1, ry * (h - cropTop));
      cr.scale(1, radiusY / radiusX);
      cr.newPath();
      cr.arc(0, 0, radiusX, 0, 2 * Math.PI);
      cr.restore();
      cr.stroke();
      break;
    }
  }

  cr.restore();
}
