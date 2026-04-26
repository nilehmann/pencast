import {
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
  type HtmlState,
  type ScreenState,
} from "@pencast/shared/types";
import type { PDFDocumentProxy } from "pdfjs-dist";

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
  page: number;
  tool: AnnotationTool;
  color: StrokeColor;
  thickness: StrokeThickness;
  points: NormalizedPoint[];
}

// ── Reactive store class ──────────────────────────────────────────────────────

class Stores {
  deviceRole = $state<DeviceRole | null>(
    (sessionStorage.getItem("deviceRole") as DeviceRole | null) ?? null,
  );
  activePdf = $state<PdfState | null>(null);
  pdfDoc = $state<PDFDocumentProxy | null>(null);

  // ── Active mode ─────────────────────────────────────────────────────────────
  activeMode = $state<ActiveMode>({ base: "pdf", whiteboard: false });

  // ── Whiteboard state ────────────────────────────────────────────────────────
  whiteboard = $state<WhiteboardState>(emptyWhiteboard());

  // ── HTML mode state ─────────────────────────────────────────────────────────
  activeHtml = $state<HtmlState | null>(null);

  // ── Screen mode state ────────────────────────────────────────────────────────
  activeScreen = $state<ScreenState | null>(null);
  activeTool = $state<AnnotationTool>("ink");
  previousTool = $state<AnnotationTool | null>(null);
  activeColor = $state<StrokeColor>("blue");
  activeThickness = $state<StrokeThickness>("thin");

  selectedStrokeIds = $state<Set<string>>(new Set());
  clipboard = $state<AnnotationStroke[]>([]);

