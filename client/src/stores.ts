import { writable } from "svelte/store";
import type {
  AnnotationMap,
  AnnotationSource,
  AnnotationStroke,
  AnnotationTool,
  DeviceRole,
  StrokeColor,
  StrokeThickness,
  Point,
  AppState,
} from "../../shared/types.ts";

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

// ── Whiteboard state ─────────────────────────────────────────────────────────
export const whiteboardMode = writable<boolean>(false);
export const whiteboardSlide = writable<number>(0);
export const whiteboardPageCount = writable<number>(1);
export const whiteboardAnnotations = writable<AnnotationMap>({});

export const activeTool = writable<AnnotationTool>("ink");
export const activeColor = writable<StrokeColor>("orange");
export const activeThickness = writable<StrokeThickness>("medium");

export const selectedStrokeIds = writable<Set<string>>(new Set());

export interface PendingStroke {
  strokeId: string;
  source: AnnotationSource;
  slide: number;
  tool: AnnotationTool;
  color: StrokeColor;
  thickness: StrokeThickness;
  points: Point[];
}
export const pendingStrokes = writable<Map<string, PendingStroke>>(new Map());
export const movePreviewStrokes = writable<Map<string, AnnotationStroke>>(
  new Map(),
);

// ── WebSocket connection state ───────────────────────────────────────────────

export type WsState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting";

export const wsState = writable<WsState>("disconnected");

/**
 * Current reconnect attempt number, 1-based. 0 means not reconnecting.
 * Updated by ws-client during the backoff loop so the UI can show
 * "Attempt N of MAX_RECONNECT_ATTEMPTS".
 */
export const wsReconnectAttempt = writable<number>(0);

// Clear selection whenever the slide changes (PDF or whiteboard)
currentSlide.subscribe(() => {
  selectedStrokeIds.set(new Set());
});
whiteboardSlide.subscribe(() => {
  selectedStrokeIds.set(new Set());
});

export function applyState(state: AppState): void {
  activePdfPath.set(state.activePdfPath);
  activePdfName.set(state.activePdfName);
  pageCount.set(state.pageCount);
  currentSlide.set(state.currentSlide);
  annotations.set(state.annotations);
  whiteboardMode.set(state.whiteboardMode);
  whiteboardSlide.set(state.whiteboardSlide);
  whiteboardPageCount.set(state.whiteboardPageCount);
  whiteboardAnnotations.set(state.whiteboardAnnotations);
  selectedStrokeIds.set(new Set());
  pendingStrokes.set(new Map());
}

// ── Centralised logout ───────────────────────────────────────────────────────
//
// Imported by ws-client, FileBrowser, PdfViewer and Toolbar.
// Keeping it here (rather than App.svelte) avoids circular imports because
// ws-client is imported by App.svelte but needs to trigger logout itself.
//
// disconnect() is injected at startup by ws-client to avoid a circular
// module dependency (ws-client imports stores, stores must not import ws-client).

let _disconnect: (() => void) | null = null;

export function registerDisconnect(fn: () => void): void {
  _disconnect = fn;
}

/**
 * Tear down the current session.
 *
 * @param clearToken  When true the auth token is also wiped, landing the user
 *                    on the PIN screen. When false only the role is cleared,
 *                    landing the user on the role-selection screen.
 */
export function logout(clearToken: boolean): void {
  _disconnect?.();

  deviceRole.set(null);
  sessionStorage.removeItem("deviceRole");

  if (clearToken) {
    authToken.set("");
    sessionStorage.removeItem("authToken");
  }

  // Reset PDF state so no stale document bleeds onto the login screens.
  activePdfPath.set(null);
  activePdfName.set(null);
  pageCount.set(0);
  currentSlide.set(0);
  annotations.set({});
  whiteboardMode.set(false);
  whiteboardSlide.set(0);
  whiteboardPageCount.set(1);
  whiteboardAnnotations.set({});
  selectedStrokeIds.set(new Set());
  pendingStrokes.set(new Map());
  movePreviewStrokes.set(new Map());

  wsState.set("disconnected");
  wsReconnectAttempt.set(0);
}
