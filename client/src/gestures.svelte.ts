import { get } from "svelte/store";
import {
  annotations,
  currentSlide,
  activeTool,
  activeColor,
  activeThickness,
  selectedStrokeIds,
  deviceRole,
} from "./stores";
import { send } from "./ws-client";
import { thicknessPx } from "./draw";
import { v4 as uuidv4 } from "uuid";
import type { AnnotationStroke, AnnotationTool, Point, StrokeColor } from "../../shared/types";
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
  newBBoxFromCornerDrag,
  computeRotationAngle,
  ellipseParams,
  distToSegSq,
  lastPoint,
  type BoundingBox,
  CIRCLE_HANDLE_CENTER,
  CIRCLE_HANDLE_ROTATE,
} from "./geometry";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function isShapeTool(tool: string): boolean {
  return (
    tool === "arrow" ||
    tool === "box" ||
    tool === "ellipse" ||
    tool === "perfect-circle"
  );
}

export function isSelectableTool(tool: string): boolean {
  return (
    tool === "arrow" ||
    tool === "box" ||
    tool === "ellipse" ||
    tool === "ink" ||
    tool === "highlighter"
  );
}

// ---------------------------------------------------------------------------
// Draw / Erase gesture
// ---------------------------------------------------------------------------

const ERASER_RADIUS_NORM = 0.015;

export class DrawGesture {
  // Exposed so redraw() can draw the in-progress stroke preview.
  // Not $state — redraw() is called imperatively, not reactively.
  currentPoints: Point[] = [];

  // Purely internal bookkeeping: never read outside this class.
  #perfectCircleCenter: Point | null = null;
  #erasedThisGesture = new Set<string>();
  #currentStrokeId: string | null = null;
  #sentPointCount = 0;

  readonly #canvas: () => HTMLCanvasElement;

  constructor(canvas: () => HTMLCanvasElement) {
    this.#canvas = canvas;
  }

  get currentStrokeId(): string | null {
    return this.#currentStrokeId;
  }

  onPointerDown(p: Point, tool: string): void {
    this.#erasedThisGesture = new Set();
    this.currentPoints = [p];
    if (tool === "perfect-circle") {
      this.#perfectCircleCenter = p;
    }
    if (tool !== "eraser" && tool !== "select") {
      this.#currentStrokeId = uuidv4();
      this.#sentPointCount = 0;
      const committedTool = tool === "perfect-circle" ? "ellipse" : tool;
      const color = tool === "highlighter" ? "yellow" : get(activeColor);
      send({
        type: "stroke_begin",
        slide: get(currentSlide),
        strokeId: this.#currentStrokeId,
        tool: committedTool as AnnotationTool,
        color: color as StrokeColor,
        thickness: get(activeThickness),
      });
    }
  }