  pendingStrokes = $state<Map<string, PendingStroke>>(new Map());
  movePreviewStrokes = $state<Map<string, AnnotationStroke>>(new Map());
  movePreviewHiddenIds = $state<Set<string>>(new Set());

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
        void this.activePdf?.position.slide;
        void this.activePdf?.position.page;
        this.selectedStrokeIds = new Set();
      });
      $effect(() => {
        void this.whiteboard.slide;
        this.selectedStrokeIds = new Set();
      });
      $effect(() => {
        void this.activeHtml?.slide;
        this.selectedStrokeIds = new Set();
      });
      $effect(() => {
        void this.activeScreen?.slide;
        this.selectedStrokeIds = new Set();
      });
      $effect(() => {
        const tool = this.activeTool;
        if (tool !== "select") {
          this.selectedStrokeIds = new Set();
        }
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
    this.activeHtml = state.activeHtml;
    this.activeScreen = state.activeScreen ?? null;
    this.selectedStrokeIds = new Set();
    this.pendingStrokes = new Map();
  }

  clearPdf() {
    if (this.activePdf) {
      this.activePdf.annotations = {};
      this.activePdf.subPageCounts = {};
      this.activePdf.position = { slide: 0, page: 0 };
    }
  }

  clearWhiteboard() {
    this.whiteboard = emptyWhiteboard();
  }

  clearHtml() {
    if (this.activeHtml) {
      this.activeHtml.annotations = {};
      this.activeHtml.pageCount = 1;
      this.activeHtml.slide = 0;
    }
  }

  clearScreen() {
    if (this.activeScreen) {
      this.activeScreen.annotations = {};
      this.activeScreen.pageCount = 1;
      this.activeScreen.slide = 0;
    }
  }

  /**
   * Return the active source (PDF, whiteboard, or HTML).
   */
  activeSource(): AnnotationSource {
    const m = stores.activeMode;
    if (m.whiteboard) return "whiteboard";
    if (m.base === "screen") return "screen";
    return m.base;
  }

  /**
   * Return all strokes for the active mode (PDF, whiteboard, or HTML).
   */
  activeStrokes(): AnnotationStroke[] {
    return this.activeContext().strokes;
  }

  activeSelectedStrokes(): AnnotationStroke[] {
    const ids = this.selectedStrokeIds;
    return this.activeStrokes().filter((s) => ids.has(s.id));
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
    } else if (this.activeMode.base === "screen") {
      return this.activeScreen?.pageCount ?? 1;
    } else if (this.activeMode.base === "html") {
      return this.activeHtml?.pageCount || 0;
    } else {
      return this.activePdf?.pageCount || 0;
    }
  }

  activeSubPage(): number {
    return this.activePdf?.position.page ?? 0;
  }

  activeSubPageCount(): number {
    const pdf = this.activePdf;
    if (!pdf) return 1;
    return pdf.subPageCounts[pdf.position.slide] ?? 1;
  }

  activeContext() {
    const m = this.activeMode;
    if (m.whiteboard) {
      const whiteboard = this.whiteboard;
      return {
        source: "whiteboard" as const,
        slide: whiteboard.slide,
        page: 0,
        get strokes(): AnnotationStroke[] {
          whiteboard.annotations[whiteboard.slide] ??= [];
          return whiteboard.annotations[whiteboard.slide];
        },
        set strokes(ann: AnnotationStroke[]) {
          whiteboard.annotations[whiteboard.slide] = ann;
        },
      };
    }
    if (m.base === "screen") {
      const screen = this.activeScreen;
      return {
        source: "screen" as const,
        slide: screen?.slide ?? 0,
        page: 0,
        get strokes(): AnnotationStroke[] {
          if (!screen) return [];
          screen.annotations[screen.slide] ??= [];
          return screen.annotations[screen.slide];
        },
        set strokes(ann: AnnotationStroke[]) {
          if (screen) screen.annotations[screen.slide] = ann;
        },
      };
    }
    if (m.base === "html") {
      const activeHtml = this.activeHtml;
      return {
        source: "html" as const,
        slide: activeHtml?.slide || 0,
        page: 0,
        get strokes(): AnnotationStroke[] {
          if (!activeHtml) return [];
          activeHtml.annotations[this.slide] ??= [];
          return activeHtml.annotations[this.slide];
        },
        set strokes(ann: AnnotationStroke[]) {
          if (activeHtml) activeHtml.annotations[this.slide] = ann;
        },
      };
    }
    const activePdf = this.activePdf;
    const pdfSlide = activePdf?.position.slide ?? 0;
    const pdfPage = activePdf?.position.page ?? 0;
    return {
      source: "pdf" as const,
      slide: pdfSlide,
      page: pdfPage,
      get strokes(): AnnotationStroke[] {
        if (!activePdf) return [];
        activePdf.annotations[pdfSlide] ??= [[]];
        activePdf.annotations[pdfSlide][pdfPage] ??= [];
        return activePdf.annotations[pdfSlide][pdfPage];
      },
      set strokes(ann: AnnotationStroke[]) {
        if (!activePdf) return;
        activePdf.annotations[pdfSlide] ??= [[]];
        activePdf.annotations[pdfSlide][pdfPage] = ann;
      },
    };
  }

  patchAnnotations(
    source: AnnotationSource,
    slide: number,
    fn: (strokes: AnnotationStroke[]) => AnnotationStroke[],
    page = 0,
  ): void {
    if (source === "whiteboard") {
      this.whiteboard.annotations[slide] = fn(
        this.whiteboard.annotations[slide] ?? [],
      );
    } else if (source === "screen") {
      if (!this.activeScreen) return;
      this.activeScreen.annotations[slide] = fn(
        this.activeScreen.annotations[slide] ?? [],
      );
    } else if (source === "html") {
      if (!this.activeHtml) return;
      this.activeHtml.annotations[slide] = fn(
        this.activeHtml.annotations[slide] ?? [],
      );
    } else {
      if (!this.activePdf) return;
      this.activePdf.annotations[slide] ??= [[]];
      this.activePdf.annotations[slide][page] ??= [];
      this.activePdf.annotations[slide][page] = fn(
        this.activePdf.annotations[slide][page],
      );
    }
  }

  // ── Centralised logout ──────────────────────────────────────────────────────
  //
  // Imported by ws-client, FileBrowser, PdfViewer and Toolbar.
  // Keeping it here (rather than App.svelte) avoids circular imports because
  // ws-client is imported by App.svelte but needs to trigger logout itself.

  logout(): void {
    this.#disconnect?.();

    this.deviceRole = null;
    sessionStorage.removeItem("deviceRole");

    // Reset PDF state so no stale document bleeds onto the login screens.
    this.activePdf = null;
    this.pdfDoc = null;
    this.activeMode = { base: "pdf", whiteboard: false };
    this.whiteboard = emptyWhiteboard();
    this.activeHtml = null;
    this.activeScreen = null;
    this.selectedStrokeIds = new Set();
    this.pendingStrokes = new Map();
    this.movePreviewStrokes = new Map();
    this.movePreviewHiddenIds = new Set();

    this.wsState = "disconnected";
    this.wsReconnectAttempt = 0;
  }
}

export const stores = new Stores();
