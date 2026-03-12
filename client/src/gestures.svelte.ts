import { get } from "svelte/store";
import {
  annotations,
  currentSlide,
  pageCount,
  activeTool,
  activeColor,
  activeThickness,
  selectedStrokeIds,
  deviceRole,
  activeMode,
  whiteboardSlide,
  whiteboardPageCount,
  whiteboardAnnotations,
  htmlAnnotations,
  htmlSlide,
  previousTool,
  clipboard,
} from "./stores";
import { send } from "./ws-client";
import { thicknessPx } from "./draw";
import { v4 as uuidv4 } from "uuid";
import {
  getStrokeColor,
  type AnnotationSource,
  type AnnotationStroke,
  type AnnotationTool,
  type NormalizedPoint,
} from "../../shared/types";
import {
  hitTestShape,
  hitTestHandles,
  hitTestBBoxHandles,
  lassoIntersectsShape,
  computeBoundingBox,
  bboxCorners,
  applyTranslate,
  applyScaleToGroup,
  applySingleResize,
  applyCircleRotation,
  applyCircleUniformScale,
  applyBoxUniformScale,
  newBBoxFromCornerDrag,
  computeRotationAngle,
  ellipseParams,
  lastPoint,
  distToSegSq,
  type BoundingBox,
  CIRCLE_HANDLE_CENTER,
  CIRCLE_HANDLE_ROTATE,
  BOX_HANDLE_CENTER,
  BOX_HANDLE_ROTATE,
  middlePoint,
} from "./geometry";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function activeSource(): AnnotationSource {
  const m = get(activeMode);
  return m.whiteboard ? "whiteboard" : m.base;
}

export function activeContext() {
  const m = get(activeMode);
  if (m.whiteboard) {
    return {
      source: "whiteboard" as const,
      slide: get(whiteboardSlide),
      annotationsStore: whiteboardAnnotations,
    };
  }
  if (m.base === "html") {
    return {
      source: "html" as const,
      slide: get(htmlSlide),
      annotationsStore: htmlAnnotations,
    };
  }
  return {
    source: "pdf" as const,
    slide: get(currentSlide),
    annotationsStore: annotations,
  };
}

export function activeSelectedStrokes() {
  const ids = get(selectedStrokeIds);
  const { slide, annotationsStore: activeAnnotations } = activeContext();
  return (get(activeAnnotations)[slide] ?? []).filter((s) => ids.has(s.id));
}

export function isShapeTool(tool: string): boolean {
  return (
    tool === "arrow" ||
    tool === "line" ||
    tool === "box" ||
    tool === "ellipse" ||
    tool === "perfect-circle"
  );
}

export function isSelectableTool(tool: string): boolean {
  return (
    tool === "arrow" ||
    tool === "line" ||
    tool === "box" ||
    tool === "ellipse" ||
    tool === "ink" ||
    tool === "highlighter"
  );
}

class GestureHandler {
  protected readonly canvas: () => HTMLCanvasElement;

  constructor(canvas: () => HTMLCanvasElement) {
    this.canvas = canvas;
  }

  protected toNorm(e: PointerEvent): NormalizedPoint {
    const canvas = this.canvas();
    const rect = canvas.getBoundingClientRect();
    return {
      normX: (e.clientX - rect.left) / rect.width,
      normY: (e.clientY - rect.top) / rect.height,
      pressure: e.pressure || 0.5,
    };
  }
}

// ---------------------------------------------------------------------------
// Draw / Erase gesture
// ---------------------------------------------------------------------------

const ERASER_RADIUS_NORM = 0.015;

export class DrawGesture extends GestureHandler {
  // Exposed so redraw() can draw the in-progress stroke preview.
  // Not $state — redraw() is called imperatively, not reactively.
  currentPoints: NormalizedPoint[] = [];

  // Purely internal bookkeeping: never read outside this class.
  #perfectCircleCenter: NormalizedPoint | null = null;
  #erasedThisGesture = new Set<string>();
  #currentStrokeId: string | null = null;
  #sentPointCount = 0;

  constructor(canvas: () => HTMLCanvasElement) {
    super(canvas);
  }

  get currentStrokeId(): string | null {
    return this.#currentStrokeId;
  }

