export type DeviceRole = "presenter" | "annotator";

export type AnnotationTool =
  | "ink"
  | "highlighter"
  | "arrow"
  | "box"
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
}

export type AnnotationMap = Record<number, AnnotationStroke[]>;

export interface AppState {
  activePdfPath: string | null;
  activePdfName: string | null;
  pageCount: number;
  currentSlide: number;
  annotations: AnnotationMap;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  type: "file" | "folder" | "annotations";
}

// Client → Server messages
export type ClientMessage =
  | { type: "hello"; role: DeviceRole }
  | { type: "slide_change"; slide: number }
  | { type: "stroke_added"; slide: number; stroke: AnnotationStroke }
  | { type: "stroke_removed"; slide: number; strokeId: string }
  | { type: "stroke_updated"; slide: number; stroke: AnnotationStroke }
  | { type: "strokes_updated"; slide: number; strokes: AnnotationStroke[] }
  | { type: "undo"; slide: number }
  | { type: "clear_slide"; slide: number }
  | { type: "clear_all" }
  | { type: "load_pdf"; path: string }
  | { type: "logging"; message: string };

// Server → Client messages
export type ServerMessage =
  | { type: "state_sync"; state: AppState }
  | { type: "slide_changed"; slide: number }
  | { type: "stroke_added"; slide: number; stroke: AnnotationStroke }
  | { type: "stroke_removed"; slide: number; strokeId: string }
  | { type: "stroke_undone"; slide: number; strokeId: string }
  | { type: "stroke_updated"; slide: number; stroke: AnnotationStroke }
  | { type: "strokes_updated"; slide: number; strokes: AnnotationStroke[] }
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
