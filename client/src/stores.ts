import { writable, get } from "svelte/store";
import type {
  AnnotationMap,
  AnnotationTool,
  DeviceRole,
  StrokeColor,
  StrokeThickness,
} from "../../shared/types.ts";
import type { AppState } from "../../shared/types.ts";

export const authToken = writable<string>(
  sessionStorage.getItem("authToken") ?? "",
);
export const deviceRole = writable<DeviceRole | null>(
  (sessionStorage.getItem("deviceRole") as DeviceRole | null) ?? null,
);
export const activePdfPath = writable<string | null>(null);
export const activePdfName = writable<string | null>(null);
export const pageCount = writable<number>(0);
export const currentSlide = writable<number>(0);
export const annotations = writable<AnnotationMap>({});

export const activeTool = writable<AnnotationTool>("ink");
export const activeColor = writable<StrokeColor>("orange");
export const activeThickness = writable<StrokeThickness>("medium");

export const selectedStrokeIds = writable<Set<string>>(new Set());

// Clear selection whenever the slide changes
currentSlide.subscribe(() => {
  selectedStrokeIds.set(new Set());
});

export function applyState(state: AppState): void {
  activePdfPath.set(state.activePdfPath);
  activePdfName.set(state.activePdfName);
  pageCount.set(state.pageCount);
  currentSlide.set(state.currentSlide);
  annotations.set(state.annotations);
  selectedStrokeIds.set(new Set());
}