  onPointerDown(p: NormalizedPoint, tool: AnnotationTool): void {
    this.#erasedThisGesture = new Set();
    this.currentPoints = [p];
    if (tool === "perfect-circle") {
      this.#perfectCircleCenter = p;
    }
    if (tool !== "eraser" && tool !== "select") {
      this.#currentStrokeId = uuidv4();
      this.#sentPointCount = 0;
      const committedTool = tool === "perfect-circle" ? "ellipse" : tool;
      const color = getStrokeColor(tool, get(activeColor));
      const { source, slide } = activeContext();
      send({
        type: "stroke_begin",
        source,
        slide,
        strokeId: this.#currentStrokeId,
        tool: committedTool,
        color: color,
        thickness: get(activeThickness),
      });
    }
  }

  /** Returns true if the event was handled by the eraser (no preview needed). */
  onPointerMove(e: PointerEvent): boolean {
    const tool = get(activeTool);
    if (tool === "eraser") {
      this.#applyErase(this.toNorm(e));
      return true;
    }
    const coalesced = e.getCoalescedEvents?.() ?? [e];
    for (const ce of coalesced) {
      this.#applyMoveEvent(ce);
    }
    if (this.#currentStrokeId) {
      const isShape = isShapeTool(tool);
      const toSend = isShape
        ? this.currentPoints
        : this.currentPoints.slice(this.#sentPointCount);
      this.#sentPointCount = this.currentPoints.length;
      if (toSend.length > 0) {
        send({
          type: "stroke_point",
          source: activeSource(),
          strokeId: this.#currentStrokeId,
          points: toSend,
        });
      }
    }
    return false;
  }

  onPointerUp(): void {
    const tool = get(activeTool);
    const { source, slide } = activeContext();

    if (tool === "eraser") {
      if (this.#erasedThisGesture.size > 0) {
        send({
          type: "strokes_removed",
          source,
          slide,
          strokeIds: [...this.#erasedThisGesture],
        });
        this.#erasedThisGesture = new Set();
        const prev = get(previousTool);
        if (prev !== null) {
          activeTool.set(prev);
          previousTool.set(null);
        }
      }
      this.currentPoints = [];
      return;
    }

    if (this.currentPoints.length < 2 || tool === "pointer") {
      if (this.#currentStrokeId) {
        send({
          type: "stroke_abandon",
          source,
          strokeId: this.#currentStrokeId,
        });
      }
      this.currentPoints = [];
      this.#currentStrokeId = null;
      this.#sentPointCount = 0;
      return;
    }

    const committedTool = tool === "perfect-circle" ? "ellipse" : tool;
    const stroke: AnnotationStroke = {
      id: this.#currentStrokeId ?? uuidv4(),
      tool: committedTool,
      color: getStrokeColor(tool, get(activeColor)),
      thickness: get(activeThickness),
      points: isShapeTool(tool)
        ? [
            this.currentPoints[0],
            this.currentPoints[this.currentPoints.length - 1],
          ]
        : this.currentPoints,
    };

    send({ type: "strokes_added", source, slide, strokes: [stroke] });
    this.currentPoints = [];
    this.#perfectCircleCenter = null;
    this.#currentStrokeId = null;
    this.#sentPointCount = 0;
  }

  onPointerCancel(): void {
    if (this.#currentStrokeId) {
      send({
        type: "stroke_abandon",
        source: activeSource(),
        strokeId: this.#currentStrokeId,
      });
    }
    this.currentPoints = [];
    this.#currentStrokeId = null;
    this.#sentPointCount = 0;
    this.#perfectCircleCenter = null;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  #applyErase(p: NormalizedPoint): void {
    const { slide, annotationsStore: activeAnnotations } = activeContext();
    const strokes = get(activeAnnotations)[slide] ?? [];
    const toErase = strokes.filter(
      (s) => !this.#erasedThisGesture.has(s.id) && this.#hitTestEraser(s, p),
    );
    if (toErase.length === 0) return;

    for (const s of toErase) {
      this.#erasedThisGesture.add(s.id);
    }
    const erasedIds = new Set(toErase.map((s) => s.id));
    activeAnnotations.update((ann) => {
      const page = (ann[slide] ?? []).filter((s) => !erasedIds.has(s.id));
      return { ...ann, [slide]: page };
    });
  }

  #applyMoveEvent(e: PointerEvent): void {
    const tool = get(activeTool);
    if (tool === "perfect-circle") {
      const center = this.#perfectCircleCenter!;
      const current = this.toNorm(e);
      const rect = this.canvas().getBoundingClientRect();
      const dxPx = (current.normX - center.normX) * rect.width;
      const dyPx = (current.normY - center.normY) * rect.height;
      const rPx = Math.hypot(dxPx, dyPx);
      const rx = rPx / rect.width;
      const ry = rPx / rect.height;
      this.currentPoints = [
        { normX: center.normX - rx, normY: center.normY - ry },
        { normX: center.normX + rx, normY: center.normY + ry },
      ];
    } else if (isShapeTool(tool)) {
      this.currentPoints = [this.currentPoints[0], this.toNorm(e)];
    } else {
      this.currentPoints = [...this.currentPoints, this.toNorm(e)];
    }
  }

  #hitTestEraser(stroke: AnnotationStroke, p: NormalizedPoint): boolean {
    if (stroke.tool === "arrow") {
      if (hitTestShape(stroke, p, ERASER_RADIUS_NORM)) return true;
      const canvas = this.canvas();
      const b = lastPoint(stroke);
      const a = stroke.points[0];
      const headLenNorm =
        (16 + thicknessPx(stroke.thickness) * 2) / canvas.width;
      const angle = Math.atan2(b.normY - a.normY, b.normX - a.normX);
      const rSq = ERASER_RADIUS_NORM * ERASER_RADIUS_NORM;
      const w1x = b.normX - headLenNorm * Math.cos(angle - Math.PI / 6);
      const w1y = b.normY - headLenNorm * Math.sin(angle - Math.PI / 6);
      const w2x = b.normX - headLenNorm * Math.cos(angle + Math.PI / 6);
      const w2y = b.normY - headLenNorm * Math.sin(angle + Math.PI / 6);
      return (
        distToSegSq(p.normX, p.normY, b.normX, b.normY, w1x, w1y) < rSq ||
        distToSegSq(p.normX, p.normY, b.normX, b.normY, w2x, w2y) < rSq
      );
    }
    return hitTestShape(stroke, p, ERASER_RADIUS_NORM);
  }
}

