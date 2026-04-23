export type DeviceRole = "viewer" | "presenter";

export type ClientAsset = { data: Uint8Array; contentType: string };

export type AnnotationTool =
  | "ink"
  | "highlighter"
  | "arrow"
  | "line"
  | "box"
  | "ellipse"
  | "perfect-circle"
  | "eraser"
  | "select"
  | "pointer";

export type StrokeColor =
  | "blue"
  | "orange"
  | "red"
  | "green"
  | "yellow"
  | "black"
  | "gray";

export type StrokeThickness = "thin" | "medium" | "thick";

export interface NormalizedPoint {
  normX: number; // normalized 0–1 relative to page width
  normY: number; // normalized 0–1 relative to page height
  pressure?: number; // pointer pressure 0–1 (for perfect-freehand)
}

export interface CanvasPoint {
  x: number; // canvas pixel x
  y: number; // canvas pixel y
}

export interface AnnotationStroke {
  id: string;
  tool: AnnotationTool;
  color: StrokeColor;
  thickness: StrokeThickness;
  points: NormalizedPoint[];
  /** Rotation in radians, used only by the "ellipse" tool. */
  rotation?: number;
}

export type AnnotationMap = Record<number, AnnotationStroke[]>;

export type SlidePosition = { slide: number; page: number };

export type PdfAnnotationMap = Record<number, AnnotationStroke[][]>;

export type AnnotationSource = "pdf" | "whiteboard" | "html" | "screen";

export type BaseMode = "pdf" | "html" | "screen";
export type ActiveMode = { base: BaseMode; whiteboard: boolean; whiteBackground?: boolean };

export interface AnnotationsFile {
  /** PDF slide annotations, keyed by 0-based slide index. Each slide has an array of sub-page stroke arrays. */
  annotations: PdfAnnotationMap;
  /** Whiteboard page annotations, keyed by 0-based whiteboard page index. */
  whiteboardAnnotations: AnnotationMap;
  /** Number of sub-pages per slide (default 1). */
  subPageCounts: Record<number, number>;
}

export interface HtmlAnnotationsFile {
  /** HTML slide annotations, keyed by 0-based slide index. */
  annotations: AnnotationMap;
}

export interface PdfState {
  path: string;
  name: string;
  pageCount: number;
  position: SlidePosition;
  annotations: PdfAnnotationMap;
  subPageCounts: Record<number, number>;
}

export interface WhiteboardState {
  /** Current whiteboard page (0-based). */
  slide: number;
  /** Total number of whiteboard pages. */
  pageCount: number;
  /** Whiteboard annotations keyed by 0-based whiteboard page index. */
  annotations: AnnotationMap;
}

export interface HtmlState {
  /** Root-relative path of the loaded HTML file, or null. */
  path: string;
  /** HTML mode annotations keyed by 0-based slide index. */
  annotations: AnnotationMap;
  /** Current HTML slide (0-based). */
  slide: number;
  /** Total number of HTML pages. */
  pageCount: number;
  /** Latest HTML DOM snapshot from the viewer, or null if none received yet. */
  latestDom: {
    html: string;
    viewerWidth: number;
    viewerHeight: number;
    scrollX: number;
    scrollY: number;
  } | null;
}

export interface ScreenState {
  /** Current screen annotation layer (0-based). */
  slide: number;
  /** Total number of screen annotation layers. */
  pageCount: number;
  annotations: AnnotationMap;
  captureWidth?: number;
  captureHeight?: number;
}

export interface AppState {
  activePdf: PdfState | null;
  /** Current active mode. */
  activeMode: ActiveMode;
  whiteboard: WhiteboardState;
  activeHtml: HtmlState | null;
  activeScreen: ScreenState | null;
  activePendingStroke?: {
    strokeId: string;
    source: AnnotationSource;
    slide: number;
    page: number;
    tool: AnnotationTool;
    color: StrokeColor;
    thickness: StrokeThickness;
    points: NormalizedPoint[];
  } | null;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  type: "pdf" | "html" | "folder" | "annotations";
}

