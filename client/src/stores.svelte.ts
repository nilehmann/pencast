import {
  type AnnotationMap,
  type AnnotationSource,
  type AnnotationStroke,
  type AnnotationTool,
  type ActiveMode,
  type DeviceRole,
  type StrokeColor,
  type StrokeThickness,
  type NormalizedPoint,
  type AppState,
  type WhiteboardState,
  emptyWhiteboard,
  type PdfState,
} from "../../shared/types";

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
  activePdf = $state<PdfState | null>(null);

  // ── Active mode ─────────────────────────────────────────────────────────────
  activeMode = $state<ActiveMode>({ base: "pdf", whiteboard: false });

  // ── Whiteboard state ────────────────────────────────────────────────────────
  whiteboard = $state<WhiteboardState>(emptyWhiteboard());

  // ── HTML mode state ─────────────────────────────────────────────────────────
  htmlPath = $state<string | null>(null);
  htmlAnnotations = $state<AnnotationMap>({});
  htmlSlide = $state<number>(0);
  htmlPageCount = $state<number>(1);
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
        void this.activePdf?.currentSlide;
        this.selectedStrokeIds = new Set();
      });
      $effect(() => {
        void this.whiteboard.slide;
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
    this.activePdf = state.activePdf;
    this.activeMode = state.activeMode;
    this.whiteboard = state.whiteboard;
    this.htmlPath = state.activeHtml?.path || null;
    this.htmlAnnotations = state.activeHtml?.annotations || {};
    this.htmlSlide = state.activeHtml?.slide || 0;
    this.htmlPageCount = state.activeHtml?.pageCount ?? 1;
    this.latestHtmlDom = state.activeHtml?.latestDom ?? null;
    this.selectedStrokeIds = new Set();
    this.pendingStrokes = new Map();
  }

  /**
   * Return the active source (PDF, whiteboard, or HTML).
   */
  activeSource(): AnnotationSource {
    return stores.activeMode.whiteboard ? "whiteboard" : stores.activeMode.base;
  }

  /**
   * Return all strokes for the active mode (PDF, whiteboard, or HTML).
   */
  activeStrokes(): AnnotationStroke[] {
    if (this.activeMode.whiteboard) {
      return this.whiteboard.annotations[this.whiteboard.slide] ?? [];
    } else if (this.activeMode.base === "html") {
      return this.htmlAnnotations[this.htmlSlide] ?? [];
    } else {
      const activePdf = this.activePdf;
      if (activePdf) {
        return activePdf.annotations[activePdf.currentSlide] ?? [];
      } else {
        return [];
      }
    }
  }

  /**
   * Return the active slide number for the current mode (PDF, whiteboard, or HTML).
   */
  activeSlide(): number {
    return this.activeContext().slide;
  }

  activePageCount(): number {
    if (this.activeMode.whiteboard) {
      return stores.whiteboard.pageCount;
    } else if (this.activeMode.base === "html") {
      return this.htmlPageCount;
    } else {
      return this.activePdf?.pageCount || 0;
    }
  }

  activeContext() {
    const stores = this;
    const m = this.activeMode;
    if (m.whiteboard) {
      return {
        source: "whiteboard" as const,
        slide: stores.whiteboard.slide,
        get annotations(): AnnotationMap {
          return stores.whiteboard.annotations;
        },
        setAnnotations(ann: AnnotationMap) {
          stores.whiteboard.annotations = ann;
        },
      };
    }
    if (m.base === "html") {
      return {
        source: "html" as const,
        slide: stores.htmlSlide,
        get annotations(): AnnotationMap {
          return stores.htmlAnnotations;
        },
        setAnnotations(ann: AnnotationMap) {
          stores.htmlAnnotations = ann;
        },
      };
    }
    const activePdf = this.activePdf;
    return {
      source: "pdf" as const,
      slide: activePdf?.currentSlide || 0,
      get annotations(): AnnotationMap {
        return activePdf?.annotations ?? {};
      },
      setAnnotations(ann: AnnotationMap) {
        if (activePdf) activePdf.annotations = ann;
      },
    };
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
    this.activePdf = null;
    this.activeMode = { base: "pdf", whiteboard: false };
    this.whiteboard = emptyWhiteboard();
    this.htmlPath = null;
    this.htmlAnnotations = {};
    this.htmlSlide = 0;
    this.htmlPageCount = 1;
    this.latestHtmlDom = null;
    this.selectedStrokeIds = new Set();
    this.pendingStrokes = new Map();
    this.movePreviewStrokes = new Map();

    this.wsState = "disconnected";
    this.wsReconnectAttempt = 0;
  }
}

export const stores = new Stores();
