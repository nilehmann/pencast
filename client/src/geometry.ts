import Flatten from "@flatten-js/core";
import type { AnnotationStroke, NormalizedPoint, CanvasPoint } from "../../shared/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const HANDLE_RADIUS_NORM = 0.012; // normalized radius for handle hit test
export const HIT_RADIUS_NORM = 0.015; // normalized radius for shape body hit test

/**
 * Squared distance from point (px, py) to segment (sx, sy)→(ex, ey),
 * all in the same coordinate space (normalised or pixel).
 */
export function distToSegSq(
  px: number,
  py: number,
  sx: number,
  sy: number,
  ex: number,
  ey: number,
): number {
  const dx = ex - sx;
  const dy = ey - sy;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return (px - sx) ** 2 + (py - sy) ** 2;
  const t = Math.max(0, Math.min(1, ((px - sx) * dx + (py - sy) * dy) / lenSq));
  return (px - (sx + t * dx)) ** 2 + (py - (sy + t * dy)) ** 2;
}

/** Pixel offset of the rotation handle above the top cardinal point (in norm units). */
export const ROTATION_HANDLE_OFFSET = 0.045;

/**
 * Convert a pixel-space point back to normalized space.
 */
function toNorm(p: CanvasPoint, W: number, H: number): NormalizedPoint {
  return { normX: p.x / W, normY: p.y / H };
}

// ---------------------------------------------------------------------------
// Handle index layout for circles
//
//  0 = top cardinal    (0, -ry) rotated
//  1 = right cardinal  (+rx, 0) rotated
//  2 = bottom cardinal (0, +ry) rotated
//  3 = left cardinal   (-rx, 0) rotated
//  4 = center          (cx, cy)
//  5 = rotation handle (above top cardinal, offset outward)
// ---------------------------------------------------------------------------

export const CIRCLE_HANDLE_TOP = 0;
export const CIRCLE_HANDLE_RIGHT = 1;
export const CIRCLE_HANDLE_BOTTOM = 2;
export const CIRCLE_HANDLE_LEFT = 3;
export const CIRCLE_HANDLE_CENTER = 4;
export const CIRCLE_HANDLE_ROTATE = 5;

// ---------------------------------------------------------------------------
// Internal coordinate helpers
// ---------------------------------------------------------------------------

function fp(p: NormalizedPoint): Flatten.Point {
  return Flatten.point(p.normX, p.normY);
}

function fseg(a: NormalizedPoint, b: NormalizedPoint): Flatten.Segment {
  return Flatten.segment(fp(a), fp(b));
}

/** Build a closed Flatten.Polygon from an array of points (lasso path). */
function buildPolygon(points: NormalizedPoint[]): Flatten.Polygon {
  const poly = new Flatten.Polygon();
  if (points.length < 3) return poly;
  const flatPts = points.map(fp);
  poly.addFace(flatPts);
  return poly;
}

// ---------------------------------------------------------------------------
// Circle / ellipse helpers
// ---------------------------------------------------------------------------

export interface EllipseParams {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  angle: number; // radians
}

/** Returns the last point of a stroke's points array. */
export function lastPoint(stroke: AnnotationStroke): NormalizedPoint {
  return stroke.points[stroke.points.length - 1];
}

/**
 * Decompose a circle stroke into its ellipse parameters.
 * points[0] and points[last] are the two opposite corners of the
 * pre-rotation bounding rectangle.  rotation is stored on the stroke.
 */
export function ellipseParams(stroke: AnnotationStroke): EllipseParams {
  const p0 = stroke.points[0];
  const p1 = lastPoint(stroke);
  const cx = (p0.normX + p1.normX) / 2;
  const cy = (p0.normY + p1.normY) / 2;
  const rx = Math.abs(p1.normX - p0.normX) / 2;
  const ry = Math.abs(p1.normY - p0.normY) / 2;
  const angle = stroke.rotation ?? 0;
  return { cx, cy, rx, ry, angle };
}

/**
 * Rotate a point (px, py) around center (cx, cy) by angle radians.
 */