type RelayMessage =
  | {
      type: "stroke_begin";
      source: AnnotationSource;
      slide: number;
      page?: number;
      strokeId: string;
      tool: AnnotationTool;
      color: StrokeColor;
      thickness: StrokeThickness;
    }
  | {
      type: "stroke_point";
      source: AnnotationSource;
      strokeId: string;
      points: NormalizedPoint[];
    }
  | { type: "stroke_abandon"; source: AnnotationSource; strokeId: string }
  | {
      type: "strokes_added";
      source: AnnotationSource;
      slide: number;
      page?: number;
      strokes: AnnotationStroke[];
    }
  | {
      type: "strokes_removed";
      source: AnnotationSource;
      slide: number;
      page?: number;
      strokeIds: string[];
    }
  | {
      type: "strokes_updated";
      source: AnnotationSource;
      slide: number;
      page?: number;
      strokes: AnnotationStroke[];
    }
  | {
      type: "strokes_move_preview";
      source: AnnotationSource;
      slide: number;
      page?: number;
      strokes: AnnotationStroke[];
    }
  | {
      type: "move_preview_begin";
      source: AnnotationSource;
      slide: number;
      page?: number;
      strokeIds: string[];
    }
  | { type: "move_preview_cancel"; source: AnnotationSource; slide: number; page?: number };

// Client → Server messages
export type ClientMessage =
  | RelayMessage
  | { type: "slide_change"; source: AnnotationSource; slide: number; page?: number }
  | { type: "undo"; source: AnnotationSource; slide: number; page?: number }
  | { type: "clear_slide"; source: AnnotationSource; slide: number; page?: number }
  | { type: "clear_all"; source: AnnotationSource }
  | { type: "pdf_add_sub_page"; slide: number }
  | { type: "load_pdf"; path: string }
  | { type: "load_html"; path: string }
  | { type: "set_mode"; mode: BaseMode }
  | { type: "set_whiteboard_mode"; enabled: boolean }
  | { type: "set_white_background"; enabled: boolean }
  | {
      type: "html_dom";
      html: string;
      viewerWidth: number;
      viewerHeight: number;
      scrollX: number;
      scrollY: number;
    }
  | { type: "logging"; message: string }
  | { type: "whiteboard_add_page" }
  | { type: "html_add_page" }
  | { type: "screen_add_page" }
  | { type: "screen_capture_info"; captureWidth: number; captureHeight: number }
  | { type: "webrtc_offer"; sdp: string }
  | { type: "webrtc_answer"; sdp: string }
  | { type: "webrtc_ice"; candidate: RTCIceCandidateInit };

// Server → Client messages
export type ServerMessage =
  | RelayMessage
  | { type: "state_sync"; state: AppState }
  | {
      type: "slide_changed";
      source: AnnotationSource;
      slide: number;
      page?: number;
      /** Only present when source === "screen"; carries the new slide's strokes. */
      strokes?: AnnotationStroke[];
    }
  | {
      type: "strokes_reinserted";
      source: AnnotationSource;
      slide: number;
      page?: number;
      strokes: AnnotationStroke[];
      indices: number[];
    }
  | {
      type: "stroke_undone";
      source: AnnotationSource;
      slide: number;
      page?: number;
      strokeId: string;
    }
  | { type: "slide_cleared"; source: AnnotationSource; slide: number; page?: number }
  | { type: "all_cleared"; source: AnnotationSource }
  | { type: "pdf_sub_page_added"; position: SlidePosition; subPageCount: number }
  | {
      type: "pdf_loaded";
      pdf: PdfState;
      whiteboard: WhiteboardState;
    }
  | {
      type: "mode_changed";
      activeMode: ActiveMode;
      activeHtml?: HtmlState;
      activeScreen?: ScreenState | null;
    }
  | { type: "webrtc_restart" }
  | { type: "webrtc_offer_relay"; sdp: string }
  | { type: "webrtc_answer_relay"; sdp: string }
  | { type: "webrtc_ice_relay"; candidate: RTCIceCandidateInit }
  | { type: "whiteboard_page_added"; pageCount: number; slide: number }
  | { type: "html_page_added"; pageCount: number; slide: number }
  | { type: "screen_page_added"; pageCount: number; slide: number }
  | {
      type: "html_dom_relay";
      html: string;
      viewerWidth: number;
      viewerHeight: number;
      scrollX: number;
      scrollY: number;
    }
  | { type: "error"; message: string };

export function getStrokeColor(tool: AnnotationTool, color: StrokeColor) {
  switch (tool) {
    case "highlighter":
      return "yellow";
    case "pointer":
      return "red";
    default:
      return color;
  }
}

export function emptyWhiteboard(): WhiteboardState {
  return { slide: 0, pageCount: 1, annotations: {} };
}
