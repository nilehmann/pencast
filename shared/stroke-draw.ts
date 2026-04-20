// Platform-agnostic stroke drawing helpers shared between
// client/src/draw.ts (Canvas 2D) and gnome-extension (Cairo).

import { getStroke } from "perfect-freehand";
import type { AnnotationStroke, AnnotationTool, NormalizedPoint, StrokeThickness } from "./types.js";

/** Cairo-compatible RGB colour palette (each channel 0–1). */
export const COLORS: Record<string, [number, number, number]> = {
  orange: [0.976, 0.451, 0.086],
  red:    [0.937, 0.267, 0.267],
  green:  [0.133, 0.773, 0.369],
  yellow: [0.918, 0.702, 0.031],
  black:  [0.067, 0.067, 0.067],
  gray:   [0.612, 0.639, 0.686],
  blue:   [0.231, 0.510, 0.965],
};

export function thicknessPx(t: StrokeThickness): number {
  if (t === "thin") return 4;
  if (t === "medium") return 7;
  return 12;
}

export function getStrokeAlpha(tool: AnnotationTool): number {
  return tool === "highlighter" ? 0.3 : 1.0;
}

/**
 * Compute the perfect-freehand outline polygon for a freehand stroke.
 * Handles ink/pointer and highlighter with appropriate settings.
 * Returned points are in canvas-pixel coordinates (scaled by w/h).
 */
export function getStrokeOutlinePoints(
  stroke: AnnotationStroke,
  w: number,
  h: number,
): number[][] {
  const px = (x: number) => x * w;
  const py = (y: number) => y * h;

  if (stroke.tool === "highlighter") {
    const pts = stroke.points.map((p: NormalizedPoint) => [px(p.normX), py(p.normY), 0.5]);
    return getStroke(pts, {
      size: thicknessPx("thick") * 2,
      thinning: 0,
      smoothing: 0.5,
      streamline: 0.5,
      simulatePressure: false,
    });
  }

  const pts = stroke.points.map((p: NormalizedPoint) => [px(p.normX), py(p.normY), p.pressure ?? 0.5]);
  return getStroke(pts, {
    size: thicknessPx(stroke.thickness),
    thinning: 0.5,
    smoothing: 0.5,
    streamline: 0.5,
    simulatePressure: false,
  });
}