function rotateAround(
  px: number,
  py: number,
  cx: number,
  cy: number,
  angle: number,
): { x: number; y: number } {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = px - cx;
  const dy = py - cy;
  return {
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos,
  };
}

/**
 * Return the 4 cardinal points of the ellipse (in rotated space),
 * plus the center, plus the rotation handle point.
 * Index layout: [top, right, bottom, left, center, rotation].
 *
 * All geometry is computed in pixel space so that handles sit exactly
 * on the rendered ellipse regardless of canvas aspect ratio.
 * The returned points are converted back to normalized coords.
 *
 * @param W  Canvas width in pixels
 * @param H  Canvas height in pixels
 */
export function circleHandlePoints(
  stroke: AnnotationStroke,
  W: number,
  H: number,
): NormalizedPoint[] {
  const { cx, cy, rx, ry, angle } = ellipseParams(stroke);

  // Ellipse center in pixels
  const pcx = cx * W;
  const pcy = cy * H;
  // Radii in pixels
  const prx = rx * W;
  const pry = ry * H;

  // Cardinal points in unrotated pixel space, then rotate
  const topPx: CanvasPoint = rotateAround(pcx, pcy - pry, pcx, pcy, angle);
  const rightPx: CanvasPoint = rotateAround(pcx + prx, pcy, pcx, pcy, angle);
  const bottomPx: CanvasPoint = rotateAround(pcx, pcy + pry, pcx, pcy, angle);
  const leftPx: CanvasPoint = rotateAround(pcx - prx, pcy, pcx, pcy, angle);

  // Rotation handle: ROTATION_HANDLE_OFFSET is in normalized units,
  // convert to pixels along the top-cardinal direction
  const topDirX = topPx.x - pcx;
  const topDirY = topPx.y - pcy;
  const topLen = Math.hypot(topDirX, topDirY);
  const offsetPx = ROTATION_HANDLE_OFFSET * Math.min(W, H);
  const rotHandlePx: CanvasPoint =
    topLen > 1e-9
      ? {
          x: topPx.x + (topDirX / topLen) * offsetPx,
          y: topPx.y + (topDirY / topLen) * offsetPx,
        }
      : { x: pcx, y: pcy - pry - offsetPx };

  return [
    toNorm(topPx, W, H),
    toNorm(rightPx, W, H),
    toNorm(bottomPx, W, H),
    toNorm(leftPx, W, H),
    { normX: cx, normY: cy }, // center — already normalized
    toNorm(rotHandlePx, W, H),
  ];
}

/**
 * Compute the rotation angle for an ellipse given the current pointer
 * position, operating in pixel space to avoid aspect-ratio distortion.
 *
 * The angle is defined as the direction from the ellipse center to the
 * pointer, measured in pixel space, offset by −π/2 so that dragging
 * straight up (toward the initial rotation handle) gives angle = 0.
 *
 * @param cx   Ellipse center x (normalized)
 * @param cy   Ellipse center y (normalized)
 * @param px   Pointer x (normalized)
 * @param py   Pointer y (normalized)
 * @param W    Canvas width in pixels
 * @param H    Canvas height in pixels
 */
export function computeRotationAngle(
  cx: number,
  cy: number,
  px: number,
  py: number,
  W: number,
  H: number,
): number {
  const dcx = cx * W;
  const dcy = cy * H;
  const dpx = px * W;
  const dpy = py * H;
  return Math.atan2(dpy - dcy, dpx - dcx) + Math.PI / 2;
}

/**
 * True rotated-ellipse AABB.
 * Uses the parametric extrema formula:
 *   x(t) = cx + rx·cos(t)·cos(a) - ry·sin(t)·sin(a)
 *   y(t) = cy + rx·cos(t)·sin(a) + ry·sin(t)·cos(a)
 * Extrema occur when dx/dt = 0 and dy/dt = 0.
 */
export function ellipseAABB(e: EllipseParams): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  const { cx, cy, rx, ry, angle } = e;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const hw = Math.sqrt(rx * rx * cos * cos + ry * ry * sin * sin);
  const hh = Math.sqrt(rx * rx * sin * sin + ry * ry * cos * cos);
  return {
    minX: cx - hw,
    minY: cy - hh,
    maxX: cx + hw,
    maxY: cy + hh,
  };
}

