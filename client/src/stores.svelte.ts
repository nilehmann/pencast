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

// ── Re-exported types ─────────────────────────────────────────────────────────

export type WsState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting";

export interface HtmlDomData {
  html: string;
  viewerWidth: number;
  viewerHeight: number;
  scrollX: number;
  scrollY: number;
}

export interface PendingStroke {
  strokeId: string;
  source: AnnotationSource;
  slide: number;
  tool: AnnotationTool;
  color: StrokeColor;
  thickness: StrokeThickness;
  points: NormalizedPoint[];
}

// ── Reactive store class ──────────────────────────────────────────────────────

class Stores {
  authToken = $state<string>(sessionStorage.getItem("authToken") ?? "");
  deviceRole = $state<DeviceRole | null>(
    (sessionStorage.getItem("deviceRole") as DeviceRole | null) ?? null,
  );
  activePdfPath = $state<string | null>(null);
  activePdfName = $state<string | null>(null);
  pageCount = $state<number>(0);
  currentSlide = $state<number>(0);
  annotations = $state<AnnotationMap>([]);

  // ── Active mode ─────────────────────────────────────────────────────────────
  activeMode = $state<ActiveMode>({ base: "pdf", whiteboard: false });

  // ── Whiteboard state ────────────────────────────────────────────────────────
  whiteboardSlide = $state<number>(0);
  whiteboardAnnotations = $state<AnnotationMap>([[]]);

  // ── HTML mode state ─────────────────────────────────────────────────────────
  htmlPath = $state<string | null>(null);
  htmlAnnotations = $state<AnnotationMap>([]);
  htmlSlide = $state<number>(0);
  latestHtmlDom = $state<HtmlDomData | null>(null);

  activeTool = $state<AnnotationTool>("ink");
  previousTool = $state<AnnotationTool | null>(null);
  activeColor = $state<StrokeColor>("blue");
  activeThickness = $state<StrokeThickness>("thin");

  selectedStrokeIds = $state<Set<string>>(new Set());
  clipboard = $state<AnnotationStroke[]>([]);

  pendingStrokes = $state<Map<string, PendingStroke>>(new Map());
  movePreviewStrokes = $state<Map<string, AnnotationStroke>>(new Map());

  // ── WebSocket connection state ──────────────────────────────────────────────
  wsState = $state<WsState>("disconnected");

  /**
   * Current reconnect attempt number, 1-based. 0 means not reconnecting.
   * Updated by ws-client during the backoff loop so the UI can show
   * "Attempt N of MAX_RECONNECT_ATTEMPTS".
   */
  wsReconnectAttempt = $state<number>(0);

  #disconnect: (() => void) | null = null;

  constructor() {
    // Clear selection whenever the slide changes (PDF, whiteboard, or HTML).
    // $effect.root() creates a standalone reactive root that persists for the
    // app lifetime (new Stores() runs at module scope, outside any component).
    $effect.root(() => {
      $effect(() => {
        void this.currentSlide;
        this.selectedStrokeIds = new Set();
      });
      $effect(() => {
        void this.whiteboardSlide;
        this.selectedStrokeIds = new Set();
      });
      $effect(() => {
        void this.htmlSlide;
        this.selectedStrokeIds = new Set();
      });
    });
  }

  // ── disconnect injection ────────────────────────────────────────────────────
  //
  // ws-client.ts cannot be imported here (circular), so it injects its
  // disconnect function once at module initialisation time.

  registerDisconnect(fn: () => void): void {
    this.#disconnect = fn;
  }

  // ── Apply full server state ─────────────────────────────────────────────────

  applyState(state: AppState): void {
    this.activePdfPath = state.activePdf?.path || null;
    this.activePdfName = state.activePdf?.name || null;
    this.pageCount = state.activePdf?.pageCount || 0;
    this.currentSlide = state.activePdf?.currentSlide || 0;
    this.annotations = state.activePdf?.annotations || [];
    this.activeMode = state.activeMode;
    this.whiteboardSlide = state.whiteboard.slide;
    this.whiteboardAnnotations = state.whiteboard.annotations;
    this.htmlPath = state.activeHtml?.path || null;
    this.htmlAnnotations = state.activeHtml?.annotations || [];
    this.htmlSlide = state.activeHtml?.slide || 0;
    this.latestHtmlDom = state.activeHtml?.latestDom ?? null;
    this.selectedStrokeIds = new Set();
    this.pendingStrokes = new Map();
  }

  // ── Centralised logout ──────────────────────────────────────────────────────
  //
  // Imported by ws-client, FileBrowser, PdfViewer and Toolbar.
  // Keeping it here (rather than App.svelte) avoids circular imports because
  // ws-client is imported by App.svelte but needs to trigger logout itself.

  /**
   * Tear down the current session.
   *
   * @param clearToken  When true the auth token is also wiped, landing the user
   *                    on the PIN screen. When false only the role is cleared,
   *                    landing the user on the role-selection screen.
   */
  logout(clearToken: boolean): void {
    this.#disconnect?.();

    this.deviceRole = null;
    sessionStorage.removeItem("deviceRole");

    if (clearToken) {
      this.authToken = "";
      sessionStorage.removeItem("authToken");
    }

    // Reset PDF state so no stale document bleeds onto the login screens.
    this.activePdfPath = null;
    this.activePdfName = null;
    this.pageCount = 0;
    this.currentSlide = 0;
    this.annotations = [];
    this.activeMode = { base: "pdf", whiteboard: false };
    this.whiteboardSlide = 0;
    this.whiteboardAnnotations = [[]];
    this.htmlPath = null;
    this.htmlAnnotations = [[]];
    this.htmlSlide = 0;
    this.latestHtmlDom = null;
    this.selectedStrokeIds = new Set();
    this.pendingStrokes = new Map();
    this.movePreviewStrokes = new Map();

    this.wsState = "disconnected";
    this.wsReconnectAttempt = 0;
  }
}

export const stores = new Stores();
