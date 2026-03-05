export type DeviceRole = "viewer" | "presenter";

export type ClientAsset = { data: Buffer; contentType: string };

export type AnnotationTool =
  | "ink"
  | "highlighter"
  | "arrow"
  | "box"
  | "ellipse"
  | "perfect-circle"
  | "eraser"
  | "select";

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

export interface AppState {
  activePdfPath: string | null;
  activePdfName: string | null;
  pageCount: number;
  currentSlide: number;
  annotations: AnnotationMap;
  activePendingStroke?: {
    strokeId: string;
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

// Client → Server messages
export type ClientMessage =
  | { type: "slide_change"; slide: number }
  | { type: "stroke_begin"; slide: number; strokeId: string; tool: AnnotationTool; color: StrokeColor; thickness: StrokeThickness }
  | { type: "stroke_point"; strokeId: string; points: Point[] }
  | { type: "stroke_abandon"; strokeId: string }
  | { type: "stroke_added"; slide: number; stroke: AnnotationStroke }
  | { type: "strokes_removed"; slide: number; strokeIds: string[] }
  | { type: "strokes_updated"; slide: number; strokes: AnnotationStroke[] }
  | { type: "strokes_move_preview"; strokes: AnnotationStroke[] }
  | { type: "undo"; slide: number }
  | { type: "clear_slide"; slide: number }
  | { type: "clear_all" }
  | { type: "load_pdf"; path: string }
  | { type: "logging"; message: string };

// Server → Client messages
export type ServerMessage =
  | { type: "state_sync"; state: AppState }
  | { type: "slide_changed"; slide: number }
  | { type: "stroke_begin"; slide: number; strokeId: string; tool: AnnotationTool; color: StrokeColor; thickness: StrokeThickness }
  | { type: "stroke_point"; strokeId: string; points: Point[] }
  | { type: "stroke_abandon"; strokeId: string }
  | { type: "stroke_added"; slide: number; stroke: AnnotationStroke }
  | { type: "strokes_removed"; slide: number; strokeIds: string[] }
  | {
      type: "strokes_reinserted";
      slide: number;
      strokes: AnnotationStroke[];
      indices: number[];
    }
  | { type: "stroke_undone"; slide: number; strokeId: string }
  | { type: "strokes_updated"; slide: number; strokes: AnnotationStroke[] }
  | { type: "strokes_move_preview"; strokes: AnnotationStroke[] }
  | { type: "slide_cleared"; slide: number }
  | { type: "all_cleared" }
  | {
      type: "pdf_loaded";
      path: string;
      name: string;
      pageCount: number;
      annotations: AnnotationMap;
    }
  | { type: "error"; message: string };