// ---------------------------------------------------------------------------
// Swipe gesture  (finger-only, slide navigation)
// ---------------------------------------------------------------------------

const SWIPE_THRESHOLD_PX = 80;

export type SwipeDirection = "left" | "right" | null;

export class SwipeGesture {
  // Reactive state consumed by the overlay renderer in App.svelte
  direction = $state<SwipeDirection>(null);
  /** 0 → 1, where 1 means the threshold has been reached */
  progress = $state(0);
  /** true when swiping in a direction that has no more slides */
  atBoundary = $state(false);

  #pointerId: number | null = null;
  #startX = 0;
  #startY = 0;
  /** Swipe is only recognised once horizontal motion clearly dominates */
  #committed = false;

  onPointerDown(e: PointerEvent): void {
    if (e.pointerType !== "touch") return;
    if (this.#pointerId !== null) return;
    this.#pointerId = e.pointerId;
    this.#startX = e.clientX;
    this.#startY = e.clientY;
    this.#committed = false;
    this.direction = null;
    this.progress = 0;
    this.atBoundary = false;
  }

  onPointerMove(e: PointerEvent): void {
    if (e.pointerId !== this.#pointerId) return;
    const dx = e.clientX - this.#startX;
    const dy = e.clientY - this.#startY;

    // Commit to a horizontal swipe only once horizontal delta clearly exceeds
    // vertical — avoids triggering on diagonal or vertical gestures.
    if (!this.#committed) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dy) > Math.abs(dx)) {
        // Vertical dominant — abandon this swipe entirely.
        this.#pointerId = null;
        return;
      }
      this.#committed = true;
    }

    const dir: SwipeDirection = dx < 0 ? "left" : "right";
    this.direction = dir;
    this.progress = Math.min(Math.abs(dx) / SWIPE_THRESHOLD_PX, 1);
    this.atBoundary = this.#isAtBoundary(dir);
  }

  /**
   * Returns the direction if the swipe crossed the threshold and should
   * trigger a slide change, or null otherwise.  Always resets state.
   */
  onPointerUp(e: PointerEvent): SwipeDirection {
    if (e.pointerId !== this.#pointerId) return null;
    const triggered =
      this.#committed && this.progress >= 1 && !this.atBoundary
        ? this.direction
        : null;
    this.#reset();
    return triggered;
  }

  onPointerCancel(e: PointerEvent): void {
    if (e.pointerId !== this.#pointerId) return;
    this.#reset();
  }

  #reset(): void {
    this.#pointerId = null;
    this.#committed = false;
    this.direction = null;
    this.progress = 0;
    this.atBoundary = false;
  }

  #isAtBoundary(dir: SwipeDirection): boolean {
    const m = get(activeMode);
    const slide = m.whiteboard
      ? get(whiteboardSlide)
      : m.base === "html"
        ? get(htmlSlide)
        : get(currentSlide);
    const pages = m.whiteboard ? get(whiteboardPageCount) : get(pageCount);
    if (dir === "right") return slide <= 0;
    // HTML always allows next (creates new slide), so never at right boundary going left
    if (dir === "left")
      return !m.whiteboard && m.base !== "html" && slide >= pages - 1;
    return false;
  }
}

// ---------------------------------------------------------------------------
// Select gesture
// ---------------------------------------------------------------------------

type SelectPhase =
  | "idle"
  | "lasso"
  | "pending-move"
  | "moving"
  | "resizing"
  | "rotating"
  | "scaling";

const MOVE_THRESHOLD_PX = 12;

export class SelectGesture extends GestureHandler {
  // $state fields — read by redraw() so Svelte must track them.
  phase = $state<SelectPhase>("idle");
  lassoPoints = $state<NormalizedPoint[]>([]);
  moveGhosts = $state<AnnotationStroke[]>([]);
  resizeGhosts = $state<AnnotationStroke[]>([]);
  rotateGhost = $state<AnnotationStroke | null>(null);
  scaleGhost = $state<AnnotationStroke | null>(null);
  // Set when a tap-on-already-selected stroke is confirmed (pointer up, no drag).
  // AnnotationCanvas reacts to this to open the selection context menu.
  selectionMenuTrigger = $state<NormalizedPoint | null>(null);

