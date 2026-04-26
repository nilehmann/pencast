import { assertAnnotationSlide } from "./generated/index.js";
import type {
  AnnotationMap,
  AnnotationStroke,
  AnnotationsFile,
  HtmlAnnotationsFile,
  PdfAnnotationMap,
} from "./types.js";

export function parseAnnotationMap(
  raw: unknown,
  fallback: AnnotationMap,
): AnnotationMap {
  if (Array.isArray(raw)) {
    const result: AnnotationMap = {};
    for (let i = 0; i < raw.length; i++) {
      try {
        const slide = assertAnnotationSlide(raw[i]);
        if (slide.length > 0) result[i] = slide;
      } catch {
        // skip invalid slides
      }
    }
    return result;
  }
  if (typeof raw !== "object" || raw === null) return fallback;
  const result: AnnotationMap = {};
  for (const key of Object.keys(raw)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0) continue;
    try {
      const slide = assertAnnotationSlide(
        (raw as Record<string, unknown>)[key],
      );
      result[index] = slide;
    } catch {
      // skip invalid slides
    }
  }
  return result;
}

export function parsePdfAnnotationMap(raw: unknown): PdfAnnotationMap {
  if (typeof raw !== "object" || raw === null) return {};
  const result: PdfAnnotationMap = {};
  for (const key of Object.keys(raw as Record<string, unknown>)) {
    const slideIndex = Number(key);
    if (!Number.isInteger(slideIndex) || slideIndex < 0) continue;
    const slideValue = (raw as Record<string, unknown>)[key];
    if (!Array.isArray(slideValue)) continue;
    const pages: AnnotationStroke[][] = [];
    for (const pageRaw of slideValue) {
      try {
        pages.push(assertAnnotationSlide(pageRaw));
      } catch {
        pages.push([]);
      }
    }
    if (pages.length > 0) result[slideIndex] = pages;
  }
  return result;
}

export function parseSubPageCounts(raw: unknown): Record<number, number> {
  if (typeof raw !== "object" || raw === null) return {};
  const result: Record<number, number> = {};
  for (const key of Object.keys(raw as Record<string, unknown>)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0) continue;
    const val = (raw as Record<string, unknown>)[key];
    if (typeof val === "number" && val >= 1) result[index] = val;
  }
  return result;
}

export function parseAnnotationsFile(raw: unknown): AnnotationsFile {
  if (typeof raw !== "object" || raw === null) {
    return { annotations: {}, whiteboardAnnotations: {}, subPageCounts: {} };
  }
  const obj = raw as Record<string, unknown>;
  return {
    annotations: parsePdfAnnotationMap(obj.annotations),
    whiteboardAnnotations: parseAnnotationMap(obj.whiteboardAnnotations, {}),
    subPageCounts: parseSubPageCounts(obj.subPageCounts),
  };
}

export function parseHtmlAnnotationsFile(raw: unknown): HtmlAnnotationsFile {
  if (typeof raw !== "object" || raw === null) {
    return { annotations: {} };
  }
  const obj = raw as Record<string, unknown>;
  return { annotations: parseAnnotationMap(obj.annotations, {}) };
}
