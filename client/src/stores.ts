import { writable } from "svelte/store";
import type {
  AnnotationMap,
  AnnotationSource,
  AnnotationStroke,
  AnnotationTool,
  ActiveMode,
  DeviceRole,
  StrokeColor,
  StrokeThickness,
  NormalizedPoint,
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
export const annotations = writable<AnnotationMap>([]);

// ── Active mode ───────────────────────────────────────────────────────────────
export const activeMode = writable<ActiveMode>({
  base: "pdf",
  whiteboard: false,
});

// ── Whiteboard state ─────────────────────────────────────────────────────────
export const whiteboardSlide = writable<number>(0);
export const whiteboardAnnotations = writable<AnnotationMap>([]);

// ── HTML mode state ──────────────────────────────────────────────────────────
export const htmlPath = writable<string | null>(null);
export const htmlAnnotations = writable<AnnotationMap>([]);
export const htmlSlide = writable<number>(0);
export const htmlPageCount = writable<number>(1);
export interface HtmlDomData {
  html: string;
  viewerWidth: number;
  viewerHeight: number;
  scrollX: number;
  scrollY: number;
}
export const latestHtmlDom = writable<HtmlDomData | null>(null);

export const activeTool = writable<AnnotationTool>("ink");
export const previousTool = writable<AnnotationTool | null>(null);
export const activeColor = writable<StrokeColor>("blue");
export const activeThickness = writable<StrokeThickness>("thin");

export const selectedStrokeIds = writable<Set<string>>(new Set());
export const clipboard = writable<AnnotationStroke[]>([]);

export interface PendingStroke {
  strokeId: string;
  source: AnnotationSource;
  slide: number;
  tool: AnnotationTool;
  color: StrokeColor;
  thickness: StrokeThickness;
  points: NormalizedPoint[];
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

// Clear selection whenever the slide changes (PDF, whiteboard, or HTML)
currentSlide.subscribe(() => {
  selectedStrokeIds.set(new Set());
});
whiteboardSlide.subscribe(() => {
  selectedStrokeIds.set(new Set());
});
htmlSlide.subscribe(() => {
  selectedStrokeIds.set(new Set());
});

export function applyState(state: AppState): void {
  activePdfPath.set(state.activePdf?.path || null);
  activePdfName.set(state.activePdf?.name || null);
  pageCount.set(state.activePdf?.pageCount || 0);
  currentSlide.set(state.activePdf?.currentSlide || 0);
  annotations.set(state.activePdf?.annotations || []);
  activeMode.set(state.activeMode);
  whiteboardSlide.set(state.whiteboard.slide);
  whiteboardAnnotations.set(state.whiteboard.annotations);
  htmlPath.set(state.htmlPath);
  htmlAnnotations.set(state.htmlAnnotations);
  htmlSlide.set(state.htmlSlide);
  htmlPageCount.set(state.htmlPageCount);
  latestHtmlDom.set(state.latestHtmlDom ?? null);
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
  annotations.set([]);
  activeMode.set({ base: "pdf", whiteboard: false });
  whiteboardSlide.set(0);
  whiteboardAnnotations.set([]);
  htmlPath.set(null);
  htmlAnnotations.set([]);
  htmlSlide.set(0);
  htmlPageCount.set(1);
  latestHtmlDom.set(null);
  selectedStrokeIds.set(new Set());
  pendingStrokes.set(new Map());
  movePreviewStrokes.set(new Map());

  wsState.set("disconnected");
  wsReconnectAttempt.set(0);
}