  // Plain private fields — internal bookkeeping only, never read by redraw().
  #tapOnSelected = false;
  #moveStartPos: NormalizedPoint | null = null;
  #moveOriginals: AnnotationStroke[] = [];
  #resizeHandleIndex = -1;
  #resizeSingleStrokeId: string | null = null;
  #resizeOrigStrokes: AnnotationStroke[] = [];
  #resizeOrigBox: BoundingBox | null = null;
  #rotateOrigStroke: AnnotationStroke | null = null;
  #scaleOrigStroke: AnnotationStroke | null = null;
  #scaleStartP: NormalizedPoint | null = null;

  constructor(canvas: () => HTMLCanvasElement) {
    super(canvas);
  }

  // Expose read-only values that redraw() needs for drawing handles.
  get resizeHandleIndex(): number {
    return this.#resizeHandleIndex;
  }
  get resizeSingleStrokeId(): string | null {
    return this.#resizeSingleStrokeId;
  }

  onPointerDown(p: NormalizedPoint): void {
    const ids = get(selectedStrokeIds);
    const { slide: activeSlide, annotationsStore: activeAnnotations } =
      activeContext();
    const allStrokes = get(activeAnnotations)[activeSlide] ?? [];
    const selected = allStrokes.filter((s) => ids.has(s.id));
    const canvas = this.canvas();

    // ── 1. Check handles on the current selection ─────────────────────────

    if (selected.length === 1) {
      const stroke = selected[0];
      const hi = hitTestHandles(stroke, p, canvas.width, canvas.height);
      if (hi !== -1) {
        if (stroke.tool === "ellipse" && hi === CIRCLE_HANDLE_ROTATE) {
          this.phase = "rotating";
          this.#rotateOrigStroke = stroke;
          this.rotateGhost = stroke;
          return;
        }
        if (stroke.tool === "ellipse" && hi === CIRCLE_HANDLE_CENTER) {
          this.phase = "scaling";
          this.#scaleOrigStroke = stroke;
          this.#scaleStartP = p;
          this.scaleGhost = stroke;
          return;
        }
        if (stroke.tool === "box" && hi === BOX_HANDLE_ROTATE) {
          this.phase = "rotating";
          this.#rotateOrigStroke = stroke;
          this.rotateGhost = stroke;
          return;
        }
        if (stroke.tool === "box" && hi === BOX_HANDLE_CENTER) {
          this.phase = "scaling";
          this.#scaleOrigStroke = stroke;
          this.#scaleStartP = p;
          this.scaleGhost = stroke;
          return;
        }
        this.phase = "resizing";
        this.#resizeHandleIndex = hi;
        this.#resizeSingleStrokeId = stroke.id;
        this.#resizeOrigStrokes = [stroke];
        this.resizeGhosts = [stroke];
        this.#resizeOrigBox = null;
        return;
      }
      if (stroke.tool === "ink" || stroke.tool === "highlighter") {
        const box = computeBoundingBox([stroke]);
        const corners = bboxCorners(box);
        const bhi = hitTestBBoxHandles(corners, p);
        if (bhi !== -1) {
          this.phase = "resizing";
          this.#resizeHandleIndex = bhi;
          this.#resizeSingleStrokeId = null;
          this.#resizeOrigStrokes = [stroke];
          this.resizeGhosts = [stroke];
          this.#resizeOrigBox = box;
          return;
        }
      }
    } else if (selected.length > 1) {
      const box = computeBoundingBox(selected);
      const corners = bboxCorners(box);
      const hi = hitTestBBoxHandles(corners, p);
      if (hi !== -1) {
        this.phase = "resizing";
        this.#resizeHandleIndex = hi;
        this.#resizeSingleStrokeId = null;
        this.#resizeOrigStrokes = [...selected];
        this.resizeGhosts = [...selected];
        this.#resizeOrigBox = box;
        return;
      }
    }

    // ── 2. Check shape bodies (topmost first) ─────────────────────────────

    const shapesReversed = this.#selectableStrokes().slice().reverse();
    for (const stroke of shapesReversed) {
      if (hitTestShape(stroke, p)) {
        this.#tapOnSelected = ids.has(stroke.id); // true = second tap on same stroke
        if (!ids.has(stroke.id)) {
          selectedStrokeIds.set(new Set([stroke.id]));
        }
        this.phase = "pending-move";
        this.#moveStartPos = p;
        const currentIds = ids.has(stroke.id) ? ids : new Set([stroke.id]);
        this.#moveOriginals = get(activeAnnotations)[activeSlide].filter((s) =>
          currentIds.has(s.id),
        );
        this.moveGhosts = [...this.#moveOriginals];
        return;
      }
    }

    // ── 3. Nothing hit → start lasso ──────────────────────────────────────

    selectedStrokeIds.set(new Set());
    this.phase = "lasso";
    this.lassoPoints = [p];
  }

