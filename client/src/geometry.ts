import Flatten from "@flatten-js/core";
import type { AnnotationStroke, Point } from "../../shared/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const HANDLE_RADIUS_NORM = 0.012; // normalized radius for handle hit test
export const HIT_RADIUS_NORM = 0.015; // normalized radius for shape body hit test

// ---------------------------------------------------------------------------
// Internal coordinate helpers
// ---------------------------------------------------------------------------

function fp(p: Point): Flatten.Point {
  return Flatten.point(p.x, p.y);
}

function fseg(a: Point, b: Point): Flatten.Segment {
  return Flatten.segment(fp(a), fp(b));
}

/** Build a closed Flatten.Polygon from an array of points (lasso path). */
function buildPolygon(points: Point[]): Flatten.Polygon {
  const poly = new Flatten.Polygon();
  if (points.length < 3) return poly;
  const flatPts = points.map(fp);
  poly.addFace(flatPts);
  return poly;
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
): [Point, Point, Point, Point] {
  const p0 = stroke.points[0];
  const p1 = stroke.points[stroke.points.length - 1];
  const minX = Math.min(p0.x, p1.x);
  const minY = Math.min(p0.y, p1.y);
  const maxX = Math.max(p0.x, p1.x);
  const maxY = Math.max(p0.y, p1.y);
  return [
    { x: minX, y: minY }, // 0: TL
    { x: maxX, y: minY }, // 1: TR
    { x: maxX, y: maxY }, // 2: BR
    { x: minX, y: maxY }, // 3: BL
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
 * - arrow: [start, end]
 * - box:   [TL, TR, BR, BL]
 */
export function getHandles(stroke: AnnotationStroke): Point[] {
  if (stroke.tool === "arrow") {
    return [stroke.points[0], stroke.points[stroke.points.length - 1]];
  }
  if (stroke.tool === "box") {
    return boxCorners(stroke);
  }
  return [];
}

export function hitTestHandle(
  handle: Point,
  p: Point,
  radiusNorm = HANDLE_RADIUS_NORM,
): boolean {
  return Math.hypot(handle.x - p.x, handle.y - p.y) < radiusNorm;
}

/**
 * Returns the index of the first handle hit, or -1 if none.
 * Checks all handles of the given stroke.
 */
export function hitTestHandles(stroke: AnnotationStroke, p: Point): number {
  const handles = getHandles(stroke);
  for (let i = 0; i < handles.length; i++) {
    if (hitTestHandle(handles[i], p)) return i;
  }
  return -1;
}

/**
 * Returns the index of the first shared bounding-box corner handle hit, or -1.
 * corners: [TL, TR, BR, BL] in normalized coords.
 */
export function hitTestBBoxHandles(corners: Point[], p: Point): number {
  for (let i = 0; i < corners.length; i++) {
    if (hitTestHandle(corners[i], p)) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Shape body hit testing
// ---------------------------------------------------------------------------

export function hitTestShape(stroke: AnnotationStroke, p: Point): boolean {
  if (stroke.tool === "arrow") {
    // Test proximity to the line segment
    const a = stroke.points[0];
    const b = stroke.points[stroke.points.length - 1];
    const seg = fseg(a, b);
    const [dist] = seg.distanceTo(fp(p));
    return dist < HIT_RADIUS_NORM;
  }
  if (stroke.tool === "box") {
    const corners = boxCorners(stroke);
    // Test interior (inside the rectangle) or proximity to any edge
    const [tl, tr, br, bl] = corners;
    // Point inside rectangle?
    if (p.x >= tl.x && p.x <= tr.x && p.y >= tl.y && p.y <= bl.y) {
      return true;
    }
    // Proximity to any edge
    const edges: [Point, Point][] = [
      [tl, tr],
      [tr, br],
      [br, bl],
      [bl, tl],
    ];
    for (const [ea, eb] of edges) {
      const [dist] = fseg(ea, eb).distanceTo(fp(p));
      if (dist < HIT_RADIUS_NORM) return true;
    }
    return false;
  }
  if (stroke.tool === "ink" || stroke.tool === "highlighter") {
    // Test proximity to any point along the freehand path
    for (const pt of stroke.points) {
      if (Math.hypot(pt.x - p.x, pt.y - p.y) < HIT_RADIUS_NORM) return true;
    }
    // Also test proximity to each segment between consecutive points
    for (let i = 0; i < stroke.points.length - 1; i++) {
      const seg = fseg(stroke.points[i], stroke.points[i + 1]);
      const [dist] = seg.distanceTo(fp(p));
      if (dist < HIT_RADIUS_NORM) return true;
    }
    return false;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Lasso intersection test
// ---------------------------------------------------------------------------

export function lassoIntersectsShape(
  lassoPoints: Point[],
  stroke: AnnotationStroke,
): boolean {
  if (lassoPoints.length < 3) return false;
  const lassoPoly = buildPolygon(lassoPoints);

  if (stroke.tool === "arrow") {
    const a = stroke.points[0];
    const b = stroke.points[stroke.points.length - 1];
    // Either endpoint inside lasso OR arrow segment intersects any lasso edge
    if (lassoPoly.contains(fp(a)) || lassoPoly.contains(fp(b))) return true;
    const arrowSeg = fseg(a, b);
    for (const edge of lassoPoly.edges) {
      if (arrowSeg.intersect(edge.shape).length > 0) return true;
    }
    return false;
  }

  if (stroke.tool === "box") {
    const corners = boxCorners(stroke);
    // Any corner inside lasso?
    for (const corner of corners) {
      if (lassoPoly.contains(fp(corner))) return true;
    }
    // Any lasso point inside the box?
    const boxPoly = buildPolygon(corners as Point[]);
    for (const lp of lassoPoints) {
      if (boxPoly.contains(fp(lp))) return true;
    }
    // Any box edge intersects any lasso edge?
    const boxEdges: [Point, Point][] = [
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

  if (stroke.tool === "ink" || stroke.tool === "highlighter") {
    // Any ink point inside lasso?
    for (const pt of stroke.points) {
      if (lassoPoly.contains(fp(pt))) return true;
    }
    // Any ink segment intersects any lasso edge?
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
    for (const p of stroke.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return { minX, minY, maxX, maxY };
}

/** Returns the 4 corners of a BoundingBox as [TL, TR, BR, BL]. */
export function bboxCorners(box: BoundingBox): [Point, Point, Point, Point] {
  return [
    { x: box.minX, y: box.minY }, // 0: TL
    { x: box.maxX, y: box.minY }, // 1: TR
    { x: box.maxX, y: box.maxY }, // 2: BR
    { x: box.minX, y: box.maxY }, // 3: BL
  ];
}

// ---------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function clampPoint(p: Point): Point {
  return { x: clamp01(p.x), y: clamp01(p.y), pressure: p.pressure };
}

export function applyTranslate(
  stroke: AnnotationStroke,
  dx: number,
  dy: number,
): AnnotationStroke {
  return {
    ...stroke,
    points: stroke.points.map((p) =>
      clampPoint({ x: p.x + dx, y: p.y + dy, pressure: p.pressure }),
    ),
  };
}

/**
 * Proportionally scale all strokes from oldBox into newBox.
 * Each point is mapped: newX = newBox.minX + (p.x - oldBox.minX) / oldBox.width * newBox.width
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

  // Avoid divide-by-zero: if the old box is degenerate, just translate
  const scaleX = oldW > 1e-9 ? newW / oldW : 1;
  const scaleY = oldH > 1e-9 ? newH / oldH : 1;

  return strokes.map((stroke) => ({
    ...stroke,
    points: stroke.points.map((p) => {
      const nx =
        oldW > 1e-9
          ? newBox.minX + (p.x - oldBox.minX) * scaleX
          : p.x + (newBox.minX - oldBox.minX);
      const ny =
        oldH > 1e-9
          ? newBox.minY + (p.y - oldBox.minY) * scaleY
          : p.y + (newBox.minY - oldBox.minY);
      return clampPoint({ x: nx, y: ny, pressure: p.pressure });
    }),
  }));
}

/**
 * Resize a single shape by moving one handle to newPos.
 *
 * Arrow: handleIndex 0 = start, 1 = end. The other endpoint is anchored.
 * Box:   handleIndex 0–3 = [TL, TR, BR, BL]. The opposite corner is anchored;
 *        the resulting box is re-derived from the dragged corner and the anchor.
 */
export function applySingleResize(
  stroke: AnnotationStroke,
  handleIndex: number,
  newPos: Point,
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
    // Re-derive two canonical points (any two opposite corners work)
    return {
      ...stroke,
      points: [anchor, dragged],
    };
  }

  return stroke;
}

/**
 * Given a bounding box and a dragged corner index + new position,
 * return the new bounding box (the opposite corner is anchored).
 */
export function newBBoxFromCornerDrag(
  origBox: BoundingBox,
  cornerIndex: number,
  newPos: Point,
): BoundingBox {
  const corners = bboxCorners(origBox);
  const anchorIdx = oppositeCorner(cornerIndex);
  const anchor = corners[anchorIdx];
  const dragged = clampPoint(newPos);

  return {
    minX: Math.min(anchor.x, dragged.x),
    minY: Math.min(anchor.y, dragged.y),
    maxX: Math.max(anchor.x, dragged.x),
    maxY: Math.max(anchor.y, dragged.y),
  };
}