// ---------------------------------------------------------------------------
// Box corner helpers
// ---------------------------------------------------------------------------

/**
 * A box stroke stores two opposite corners in points[0] and points[1].
 * Derive all 4 corners: [TL, TR, BR, BL] (index 0–3).
 */
export function boxCorners(
  stroke: AnnotationStroke,
): [NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint] {
  const p0 = stroke.points[0];
  const p1 = lastPoint(stroke);
  const minX = Math.min(p0.normX, p1.normX);
  const minY = Math.min(p0.normY, p1.normY);
  const maxX = Math.max(p0.normX, p1.normX);
  const maxY = Math.max(p0.normY, p1.normY);
  return [
    { normX: minX, normY: minY }, // 0: TL
    { normX: maxX, normY: minY }, // 1: TR
    { normX: maxX, normY: maxY }, // 2: BR
    { normX: minX, normY: maxY }, // 3: BL
  ];
}

/** Opposite corner index for a box handle (0↔2, 1↔3). */
function oppositeCorner(idx: number): number {
  return (idx + 2) % 4;
}

// ---------------------------------------------------------------------------
// Handles
// ---------------------------------------------------------------------------

/**
 * Returns the draggable handle positions for a shape.
 * - arrow:  [start, end]
 * - box:    [TL, TR, BR, BL]
 * - circle: [top, right, bottom, left, center, rotation]
 *
 * @param W  Canvas width in pixels (required for circle handles)
 * @param H  Canvas height in pixels (required for circle handles)
 */
export function getHandles(stroke: AnnotationStroke, W = 1, H = 1): NormalizedPoint[] {
  if (stroke.tool === "arrow") {
    return [stroke.points[0], lastPoint(stroke)];
  }
  if (stroke.tool === "box") {
    return boxCorners(stroke);
  }
  if (stroke.tool === "ellipse") {
    return circleHandlePoints(stroke, W, H);
  }
  return [];
}

export function hitTestHandle(
  handle: NormalizedPoint,
  p: NormalizedPoint,
  radiusNorm = HANDLE_RADIUS_NORM,
): boolean {
  return Math.hypot(handle.normX - p.normX, handle.normY - p.normY) < radiusNorm;
}

/**
 * Returns the index of the first handle hit, or -1 if none.
 * Checks all handles of the given stroke.
 *
 * @param W  Canvas width in pixels (required for circle handles)
 * @param H  Canvas height in pixels (required for circle handles)
 */
export function hitTestHandles(
  stroke: AnnotationStroke,
  p: NormalizedPoint,
  W = 1,
  H = 1,
): number {
  const handles = getHandles(stroke, W, H);
  for (let i = 0; i < handles.length; i++) {
    if (hitTestHandle(handles[i], p)) return i;
  }
  return -1;
}

/**
 * Returns the index of the first shared bounding-box corner handle hit, or -1.
 * corners: [TL, TR, BR, BL] in normalized coords.
 */