  onPointerMove(p: NormalizedPoint, shiftKey = false): void {
    if (
      this.phase === "scaling" &&
      this.#scaleOrigStroke &&
      this.#scaleStartP
    ) {
      const orig = this.#scaleOrigStroke;
      this.scaleGhost =
        orig.tool === "ellipse"
          ? applyCircleUniformScale(orig, this.#scaleStartP, p)
          : applyBoxUniformScale(orig, this.#scaleStartP, p);
      this.#sendMovePreview([this.scaleGhost]);
      return;
    }

    if (this.phase === "rotating" && this.#rotateOrigStroke) {
      const orig = this.#rotateOrigStroke;
      const cx =
        orig.tool === "ellipse"
          ? ellipseParams(orig).cx
          : (orig.points[0].normX + lastPoint(orig).normX) / 2;
      const cy =
        orig.tool === "ellipse"
          ? ellipseParams(orig).cy
          : (orig.points[0].normY + lastPoint(orig).normY) / 2;
      const canvas = this.canvas();
      const angle = computeRotationAngle(
        cx,
        cy,
        p.normX,
        p.normY,
        canvas.width,
        canvas.height,
      );
      this.rotateGhost = applyCircleRotation(orig, angle, shiftKey);
      this.#sendMovePreview([this.rotateGhost]);
      return;
    }

    if (this.phase === "lasso") {
      this.lassoPoints = [...this.lassoPoints, p];
      return;
    }

    if (
      (this.phase === "pending-move" || this.phase === "moving") &&
      this.#moveStartPos
    ) {
      const dx = p.normX - this.#moveStartPos.normX;
      const dy = p.normY - this.#moveStartPos.normY;
      const canvas = this.canvas();
      if (
        this.phase === "pending-move" &&
        Math.hypot(dx * canvas.width, dy * canvas.height) < MOVE_THRESHOLD_PX
      ) {
        return;
      }
      this.phase = "moving";
      this.moveGhosts = this.#moveOriginals.map((s) =>
        applyTranslate(s, dx, dy),
      );
      this.#sendMovePreview(this.moveGhosts);
      return;
    }

    if (this.phase === "resizing") {
      if (this.#resizeSingleStrokeId !== null) {
        const orig = this.#resizeOrigStrokes[0];
        if (orig) {
          const canvas = this.canvas();
          this.resizeGhosts = [
            applySingleResize(
              orig,
              this.#resizeHandleIndex,
              p,
              canvas.width,
              canvas.height,
            ),
          ];
          this.#sendMovePreview(this.resizeGhosts);
        }
      } else if (this.#resizeOrigBox) {
        const newBox = newBBoxFromCornerDrag(
          this.#resizeOrigBox,
          this.#resizeHandleIndex,
          p,
        );
        this.resizeGhosts = applyScaleToGroup(
          this.#resizeOrigStrokes,
          this.#resizeOrigBox,
          newBox,
        );
        this.#sendMovePreview(this.resizeGhosts);
      }
    }
  }

  onPointerUp(p: NormalizedPoint): void {
    if (this.phase === "lasso") {
      const hits = this.#selectableStrokes().filter((s) =>
        lassoIntersectsShape([...this.lassoPoints, p], s),
      );
      selectedStrokeIds.set(new Set(hits.map((s) => s.id)));
      this.lassoPoints = [];
      this.phase = "idle";
      return;
    }

    if (this.phase === "pending-move") {
      if (this.#tapOnSelected) {
        this.selectionMenuTrigger = p; // signal AnnotationCanvas to open the menu
        this.#tapOnSelected = false;
      }
      this.#resetMove();
      return;
    }

    if (this.phase === "moving") {
      const moved = this.moveGhosts.some((ghost, i) => {
        const orig = this.#moveOriginals[i];
        return (
          orig &&
          (ghost.points[0].normX !== orig.points[0].normX ||
            ghost.points[0].normY !== orig.points[0].normY)
        );
      });
      if (moved) this.#commitGhosts(this.moveGhosts);
      this.#resetMove();
      return;
    }

    if (this.phase === "scaling") {
      if (this.scaleGhost) this.#commitGhosts([this.scaleGhost]);
      this.scaleGhost = null;
      this.#scaleOrigStroke = null;
      this.#scaleStartP = null;
      this.phase = "idle";
      return;
    }

    if (this.phase === "rotating") {
      if (this.rotateGhost) this.#commitGhosts([this.rotateGhost]);
      this.rotateGhost = null;
      this.#rotateOrigStroke = null;
      this.phase = "idle";
      return;
    }

    if (this.phase === "resizing") {
      this.#commitGhosts(this.resizeGhosts);
      this.resizeGhosts = [];
      this.#resizeOrigStrokes = [];
      this.#resizeOrigBox = null;
      this.#resizeHandleIndex = -1;
      this.#resizeSingleStrokeId = null;
      this.phase = "idle";
      return;
    }

    this.phase = "idle";
  }

