# Resize & Move Shapes — Implementation Plan

## Overview

Add a **Select tool** that lets the annotator select, move, and resize `arrow` and `box`
shapes. Freehand lasso selection, multi-shape group operations, proportional scaling via
a shared bounding box, and full undo support are all included.

---

## Library

**`@flatten-js/core`** will be added as a dependency and used through a thin
`client/src/geometry.ts` utility module. It covers:

| Task | API used |
|---|---|
| Lasso vs. shape intersection | `Relations.intersect(polygon, segment)` |
| Point-in-box hit test | `polygon.contains(point)` |
| Segment–segment intersection (lasso vs. arrow) | `segment.intersect(segment)` |
| Bounding box of selected shapes | `shape.box` + `Box` union |
| Proportional scale transform | `Matrix` translate + scale |
| Handle hit test (distance) | `point.distanceTo(point)` |

---

## Files changed / created

| File | Change |
|---|---|
| `shared/types.ts` | Add `stroke_updated`, `strokes_updated` client+server messages; add `"select"` to `AnnotationTool` |
| `server.ts` | Handle `stroke_updated` / `strokes_updated`; integrate into undo stack |
| `client/src/stores.ts` | Add `selectedStrokeIds` store; clear on slide change |
| `client/src/geometry.ts` | **New** — all geometry helpers (lasso test, hit test, bounding box, scale transform) |
| `client/src/Toolbar.svelte` | Add Select button (Lucide `MousePointer2`) |
| `client/src/AnnotationCanvas.svelte` | Full select/move/resize state machine |

---

## Step-by-step implementation order

### Step 1 — `shared/types.ts`

1. Add `"select"` to `AnnotationTool`.
2. Add client messages:
   - `{ type: "stroke_updated"; slide: number; stroke: AnnotationStroke }` — single shape updated.
   - `{ type: "strokes_updated"; slide: number; strokes: AnnotationStroke[] }` — batch update (move/group resize).
3. Add server messages mirroring the above (same shape, broadcast to all clients).

---

### Step 2 — `server.ts`

Handle the two new client message types:

**`stroke_updated`**
- Find the stroke by `id` in `appState.annotations[slide]` and replace it in place.
- Broadcast `{ type: "stroke_updated", slide, stroke }` to all clients.
- Push the old stroke onto the undo stack entry (so undo restores it).
- Call `saveAnnotations()`.

**`strokes_updated`**
- For each stroke in the payload, replace the matching stroke by `id`.
- Broadcast `{ type: "strokes_updated", slide, strokes }` to all clients.
- Push the old versions as a single undo entry (one undo step undoes all of them).
- Call `saveAnnotations()`.

**Undo**
- The existing undo logic pops the last entry from the undo stack and removes the last
  stroke. Extend it so that a stack entry can be either a single stroke removal (current
  behaviour) or a batch "restore previous versions" operation.
- Simplest model: maintain a parallel `undoStack` array where each entry is
  `{ type: "remove", strokeId } | { type: "restore", strokes: AnnotationStroke[] }`.
- `stroke_added` pushes `{ type: "remove", strokeId: stroke.id }`.
- `stroke_updated` / `strokes_updated` push `{ type: "restore", strokes: <old versions> }`.
- `undo` pops the top entry and applies the inverse.

---

### Step 3 — `client/src/stores.ts`

- Add `export const selectedStrokeIds = writable<Set<string>>(new Set())`.
- In `applyState` (called on `pdf_loaded` / `state_sync`) reset to `new Set()`.
- Subscribe to `currentSlide` changes and reset `selectedStrokeIds` to `new Set()`.

---

### Step 4 — `client/src/geometry.ts` (new file)

All pure functions; no Svelte imports. Uses `@flatten-js/core`.