  /** Returns true if the event was handled by the eraser (no preview needed). */
  onPointerMove(e: PointerEvent, toNorm: (e: PointerEvent) => Point): boolean {
    const tool = get(activeTool);
    if (tool === "eraser") {
      this.#applyErase(toNorm(e));
      return true;
    }
    const coalesced = e.getCoalescedEvents?.() ?? [e];
    for (const ce of coalesced) {
      this.#applyMoveEvent(ce, toNorm);
    }
    if (this.#currentStrokeId) {
      const isShape = isShapeTool(tool) || tool === "perfect-circle";
      const toSend = isShape
        ? this.currentPoints
        : this.currentPoints.slice(this.#sentPointCount);
      this.#sentPointCount = this.currentPoints.length;
      if (toSend.length > 0) {
        send({ type: "stroke_point", strokeId: this.#currentStrokeId, points: toSend });
      }
    }
    return false;
  }

  onPointerUp(): void {
    const tool = get(activeTool);

    if (tool === "eraser") {
      if (this.#erasedThisGesture.size > 0) {
        send({
          type: "strokes_removed",
          slide: get(currentSlide),
          strokeIds: [...this.#erasedThisGesture],
        });
        this.#erasedThisGesture = new Set();
      }
      this.currentPoints = [];
      return;
    }

    if (this.currentPoints.length < 2) {
      if (this.#currentStrokeId) {
        send({ type: "stroke_abandon", strokeId: this.#currentStrokeId });
      }
      this.currentPoints = [];
      this.#currentStrokeId = null;
      this.#sentPointCount = 0;
      return;
    }

    const slide = get(currentSlide);
    const committedTool = tool === "perfect-circle" ? "ellipse" : tool;
    const stroke: AnnotationStroke = {
      id: this.#currentStrokeId ?? uuidv4(),
      tool: committedTool,
      color: tool === "highlighter" ? "yellow" : get(activeColor),
      thickness: get(activeThickness),
      points: isShapeTool(tool)
        ? [
            this.currentPoints[0],
            this.currentPoints[this.currentPoints.length - 1],
          ]
        : this.currentPoints,
    };

    send({ type: "stroke_added", slide, stroke });
    this.currentPoints = [];
    this.#perfectCircleCenter = null;
    this.#currentStrokeId = null;
    this.#sentPointCount = 0;
  }

  onPointerCancel(): void {
    if (this.#currentStrokeId) {
      send({ type: "stroke_abandon", strokeId: this.#currentStrokeId });
    }
    this.currentPoints = [];
    this.#currentStrokeId = null;
    this.#sentPointCount = 0;
    this.#perfectCircleCenter = null;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  #applyErase(p: Point): void {
    const slide = get(currentSlide);
    const strokes = get(annotations)[slide] ?? [];
    const toErase = strokes.filter(
      (s) => !this.#erasedThisGesture.has(s.id) && this.#hitTestEraser(s, p),
    );
    if (toErase.length === 0) return;

    for (const s of toErase) {
      this.#erasedThisGesture.add(s.id);
    }
    const erasedIds = new Set(toErase.map((s) => s.id));
    annotations.update((ann) => {
      const page = (ann[slide] ?? []).filter((s) => !erasedIds.has(s.id));
      return { ...ann, [slide]: page };
    });
  }

  #applyMoveEvent(e: PointerEvent, toNorm: (e: PointerEvent) => Point): void {
    const tool = get(activeTool);
    if (tool === "perfect-circle") {
      const center = this.#perfectCircleCenter!;
      const current = toNorm(e);
      const rect = this.#canvas().getBoundingClientRect();
      const dxPx = (current.x - center.x) * rect.width;
      const dyPx = (current.y - center.y) * rect.height;
      const rPx = Math.hypot(dxPx, dyPx);
      const rx = rPx / rect.width;
      const ry = rPx / rect.height;
      this.currentPoints = [
        { x: center.x - rx, y: center.y - ry },
        { x: center.x + rx, y: center.y + ry },
      ];
    } else if (isShapeTool(tool)) {
      this.currentPoints = [this.currentPoints[0], toNorm(e)];
    } else {
      this.currentPoints = [...this.currentPoints, toNorm(e)];
    }
  }

  #hitTestEraser(stroke: AnnotationStroke, p: Point): boolean {
    if (stroke.tool === "arrow") {
      if (hitTestShape(stroke, p, ERASER_RADIUS_NORM)) return true;
      const canvas = this.#canvas();
      const b = lastPoint(stroke);
      const a = stroke.points[0];
      const headLenNorm =
        (16 + thicknessPx(stroke.thickness) * 2) / canvas.width;
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const rSq = ERASER_RADIUS_NORM * ERASER_RADIUS_NORM;
      const w1x = b.x - headLenNorm * Math.cos(angle - Math.PI / 6);
      const w1y = b.y - headLenNorm * Math.sin(angle - Math.PI / 6);
      const w2x = b.x - headLenNorm * Math.cos(angle + Math.PI / 6);
      const w2y = b.y - headLenNorm * Math.sin(angle + Math.PI / 6);
      return (
        distToSegSq(p.x, p.y, b.x, b.y, w1x, w1y) < rSq ||
        distToSegSq(p.x, p.y, b.x, b.y, w2x, w2y) < rSq
      );
    }
    return hitTestShape(stroke, p, ERASER_RADIUS_NORM);
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

export class SelectGesture {
  // $state fields — read by redraw() so Svelte must track them.
  phase = $state<SelectPhase>("idle");
  lassoPoints = $state<Point[]>([]);
  moveGhosts = $state<AnnotationStroke[]>([]);
  resizeGhosts = $state<AnnotationStroke[]>([]);
  rotateGhost = $state<AnnotationStroke | null>(null);
  scaleGhost = $state<AnnotationStroke | null>(null);

  // Plain private fields — internal bookkeeping only, never read by redraw().
  #moveStartPos: Point | null = null;
  #moveOriginals: AnnotationStroke[] = [];
  #resizeHandleIndex = -1;
  #resizeSingleStrokeId: string | null = null;
  #resizeOrigStrokes: AnnotationStroke[] = [];
  #resizeOrigBox: BoundingBox | null = null;
  #rotateOrigStroke: AnnotationStroke | null = null;
  #scaleOrigStroke: AnnotationStroke | null = null;
  #scaleStartP: Point | null = null;

  readonly #canvas: () => HTMLCanvasElement;

  constructor(canvas: () => HTMLCanvasElement) {
    this.#canvas = canvas;
  }

  // Expose read-only values that redraw() needs for drawing handles.
  get resizeHandleIndex(): number {
    return this.#resizeHandleIndex;
  }
  get resizeSingleStrokeId(): string | null {
    return this.#resizeSingleStrokeId;
  }

  onPointerDown(p: Point): void {
    const ids = get(selectedStrokeIds);
    const allStrokes = get(annotations)[get(currentSlide)] ?? [];
    const selected = allStrokes.filter((s) => ids.has(s.id));
    const canvas = this.#canvas();

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
        this.phase = "resizing";
        this.#resizeHandleIndex = hi;
        this.#resizeSingleStrokeId = stroke.id;
        this.#resizeOrigStrokes = [stroke];
        this.resizeGhosts = [stroke];
        this.#resizeOrigBox = null;
        return;
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
        if (!ids.has(stroke.id)) {
          selectedStrokeIds.set(new Set([stroke.id]));
        }
        this.phase = "pending-move";
        this.#moveStartPos = p;
        const currentIds = ids.has(stroke.id) ? ids : new Set([stroke.id]);
        this.#moveOriginals = allStrokes.filter((s) => currentIds.has(s.id));
        this.moveGhosts = [...this.#moveOriginals];
        return;
      }
    }

    // ── 3. Nothing hit → start lasso ──────────────────────────────────────

    selectedStrokeIds.set(new Set());
    this.phase = "lasso";
    this.lassoPoints = [p];
  }

  onPointerMove(p: Point, shiftKey = false): void {
    if (
      this.phase === "scaling" &&
      this.#scaleOrigStroke &&
      this.#scaleStartP
    ) {
      this.scaleGhost = applyCircleUniformScale(
        this.#scaleOrigStroke,
        this.#scaleStartP,
        p,
      );
      send({ type: "strokes_move_preview", strokes: [this.scaleGhost] });
      return;
    }

    if (this.phase === "rotating" && this.#rotateOrigStroke) {
      const { cx, cy } = ellipseParams(this.#rotateOrigStroke);
      const canvas = this.#canvas();
      const angle = computeRotationAngle(
        cx,
        cy,
        p.x,
        p.y,
        canvas.width,
        canvas.height,
      );
      this.rotateGhost = applyCircleRotation(
        this.#rotateOrigStroke,
        angle,
        shiftKey,
      );
      send({ type: "strokes_move_preview", strokes: [this.rotateGhost] });
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
      const dx = p.x - this.#moveStartPos.x;
      const dy = p.y - this.#moveStartPos.y;
      const canvas = this.#canvas();
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
      send({ type: "strokes_move_preview", strokes: this.moveGhosts });
      return;
    }

    if (this.phase === "resizing") {
      if (this.#resizeSingleStrokeId !== null) {
        const orig = this.#resizeOrigStrokes[0];
        if (orig) {
          this.resizeGhosts = [
            applySingleResize(orig, this.#resizeHandleIndex, p),
          ];
          send({ type: "strokes_move_preview", strokes: this.resizeGhosts });
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
        send({ type: "strokes_move_preview", strokes: this.resizeGhosts });
      }
    }
  }

  onPointerUp(p: Point): void {
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
      this.#resetMove();
      return;
    }

    if (this.phase === "moving") {
      const moved = this.moveGhosts.some((ghost, i) => {
        const orig = this.#moveOriginals[i];
        return (
          orig &&
          (ghost.points[0].x !== orig.points[0].x ||
            ghost.points[0].y !== orig.points[0].y)
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

  // ── Private helpers ───────────────────────────────────────────────────────

  #resetMove(): void {
    this.moveGhosts = [];
    this.#moveOriginals = [];
    this.#moveStartPos = null;
    this.phase = "idle";
  }

  #commitGhosts(ghosts: AnnotationStroke[]): void {
    if (ghosts.length === 0) return;
    const slide = get(currentSlide);
    send({ type: "strokes_updated", slide, strokes: ghosts });
    const ghostMap = new Map(ghosts.map((g) => [g.id, g]));
    annotations.update((ann) => {
      const page = (ann[slide] ?? []).map((s) => ghostMap.get(s.id) ?? s);
      return { ...ann, [slide]: page };
    });
  }

  #selectableStrokes(): AnnotationStroke[] {
    return (get(annotations)[get(currentSlide)] ?? []).filter((s) =>
      isSelectableTool(s.tool),
    );
  }
}

// ---------------------------------------------------------------------------
// Pointer dispatcher
// ---------------------------------------------------------------------------

export class PointerDispatcher {
  #activePointerId: number | null = null;

  readonly #canvas: () => HTMLCanvasElement;
  readonly #draw: DrawGesture;
  readonly #select: SelectGesture;
  readonly #redraw: () => void;

  constructor(
    canvas: () => HTMLCanvasElement,
    draw: DrawGesture,
    select: SelectGesture,
    redraw: () => void,
  ) {
    this.#canvas = canvas;
    this.#draw = draw;
    this.#select = select;
    this.#redraw = redraw;
  }

  onPointerDown(e: PointerEvent): void {
    if (get(deviceRole) !== "presenter") return;
    e.preventDefault();
    if (this.#activePointerId !== null) return;
    this.#activePointerId = e.pointerId;
    this.#canvas().setPointerCapture(e.pointerId);

    if (get(activeTool) === "select") {
      this.#select.onPointerDown(this.#toNorm(e));
      this.#redraw();
    } else {
      this.#draw.onPointerDown(this.#toNorm(e), get(activeTool));
    }
  }

  onPointerMove(e: PointerEvent): void {
    e.preventDefault();
    if (e.pointerId !== this.#activePointerId) return;

    if (get(activeTool) === "select") {
      this.#select.onPointerMove(this.#toNorm(e), e.shiftKey);
      this.#redraw();
      return;
    }

    const eraserHandled = this.#draw.onPointerMove(e, (ev) => this.#toNorm(ev));
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
      this.#select.onPointerUp(this.#toNorm(e));
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
      this.#select.onPointerUp(this.#toNorm(e));
      this.#redraw();
      return;
    }

    this.#draw.onPointerUp();
    // No redraw() here — the last onPointerMove frame is still on screen.
    // The reactive $effect will redraw once the server echoes the stroke
    // back into $annotations, matching the original pre-refactor behaviour.
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  #toNorm(e: PointerEvent): Point {
    const canvas = this.#canvas();
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
      pressure: e.pressure || 0.5,
    };
  }
}