  // ── Public clipboard / edit methods ──────────────────────────────────────

  DUPLICATE_OFFSET_X = 0.05;
  DUPLICATE_OFFSET_Y = 0.05;

  delete(): void {
    const ids = get(selectedStrokeIds);
    if (ids.size === 0) return;
    const {
      source,
      slide,
      annotationsStore: activeAnnotations,
    } = activeContext();
    send({ type: "strokes_removed", source, slide, strokeIds: [...ids] });
    activeAnnotations.update((ann) => ({
      ...ann,
      [slide]: (ann[slide] ?? []).filter((s) => !ids.has(s.id)),
    }));
    selectedStrokeIds.set(new Set());
  }

  copy(): void {
    const strokes = activeSelectedStrokes();
    if (strokes.length === 0) return;
    clipboard.set(strokes);
  }

  cut(): void {
    this.copy();
    this.delete();
  }

  duplicate(): void {
    this.copy();
    const strokes = activeSelectedStrokes();
    const mid = middlePoint(strokes);
    this.paste({
      normX: mid.normX + this.DUPLICATE_OFFSET_X,
      normY: mid.normY + this.DUPLICATE_OFFSET_Y,
    });
  }

  paste(normPos: NormalizedPoint): void {
    const strokes = get(clipboard);
    if (strokes.length === 0) return;
    const {
      source,
      slide,
      annotationsStore: activeAnnotations,
    } = activeContext();
    const box = computeBoundingBox(strokes);
    const dx = normPos.normX - (box.minX + box.maxX) / 2;
    const dy = normPos.normY - (box.minY + box.maxY) / 2;
    const newStrokes: AnnotationStroke[] = strokes.map((s) => ({
      ...applyTranslate(s, dx, dy),
      id: uuidv4(),
    }));
    send({ type: "strokes_added", source, slide, strokes: newStrokes });
    activeAnnotations.update((ann) => ({
      ...ann,
      [slide]: [...(ann[slide] ?? []), ...newStrokes],
    }));
    selectedStrokeIds.set(new Set(newStrokes.map((s) => s.id)));
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  #sendMovePreview(strokes: AnnotationStroke[]): void {
    const { source, slide } = activeContext();
    send({ type: "strokes_move_preview", source, slide, strokes });
  }