```typescript
// Coordinate helpers
function toFlattenPoint(p: Point): Flatten.Point
function toFlattenSegment(a: Point, b: Point): Flatten.Segment
function toFlattenPolygon(points: Point[]): Flatten.Polygon  // closed polygon from lasso path

// Hit testing
function hitTestShape(stroke: AnnotationStroke, p: Point): boolean
//   - arrow: point within HANDLE_RADIUS of either endpoint → true; else segment distance < HIT_RADIUS
//   - box: point inside the rectangle or within HIT_RADIUS of any edge

function lassoIntersectsShape(lassoPoints: Point[], stroke: AnnotationStroke): boolean
//   - Build Flatten.Polygon from lassoPoints
//   - arrow: check if either endpoint is inside lasso polygon OR lasso polygon intersects the arrow segment
//   - box: check if any corner is inside lasso polygon OR lasso polygon intersects any of the 4 edges

// Bounding box
function computeBoundingBox(strokes: AnnotationStroke[]): { minX, minY, maxX, maxY }
//   - Iterates all points of all strokes; returns tight axis-aligned bounding box in normalized coords

// Handles
function getHandles(stroke: AnnotationStroke): Point[]
//   - arrow: [points[0], points[1]]  (start and end)
//   - box: all 4 corners derived from points[0] and points[1]

function hitTestHandle(handle: Point, p: Point, radiusNorm: number): boolean
//   - euclidean distance < radiusNorm

// Transforms
function applyTranslate(stroke: AnnotationStroke, dx: number, dy: number): AnnotationStroke
//   - Returns new stroke with all points shifted by (dx, dy); clamps to [0,1]

function applyScaleToGroup(
  strokes: AnnotationStroke[],
  oldBox: BoundingBox,
  newBox: BoundingBox,
): AnnotationStroke[]
//   - For each point p, maps it proportionally from oldBox coordinate space into newBox
//   - newX = newBox.minX + (p.x - oldBox.minX) / oldBox.width * newBox.width
//   - Clamps to [0,1]

function applySingleResize(
  stroke: AnnotationStroke,
  handleIndex: number,
  newPos: Point,
): AnnotationStroke
//   - arrow: replace points[handleIndex] with newPos; other point unchanged
//   - box: handleIndex 0–3 maps to a corner; derive the two new points (top-left, bottom-right)
//     such that the dragged corner moves freely and the opposite corner is anchored
```

---

### Step 5 — `client/src/Toolbar.svelte`

- Import `MousePointer2` from `lucide-svelte`.
- Add a Select button **before** the Pencil button:
  ```
  <button class="tool-btn" class:active={$activeTool === "select"}
          title="Select" onclick={() => activeTool.set("select")}>
    <MousePointer2 size={20} />
  </button>
  <div class="divider" />
  ```
- `colorDisabled` and `thicknessPicker` disabled when `activeTool === "select"` (same
  pattern as current `colorDisabled` logic).

---

### Step 6 — `client/src/AnnotationCanvas.svelte`

This is the largest change. The canvas pointer handler becomes a small state machine.

#### State variables (added alongside existing ones)

```typescript
type SelectPhase =
  | "idle"
  | "lasso"        // drawing freehand lasso
  | "moving"       // dragging selected shapes
  | "resizing";    // dragging a handle

let selectPhase: SelectPhase = "idle";
let lassoPoints: Point[] = [];

// For move
let moveStartPos: Point | null = null;    // pointer position at drag start (normalized)
let moveGhosts: AnnotationStroke[] = []; // translated copies rendered during drag

// For resize (single or group)
let resizeHandleIndex: number = -1;      // which handle is being dragged
let resizeSingleStrokeId: string | null = null; // null = group resize
let resizeOrigStrokes: AnnotationStroke[] = []; // snapshot at drag start
let resizeOrigBox: BoundingBox | null = null;    // bounding box at drag start (group)
```

#### Guard: all existing pointer logic is gated

```typescript
if ($activeTool !== "select") {
  // existing drawing / erasing logic unchanged
}
```

#### `onPointerDown` in select mode

1. Check handles first (priority):
   - If single shape selected: call `getHandles(stroke)`, test each with `hitTestHandle`.
     If hit → `selectPhase = "resizing"`, store `resizeHandleIndex`, snapshot stroke,
     `resizeSingleStrokeId = stroke.id`.
   - If multi-select: compute shared bounding box, test 4 corner handles.
     If hit → `selectPhase = "resizing"`, store `resizeHandleIndex`,
     snapshot all selected strokes + `resizeOrigBox`, `resizeSingleStrokeId = null`.
2. If no handle hit, check shape bodies (topmost first, iterate `$annotations[$currentSlide]` reversed):
   - Call `hitTestShape(stroke, p)`.
   - If hit and shape is selectable (`arrow` or `box`):
     - If shape already in `selectedStrokeIds` → keep selection.
     - Else → `selectedStrokeIds.set(new Set([stroke.id]))`.
     - `selectPhase = "moving"`, `moveStartPos = p`, snapshot `moveGhosts`.
