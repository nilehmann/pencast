export type DeviceRole = "viewer" | "presenter";

export type ClientAsset = { data: Uint8Array; contentType: string };

export type AnnotationTool =
  | "ink"
  | "highlighter"
  | "arrow"
  | "box"
  | "ellipse"
  | "perfect-circle"
  | "eraser"
  | "select"
  | "pointer";

export type StrokeColor =
  | "orange"
  | "red"
  | "green"
  | "yellow"
  | "black"
  | "gray";

export type StrokeThickness = "thin" | "medium" | "thick";

export interface Point {
  x: number; // normalized 0–1 relative to page width
  y: number; // normalized 0–1 relative to page height
  pressure?: number; // pointer pressure 0–1 (for perfect-freehand)
}

export interface AnnotationStroke {
  id: string;
  tool: AnnotationTool;
  color: StrokeColor;
  thickness: StrokeThickness;
  points: Point[];
  /** Rotation in radians, used only by the "ellipse" tool. */
  rotation?: number;
}

export type AnnotationMap = Record<number, AnnotationStroke[]>;

export type AnnotationSource = "pdf" | "whiteboard";

export interface AnnotationsFile {
  /** PDF slide annotations, keyed by 0-based slide index. */
  annotations: AnnotationMap;
  /** Whiteboard page annotations, keyed by 0-based whiteboard page index. */
  whiteboardAnnotations: AnnotationMap;
  /** Number of whiteboard pages (always >= 1). */
  whiteboardPageCount: number;
}

export interface AppState {
  activePdfPath: string | null;
  activePdfName: string | null;
  pageCount: number;
  currentSlide: number;
  annotations: AnnotationMap;
  /** Whether whiteboard mode is currently active. */
  whiteboardMode: boolean;
  /** Current whiteboard page (0-based). */
  whiteboardSlide: number;
  /** Total number of whiteboard pages. */
  whiteboardPageCount: number;
  /** Whiteboard annotations keyed by 0-based whiteboard page index. */
  whiteboardAnnotations: AnnotationMap;
  activePendingStroke?: {
    strokeId: string;
    source: AnnotationSource;
    slide: number;
    tool: AnnotationTool;
    color: StrokeColor;
    thickness: StrokeThickness;
    points: Point[];
  } | null;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  type: "file" | "folder" | "annotations";
}

type RelayMessage =
  | {
      type: "stroke_begin";
      source: AnnotationSource;
      slide: number;
      strokeId: string;
      tool: AnnotationTool;
      color: StrokeColor;
      thickness: StrokeThickness;
    }
  | {
      type: "stroke_point";
      source: AnnotationSource;
      strokeId: string;
      points: Point[];
    }
  | { type: "stroke_abandon"; source: AnnotationSource; strokeId: string }
  | {
      type: "strokes_added";
      source: AnnotationSource;
      slide: number;
      strokes: AnnotationStroke[];
    }
  | {
      type: "strokes_removed";
      source: AnnotationSource;
      slide: number;
      strokeIds: string[];
    }
  | {
      type: "strokes_updated";
      source: AnnotationSource;
      slide: number;
      strokes: AnnotationStroke[];
    }
  | {
      type: "strokes_move_preview";
      source: AnnotationSource;
      slide: number;
      strokes: AnnotationStroke[];
    };

// Client → Server messages
export type ClientMessage =
  | RelayMessage
  | { type: "slide_change"; source: AnnotationSource; slide: number }
  | { type: "undo"; source: AnnotationSource; slide: number }
  | { type: "clear_slide"; source: AnnotationSource; slide: number }
  | { type: "clear_all"; source: AnnotationSource }
  | { type: "load_pdf"; path: string }
  | { type: "logging"; message: string }
  | { type: "set_whiteboard_mode"; enabled: boolean }
  | { type: "whiteboard_add_page" };

// Server → Client messages
export type ServerMessage =
  | RelayMessage
  | { type: "state_sync"; state: AppState }
  | { type: "slide_changed"; source: AnnotationSource; slide: number }
  | {
      type: "strokes_reinserted";
      source: AnnotationSource;
      slide: number;
      strokes: AnnotationStroke[];
      indices: number[];
    }
  | {
      type: "stroke_undone";
      source: AnnotationSource;
      slide: number;
      strokeId: string;
    }
  | { type: "slide_cleared"; source: AnnotationSource; slide: number }
  | { type: "all_cleared"; source: AnnotationSource }
  | {
      type: "pdf_loaded";
      path: string;
      name: string;
      pageCount: number;
      annotations: AnnotationMap;
      whiteboardAnnotations: AnnotationMap;
      whiteboardPageCount: number;
    }
  | {
      type: "whiteboard_mode_changed";
      enabled: boolean;
      slideToRestore: number;
    }
  | { type: "whiteboard_page_added"; pageCount: number; slide: number }
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