  #resetMove(): void {
    this.moveGhosts = [];
    this.#moveOriginals = [];
    this.#moveStartPos = null;
    this.#tapOnSelected = false;
    this.phase = "idle";
  }

  #commitGhosts(ghosts: AnnotationStroke[]): void {
    if (ghosts.length === 0) return;
    const {
      source,
      slide,
      annotationsStore: activeAnnotations,
    } = activeContext();
    send({ type: "strokes_updated", source, slide, strokes: ghosts });
    const ghostMap = new Map(ghosts.map((g) => [g.id, g]));
    activeAnnotations.update((ann) => {
      const page = (ann[slide] ?? []).map((s) => ghostMap.get(s.id) ?? s);
      return { ...ann, [slide]: page };
    });
  }

  #selectableStrokes(): AnnotationStroke[] {
    const { slide, annotationsStore } = activeContext();
    return (get(annotationsStore)[slide] ?? []).filter((s) =>
      isSelectableTool(s.tool),
    );
  }
}

// ---------------------------------------------------------------------------
// Pointer dispatcher
// ---------------------------------------------------------------------------

export class PointerDispatcher extends GestureHandler {
  #activePointerId: number | null = null;

  readonly #draw: DrawGesture;
  readonly #select: SelectGesture;
  readonly #redraw: () => void;

  constructor(
    canvas: () => HTMLCanvasElement,
    draw: DrawGesture,
    select: SelectGesture,
    redraw: () => void,
  ) {
    super(canvas);
    this.#draw = draw;
    this.#select = select;
    this.#redraw = redraw;
  }

  onPointerDown(e: PointerEvent): void {
    if (get(deviceRole) !== "presenter") return;
    if (e.pointerType === "touch") return;
    e.preventDefault();
    if (this.#activePointerId !== null) return;
    this.#activePointerId = e.pointerId;
    this.canvas().setPointerCapture(e.pointerId);

    if (get(activeTool) === "select") {
      this.#select.onPointerDown(this.toNorm(e));
      this.#redraw();
    } else {
      this.#draw.onPointerDown(this.toNorm(e), get(activeTool));
    }
  }

  onPointerMove(e: PointerEvent): void {
    e.preventDefault();
    if (e.pointerId !== this.#activePointerId) return;

    if (get(activeTool) === "select") {
      this.#select.onPointerMove(this.toNorm(e), e.shiftKey);
      this.#redraw();
      return;
    }

    const eraserHandled = this.#draw.onPointerMove(e);
    if (eraserHandled) return;

    this.#redraw();
  }

  onPointerCancel(e: PointerEvent): void {
    if (e.pointerId !== this.#activePointerId) return;
    // A pointercancel fires when the browser (or OS palm-rejection) steals the
    // gesture — e.g. a palm landing outside the canvas while drawing.  Reset
    // the active pointer so subsequent gestures are not silently discarded.
    this.#activePointerId = null;

    // Also clean up any in-progress gesture state so the next gesture starts
    // fresh (avoids "stuck" lasso / move / draw phases).
    if (get(activeTool) === "select") {
      this.#select.onPointerUp(this.toNorm(e));
    } else {
      this.#draw.onPointerCancel();
    }
    this.#redraw();
  }

  onPointerUp(e: PointerEvent): void {
    e.preventDefault();
    if (e.pointerId !== this.#activePointerId) return;
    this.#activePointerId = null;

    if (get(activeTool) === "select") {
      this.#select.onPointerUp(this.toNorm(e));
      this.#redraw();
      return;
    }

    this.#draw.onPointerUp();
    // No redraw() here — the last onPointerMove frame is still on screen.
    // The reactive $effect will redraw once the server echoes the stroke
    // back into $annotations, matching the original pre-refactor behaviour.
  }
}