3. If nothing hit → start lasso: `selectPhase = "lasso"`, `lassoPoints = [p]`,
   clear `selectedStrokeIds`.

#### `onPointerMove` in select mode

- **lasso**: append `p` to `lassoPoints`, redraw (calls `redraw()` then draws lasso outline).
- **moving**: compute `(dx, dy)` from `moveStartPos`. Apply `applyTranslate` to all
  selected strokes using snapshots → `moveGhosts`. Redraw with ghosts instead of originals.
  Handles hidden during drag.
- **resizing**:
  - Single shape: call `applySingleResize(origStroke, handleIndex, p)` → ghost. Redraw.
  - Group: derive `newBox` from dragging corner `handleIndex` of `resizeOrigBox` to `p`
    (opposite corner anchored). Call `applyScaleToGroup(resizeOrigStrokes, resizeOrigBox, newBox)`.
    Redraw ghosts + shared bounding box outline.

#### `onPointerUp` in select mode

- **lasso**: close path, call `lassoIntersectsShape` for each selectable stroke on the
  slide, collect matching ids → `selectedStrokeIds.set(new Set(ids))`. Clear `lassoPoints`.
- **moving**: if `moveGhosts` differ from originals (i.e. actual movement occurred), call
  `send({ type: "strokes_updated", slide: $currentSlide, strokes: moveGhosts })`.
  Optimistically update `annotations` store. Reset ghosts.
- **resizing (single)**: send `stroke_updated` with the final ghost stroke. Update store.
- **resizing (group)**: send `strokes_updated` with all final ghost strokes. Update store.

Always set `selectPhase = "idle"`.

#### `redraw()` extension

After drawing all annotation strokes, if `$activeTool === "select"`:

1. **During lasso**: draw dashed freehand outline following `lassoPoints`.
2. **Single selected shape, not dragging**:
   - Draw small filled blue circles at each handle returned by `getHandles(stroke)`.
3. **Multiple selected shapes, not dragging**:
   - Compute shared bounding box; draw dashed rectangle.
   - Draw 4 blue corner dot handles at bounding box corners.
4. **During move drag**: render `moveGhosts` at semi-opacity; skip handles.
5. **During resize drag**: render ghost stroke(s); draw only the active handle dot.

Handle rendering constants:
```typescript
const HANDLE_RADIUS_NORM = 0.012; // normalized radius for hit testing
const HANDLE_DRAW_PX = 6;         // pixel radius drawn on canvas
const HANDLE_COLOR = "#3b82f6";   // Tailwind blue-500
const LASSO_DASH = [6, 4];
```

---

## Data flow summary

```
pointerdown ──► hit-test handles → resizing
            └─► hit-test shapes  → moving
            └─► empty space      → lasso

pointermove ──► lasso:    append point, draw outline
            └─► moving:   translate ghosts, redraw
            └─► resizing: update ghost(s), redraw

pointerup   ──► lasso:    intersect test → update selectedStrokeIds
            └─► moving:   send strokes_updated → update store
            └─► resizing: send stroke_updated / strokes_updated → update store
```

---

## Undo stack model on server (extended)

```typescript
type UndoEntry =
  | { type: "remove"; slide: number; strokeId: string }
  | { type: "restore"; slide: number; strokes: AnnotationStroke[] };

const undoStack: UndoEntry[] = [];
```

`stroke_added`    → push `{ type: "remove", slide, strokeId }`  
`stroke_updated`  → push `{ type: "restore", slide, strokes: [oldStroke] }`  
`strokes_updated` → push `{ type: "restore", slide, strokes: [oldStroke1, ...] }`  
`undo` pops top entry and applies the inverse:
- `remove` → remove that stroke from annotations, broadcast `stroke_removed`.
- `restore` → replace each stroke by id with saved version, broadcast `strokes_updated`.

---

## Notes

- `"select"` is added to `AnnotationTool` in shared types; the server does not need to
  interpret it (it's never stored in a stroke).
- All normalized coordinates stay in `[0, 1]`; `geometry.ts` clamps after every transform.
- `@flatten-js/core` is used only in `geometry.ts`; the rest of the codebase is unaffected.
- No cursor changes as per spec.
- Lasso selects shapes that **intersect** the lasso path (not just fully enclosed).
- Only `arrow` and `box` are selectable; `ink` and `highlighter` strokes are skipped in
  all hit tests.
```

Now let me start coding all the steps in order.