export function hitTestBBoxHandles(corners: NormalizedPoint[], p: NormalizedPoint): number {
  for (let i = 0; i < corners.length; i++) {
    if (hitTestHandle(corners[i], p)) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Shape body hit testing
// ---------------------------------------------------------------------------

export function hitTestShape(
  stroke: AnnotationStroke,
  p: NormalizedPoint,
  radius = HIT_RADIUS_NORM,
): boolean {
  const rSq = radius * radius;

  if (stroke.tool === "arrow") {
    const a = stroke.points[0];
    const b = lastPoint(stroke);
    return distToSegSq(p.normX, p.normY, a.normX, a.normY, b.normX, b.normY) < rSq;
  }

  if (stroke.tool === "box") {
    const [tl, tr, br, bl] = boxCorners(stroke);
    // For the default (select) radius keep the interior shortcut so clicking
    // anywhere inside the box selects it; callers that only want outline
    // proximity (eraser) pass a smaller radius and this condition won't fire.
    if (radius >= HIT_RADIUS_NORM) {
      if (p.normX >= tl.normX && p.normX <= tr.normX && p.normY >= tl.normY && p.normY <= bl.normY) {
        return true;
      }
    }
    const edges: [NormalizedPoint, NormalizedPoint][] = [
      [tl, tr],
      [tr, br],
      [br, bl],
      [bl, tl],
    ];
    for (const [ea, eb] of edges) {
      if (distToSegSq(p.normX, p.normY, ea.normX, ea.normY, eb.normX, eb.normY) < rSq) return true;
    }
    return false;
  }

  if (stroke.tool === "ellipse") {
    if (radius >= HIT_RADIUS_NORM) {
      // Select tool: hit interior
      return hitTestEllipse(stroke, p);
    }
    // Eraser (smaller radius): test proximity to outline only
    return hitTestEllipseOutline(stroke, p, radius);
  }

  if (stroke.tool === "ink" || stroke.tool === "highlighter") {
    for (const pt of stroke.points) {
      if ((pt.normX - p.normX) ** 2 + (pt.normY - p.normY) ** 2 < rSq) return true;
    }
    for (let i = 0; i < stroke.points.length - 1; i++) {
      const a = stroke.points[i],
        b = stroke.points[i + 1];
      if (distToSegSq(p.normX, p.normY, a.normX, a.normY, b.normX, b.normY) < rSq) return true;
    }
    return false;
  }

  return false;
}

/**
 * Hit test a point against the ellipse interior.
 * Transform the point into the ellipse's local axis-aligned frame,
 * then test (dx/rx)^2 + (dy/ry)^2 <= 1.
 */
function hitTestEllipse(stroke: AnnotationStroke, p: NormalizedPoint): boolean {
  const { cx, cy, rx, ry, angle } = ellipseParams(stroke);
  if (rx < 1e-9 || ry < 1e-9) return false;

  const local = rotateAround(p.normX, p.normY, cx, cy, -angle);
  const dx = local.x - cx;
  const dy = local.y - cy;
  return (dx / rx) * (dx / rx) + (dy / ry) * (dy / ry) <= 1;
}

/**
 * Hit test a point against the ellipse outline within the given radius.
 * Works by rotating p into the ellipse's local frame and checking how close
 * the normalised radial distance is to 1.
 */
export function hitTestEllipseOutline(
  stroke: AnnotationStroke,
  p: NormalizedPoint,
  radius: number,
): boolean {
  const { cx, cy, rx, ry, angle } = ellipseParams(stroke);
  if (rx < 1e-9 || ry < 1e-9) return false;
  const local = rotateAround(p.normX, p.normY, cx, cy, -angle);
  const ndx = local.x - cx;
  const ndy = local.y - cy;
  const d = Math.sqrt((ndx / rx) ** 2 + (ndy / ry) ** 2);
  return Math.abs(d - 1) < radius / Math.min(rx, ry);
}

// ---------------------------------------------------------------------------
// Lasso intersection test
// ---------------------------------------------------------------------------

export function lassoIntersectsShape(
  lassoPoints: NormalizedPoint[],
  stroke: AnnotationStroke,
): boolean {
  if (lassoPoints.length < 3) return false;
  const lassoPoly = buildPolygon(lassoPoints);

  if (stroke.tool === "arrow") {
    const a = stroke.points[0];
    const b = lastPoint(stroke);
    if (lassoPoly.contains(fp(a)) || lassoPoly.contains(fp(b))) return true;
    const arrowSeg = fseg(a, b);
    for (const edge of lassoPoly.edges) {
      if (arrowSeg.intersect(edge.shape).length > 0) return true;
    }
    return false;
  }

  if (stroke.tool === "box") {
    const corners = boxCorners(stroke);
    for (const corner of corners) {
      if (lassoPoly.contains(fp(corner))) return true;
    }
    const boxPoly = buildPolygon(corners as NormalizedPoint[]);
    for (const lp of lassoPoints) {
      if (boxPoly.contains(fp(lp))) return true;
    }
    const boxEdges: [NormalizedPoint, NormalizedPoint][] = [
      [corners[0], corners[1]],
      [corners[1], corners[2]],
      [corners[2], corners[3]],
      [corners[3], corners[0]],
    ];
    for (const [ea, eb] of boxEdges) {
      const seg = fseg(ea, eb);
      for (const lassoEdge of lassoPoly.edges) {
        if (seg.intersect(lassoEdge.shape).length > 0) return true;
      }
    }
    return false;
  }

  if (stroke.tool === "ellipse") {
    return lassoIntersectsEllipse(lassoPoly, lassoPoints, stroke);
  }

  if (stroke.tool === "ink" || stroke.tool === "highlighter") {
    for (const pt of stroke.points) {
      if (lassoPoly.contains(fp(pt))) return true;
    }
    for (let i = 0; i < stroke.points.length - 1; i++) {
      const seg = fseg(stroke.points[i], stroke.points[i + 1]);
      for (const lassoEdge of lassoPoly.edges) {
        if (seg.intersect(lassoEdge.shape).length > 0) return true;
      }
    }
    return false;
  }

  return false;
}

/**
 * Lasso vs ellipse: approximate the ellipse outline with N line segments,
 * then test:
 *   (a) any ellipse sample point is inside the lasso polygon, or
 *   (b) any ellipse segment intersects any lasso edge.
 */
function lassoIntersectsEllipse(
  lassoPoly: Flatten.Polygon,
  lassoPoints: NormalizedPoint[],
  stroke: AnnotationStroke,
): boolean {
  const SAMPLES = 48;
  const { cx, cy, rx, ry, angle } = ellipseParams(stroke);

  const ellipsePts: NormalizedPoint[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const t = (2 * Math.PI * i) / SAMPLES;
    const lx = cx + rx * Math.cos(t);
    const ly = cy + ry * Math.sin(t);
    const rotated = rotateAround(lx, ly, cx, cy, angle);
    ellipsePts.push({ normX: rotated.x, normY: rotated.y });
  }

  // (a) any ellipse point inside lasso
  for (const ep of ellipsePts) {
    if (lassoPoly.contains(fp(ep))) return true;
  }

  // (b) any lasso point inside ellipse (lasso surrounds the ellipse)
  for (const lp of lassoPoints) {
    if (hitTestEllipse(stroke, lp)) return true;
  }

  // (c) any ellipse edge intersects any lasso edge
  for (let i = 0; i < ellipsePts.length; i++) {
    const a = ellipsePts[i];
    const b = ellipsePts[(i + 1) % ellipsePts.length];
    const seg = fseg(a, b);
    for (const lassoEdge of lassoPoly.edges) {
      if (seg.intersect(lassoEdge.shape).length > 0) return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Bounding box
// ---------------------------------------------------------------------------

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function computeBoundingBox(strokes: AnnotationStroke[]): BoundingBox {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  for (const stroke of strokes) {
    if (stroke.tool === "ellipse") {
      const aabb = ellipseAABB(ellipseParams(stroke));
      if (aabb.minX < minX) minX = aabb.minX;
      if (aabb.minY < minY) minY = aabb.minY;
      if (aabb.maxX > maxX) maxX = aabb.maxX;
      if (aabb.maxY > maxY) maxY = aabb.maxY;
    } else {
      for (const p of stroke.points) {
        if (p.normX < minX) minX = p.normX;
        if (p.normY < minY) minY = p.normY;
        if (p.normX > maxX) maxX = p.normX;
        if (p.normY > maxY) maxY = p.normY;
      }
    }
  }

  return { minX, minY, maxX, maxY };
}

/** Returns the 4 corners of a BoundingBox as [TL, TR, BR, BL]. */
export function bboxCorners(box: BoundingBox): [NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint] {
  return [
    { normX: box.minX, normY: box.minY }, // 0: TL
    { normX: box.maxX, normY: box.minY }, // 1: TR
    { normX: box.maxX, normY: box.maxY }, // 2: BR
    { normX: box.minX, normY: box.maxY }, // 3: BL
  ];
}

// ---------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function clampPoint(p: NormalizedPoint): NormalizedPoint {
  return { normX: clamp01(p.normX), normY: clamp01(p.normY), pressure: p.pressure };
}

export function applyTranslate(
  stroke: AnnotationStroke,
  dx: number,
  dy: number,
): AnnotationStroke {
  return {
    ...stroke,
    points: stroke.points.map((p) =>
      clampPoint({ normX: p.normX + dx, normY: p.normY + dy, pressure: p.pressure }),
    ),
  };
}

/**
 * Proportionally scale all strokes from oldBox into newBox.
 */
export function applyScaleToGroup(
  strokes: AnnotationStroke[],
  oldBox: BoundingBox,
  newBox: BoundingBox,
): AnnotationStroke[] {
  const oldW = oldBox.maxX - oldBox.minX;
  const oldH = oldBox.maxY - oldBox.minY;
  const newW = newBox.maxX - newBox.minX;
  const newH = newBox.maxY - newBox.minY;

  const scaleX = oldW > 1e-9 ? newW / oldW : 1;
  const scaleY = oldH > 1e-9 ? newH / oldH : 1;

  return strokes.map((stroke) => {
    const scaledPoints = stroke.points.map((p) => {
      const nx =
        oldW > 1e-9
          ? newBox.minX + (p.normX - oldBox.minX) * scaleX
          : p.normX + (newBox.minX - oldBox.minX);
      const ny =
        oldH > 1e-9
          ? newBox.minY + (p.normY - oldBox.minY) * scaleY
          : p.normY + (newBox.minY - oldBox.minY);
      return clampPoint({ normX: nx, normY: ny, pressure: p.pressure });
    });

    return { ...stroke, points: scaledPoints };
  });
}

/**
 * Resize a single shape by moving one handle to newPos.
 *
 * Arrow:  handleIndex 0 = start, 1 = end.
 * Box:    handleIndex 0–3 = [TL, TR, BR, BL].
 * Circle: handleIndex 0–3 = cardinal (resize one axis),
 *         handleIndex 4   = center (translate only, handled upstream),
 *         handleIndex 5   = rotation handle (handled upstream).
 */
export function applySingleResize(
  stroke: AnnotationStroke,
  handleIndex: number,
  newPos: NormalizedPoint,
): AnnotationStroke {
  if (stroke.tool === "arrow") {
    const newPoints = [...stroke.points];
    if (handleIndex === 0) {
      newPoints[0] = clampPoint(newPos);
    } else {
      newPoints[newPoints.length - 1] = clampPoint(newPos);
    }
    return { ...stroke, points: newPoints };
  }

  if (stroke.tool === "box") {
    const corners = boxCorners(stroke);
    const anchorIdx = oppositeCorner(handleIndex);
    const anchor = corners[anchorIdx];
    const dragged = clampPoint(newPos);
    return { ...stroke, points: [anchor, dragged] };
  }

  if (stroke.tool === "ellipse") {
    return applyCircleCardinalResize(stroke, handleIndex, newPos);
  }

  return stroke;
}

/**
 * Resize an ellipse by dragging one of its cardinal handles.
 *
 * The handle lives on a rotated axis.  We:
 *   1. Unrotate newPos into the ellipse's local frame.
 *   2. Update only the axis that corresponds to the handle (rx or ry).
 *   3. Re-derive the two bounding-rect corner points from the new (cx,cy,rx,ry).
 *   4. Keep rotation unchanged.
 */
function applyCircleCardinalResize(
  stroke: AnnotationStroke,
  handleIndex: number,
  newPos: NormalizedPoint,
): AnnotationStroke {
  const { cx, cy, rx, ry, angle } = ellipseParams(stroke);

  // Unrotate newPos into the local (axis-aligned) frame
  const local = rotateAround(newPos.normX, newPos.normY, cx, cy, -angle);

  let newRx = rx;
  let newRy = ry;

  switch (handleIndex) {
    case CIRCLE_HANDLE_TOP: // vertical axis, negative side
    case CIRCLE_HANDLE_BOTTOM: // vertical axis, positive side
      newRy = Math.max(1e-9, Math.abs(local.y - cy));
      break;
    case CIRCLE_HANDLE_RIGHT: // horizontal axis, positive side
    case CIRCLE_HANDLE_LEFT: // horizontal axis, negative side
      newRx = Math.max(1e-9, Math.abs(local.x - cx));
      break;
  }

  // Re-derive the two bounding-rect corners from (cx, cy, newRx, newRy)
  const p0 = clampPoint({ normX: cx - newRx, normY: cy - newRy });
  const p1 = clampPoint({ normX: cx + newRx, normY: cy + newRy });

  return { ...stroke, points: [p0, p1] };
}

/**
 * Uniformly scale an ellipse using a linear "slider" drag.
 * The scale factor is driven by the signed displacement from the
 * pointerdown position: dragging right or up grows the ellipse,
 * dragging left or down shrinks it.
 *
 * scalar = (dx - dy) in normalized coords (canvas Y increases downward,
 * so up = negative dy, which becomes positive contribution).
 *
 * factor = 1 + scalar / SENSITIVITY
 *
 * @param stroke   The original stroke captured at pointerdown.
 * @param startP   Pointer position at pointerdown (normalized).
 * @param currentP Current pointer position (normalized).
 */
const SCALE_SENSITIVITY = 0.35; // normalized units of drag for a 2× scale

export function applyCircleUniformScale(
  stroke: AnnotationStroke,
  startP: NormalizedPoint,
  currentP: NormalizedPoint,
): AnnotationStroke {
  const dx = currentP.normX - startP.normX;
  const dy = currentP.normY - startP.normY;
  // Right and up are positive; left and down are negative.
  // Canvas Y grows downward, so "up" means dy < 0 → subtract dy.
  const scalar = dx - dy;
  const factor = Math.max(0.05, 1 + scalar / SCALE_SENSITIVITY);
  const { cx, cy, rx, ry } = ellipseParams(stroke);
  const newRx = Math.max(1e-9, rx * factor);
  const newRy = Math.max(1e-9, ry * factor);
  const p0 = clampPoint({ normX: cx - newRx, normY: cy - newRy });
  const p1 = clampPoint({ normX: cx + newRx, normY: cy + newRy });
  return { ...stroke, points: [p0, p1] };
}

/**
 * Apply a rotation to an ellipse stroke.
 * Returns a new stroke with the updated rotation field.
 * Optionally snaps to 15° increments when snapDeg is provided.
 */
export function applyCircleRotation(
  stroke: AnnotationStroke,
  newAngle: number,
  snap = false,
): AnnotationStroke {
  let angle = newAngle;
  if (snap) {
    const snapRad = (15 * Math.PI) / 180;
    angle = Math.round(angle / snapRad) * snapRad;
  }
  return { ...stroke, rotation: angle };
}

/**
 * Given a bounding box and a dragged corner index + new position,
 * return the new bounding box (the opposite corner is anchored).
 */
export function newBBoxFromCornerDrag(
  origBox: BoundingBox,
  cornerIndex: number,
  newPos: NormalizedPoint,
): BoundingBox {
  const corners = bboxCorners(origBox);
  const anchorIdx = oppositeCorner(cornerIndex);
  const anchor = corners[anchorIdx];
  const dragged = clampPoint(newPos);

  return {
    minX: Math.min(anchor.normX, dragged.normX),
    minY: Math.min(anchor.normY, dragged.normY),
    maxX: Math.max(anchor.normX, dragged.normX),
    maxY: Math.max(anchor.normY, dragged.normY),
  };
}

/**
 * Find the middle point of the bounding box surrounding the given strokes.
 */
export function middlePoint(strokes: AnnotationStroke[]): NormalizedPoint {
  const allPoints = strokes.flatMap((s) => s.points);
  const minX = Math.min(...allPoints.map((p) => p.normX));
  const minY = Math.min(...allPoints.map((p) => p.normY));
  const maxX = Math.max(...allPoints.map((p) => p.normX));
  const maxY = Math.max(...allPoints.map((p) => p.normY));
  return { normX: (minX + maxX) / 2, normY: (minY + maxY) / 2 };
}
