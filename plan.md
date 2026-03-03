# PDF Presentation App — Implementation Plan

## Context
Implement a self-hosted, offline-capable web app for delivering PDF slide presentations across two devices (laptop + iPad) with live pen annotation support. The `summary.md` spec defines all requirements. The repository currently contains only `summary.md` — all code must be created from scratch.

---

## Architecture Decisions

- **PDF.js:** npm package (`pdfjs-dist`) — avoids CDN, integrates with Vite, provides TypeScript types
- **PDF export:** `pdf-lib` — canvas flattening, no server round-trip required
- **Device role:** Manual selection (button pair after PIN auth) — avoids fragile user-agent sniffing
- **Dev server:** Vite on port 5173 proxying `/api` and `/ws` to backend on port 3001
- **WS URL detection:** Client checks `window.location.port === '5173'` to pick dev vs prod WebSocket URL
- **Annotations:** Coordinates normalized (0–1) relative to page size — resolution-independent across devices
- **Auth:** PIN → UUID session token stored in `sessionStorage`, passed as `?token=` query param

## Project Layout

```
presenter/
  server.ts              # Node.js backend (all-in-one)
  shared/types.ts        # Shared TypeScript interfaces
  client/
    index.html
    vite.config.ts
    tsconfig.json
    src/
      main.ts
      App.svelte
      FileBrowser.svelte
      PdfViewer.svelte
      AnnotationCanvas.svelte
      Toolbar.svelte
      stores.ts          # Svelte writable stores
      ws-client.ts       # WebSocket connection + dispatch
  tsconfig.server.json
  package.json
```

---

## WebSocket Protocol Summary

**Client → Server:** `hello`, `slide_change`, `stroke_added`, `undo`, `clear_slide`, `clear_all`, `load_pdf`
**Server → Client:** `state_sync` (on connect), `slide_changed`, `stroke_added`, `stroke_undone`, `slide_cleared`, `all_cleared`, `pdf_loaded`, `error`

---

## Implementation Steps

Each step is tested before proceeding to the next.

---

### Step 1 — Project Scaffold

**Goal:** Working build system; `npm run dev` opens a page in the browser.

**Files to create:**
- `package.json` — scripts: `dev`, `build`, `build:client`, `build:server`, `server`
- `client/vite.config.ts` — Svelte plugin, proxy `/api` + `/ws` to `localhost:3001`, output to `../dist/client`
- `client/tsconfig.json` — Svelte + TypeScript config for the client
- `tsconfig.server.json` — server-only TS config (ESNext, NodeNext, output `dist/`)
- `client/index.html` — minimal HTML with `<div id="app">`
- `client/src/main.ts` — mounts `App.svelte`
- `client/src/App.svelte` — renders `<h1>Presenter App</h1>`

**Dependencies:**
```
svelte, @sveltejs/vite-plugin-svelte, vite, typescript, tsx  (devDeps)
pdfjs-dist, pdf-lib, ws  (deps)
@types/node, @types/ws  (devDeps)
```

**Test:** `npm install && npm run dev` → browser shows "Presenter App". `npm run build:client` → `dist/client/` produced.

---

### Step 2 — Shared Types (`shared/types.ts`)

**Goal:** All TypeScript interfaces shared between server and client. No runnable artifact; prerequisite for all later steps.

**Types to define:**
- `DeviceRole = 'presenter' | 'annotator'`
- `AnnotationTool = 'ink' | 'highlighter' | 'arrow' | 'box' | 'eraser'`
- `StrokeColor = 'orange' | 'red' | 'green' | 'yellow' | 'black' | 'gray'`
- `StrokeThickness = 'thin' | 'medium' | 'thick'`
- `Point { x: number; y: number }` — normalized 0–1 to page dimensions
- `AnnotationStroke { id, tool, color, thickness, points }`
- `AnnotationMap = Record<number, AnnotationStroke[]>`
- `AppState { activePdfPath, activePdfName, pageCount, currentSlide, annotations }`
- `DirectoryEntry { name, path, type: 'file' | 'folder' }`
- `ClientMessage` — discriminated union of all client→server message shapes
- `ServerMessage` — discriminated union of all server→client message shapes

**Test:** Add `import type { AppState } from '../../shared/types.ts'` to `App.svelte`; verify `npm run dev` compiles without TypeScript errors. Remove the import afterward.

---

### Step 3 — Minimal Server + WebSocket Skeleton (`server.ts`)

**Goal:** `tsx server.ts <root>` starts on port 3001, serves `dist/client/` as static files, opens a WebSocket server, and refuses invalid startup args.

**Implement:**
- Command-line arg validation: exit with error if no arg or path doesn't exist
- HTTP server with minimal MIME-type static file serving (SPA fallback to `index.html`)
- WebSocket server (`ws` library) on the same HTTP server via upgrade event
- In-memory `AppState` object (initially empty)
- On WS connect: store client; on disconnect: remove client
- `broadcast(msg)` helper: JSON-serialize and send to all connected clients

**Test:**
1. `npm run build:client && tsx server.ts /tmp/testpdfs` → "Server running on port 3001"
2. Open `http://localhost:3001` → page renders
3. `tsx server.ts` (no arg) → exits with usage message
4. `tsx server.ts /nonexistent` → exits with error

---

### Step 4 — REST API: `/api/browse` and `/api/pdf`

**Goal:** Server exposes directory listing and PDF streaming endpoints, with path-traversal protection.

**Add to `server.ts`:**
- `isWithinRoot(path)` — ensures all paths resolve within `PDF_ROOT`
- `GET /api/browse?path=<dir>` — reads directory, filters to folders + `.pdf` files, sorts folders-first, returns JSON `DirectoryEntry[]`
- `GET /api/pdf?path=<filepath>` — streams a `.pdf` file with correct headers; validates path is within root

**Test:**
1. `curl "http://localhost:3001/api/browse?path=/tmp/testpdfs"` → JSON with folders and PDFs
2. `curl "http://localhost:3001/api/browse?path=/etc"` → 403
3. `curl "http://localhost:3001/api/pdf?path=/tmp/testpdfs/test.pdf" -o /tmp/out.pdf` → valid PDF
4. `curl "http://localhost:3001/api/pdf?path=/etc/passwd"` → 403

---

### Step 5 — PIN Authentication

**Goal:** All API/WS access requires a PIN. Client shows a PIN gate on first load.

**Server changes (`server.ts`):**
- In-memory `Set<string> validTokens`
- `POST /api/auth` — accepts `{ pin }` JSON body; returns `{ token: UUID }` on success, 401 on failure
- `isAuthenticated(req)` — checks `?token=` query param or `x-auth-token` header against `validTokens`
- Wrap all `/api/*` routes with auth check (skip `/api/auth` itself)
- WS upgrade: validate `?token=` before allowing connection

**Client changes (`App.svelte`):**
- PIN input form (password field + Enter key)
- POST to `/api/auth`; store token in `sessionStorage`
- If token already in `sessionStorage`, skip straight to main app
- Show error message on wrong PIN

**Test:**
1. Open app → PIN screen appears
2. Wrong PIN → "Invalid PIN" shown
3. Correct PIN (`1234`) → authenticated view shows
4. Refresh → still authenticated (token in sessionStorage)
5. `curl http://localhost:3001/api/browse` → 401
6. `curl "http://localhost:3001/api/browse?token=BAD"` → 401

---

### Step 6 — Svelte Stores, WebSocket Client, Device Role Selection

**Goal:** After PIN auth, user picks presenter or annotator role. WS connection established. `AppState` received and stored in Svelte stores.

**Create `client/src/stores.ts`:**
- `authToken`, `deviceRole`, `activePdfPath`, `activePdfName`, `pageCount`, `currentSlide`, `annotations`
- `applyState(state: AppState)` — bulk-update all stores from server state

**Create `client/src/ws-client.ts`:**
- `connect(token, role)` — opens WebSocket, sends `hello`, returns `Promise<void>`
- `send(msg: ClientMessage)` — JSON-serialize and send
- `onMessage(type, handler)` — register per-type handlers
- Handlers pre-wired for `state_sync`, `slide_changed`, `stroke_added`, `stroke_undone`, `slide_cleared`, `all_cleared`, `pdf_loaded`

**Update `server.ts` WS handling:**
- On `hello`: set client role, send `state_sync` with current `AppState`

**Update `App.svelte`:**
- After auth: show role-selection screen (two buttons)
- After role selection: call `connect()`, then show main layout (placeholder for now)

**Test:**
1. Auth → role screen shows two buttons
2. Click either role → WS connects (verify in browser DevTools Network > WS)
3. Server logs the connection with role
4. Server sends `state_sync`; client receives it (verify with `console.log` in `ws-client.ts`)

---

### Step 7 — File Browser (`FileBrowser.svelte`)

**Goal:** Navigable server filesystem view; selecting a PDF broadcasts `load_pdf` to all clients.

**Create `FileBrowser.svelte`:**
- Fetches `GET /api/browse?path=<current>&token=<token>` on mount and on navigation
- Shows folders (clickable, navigates into) and PDF files (clickable, loads)
- "Back" button to go up (disabled at root)
- Folders first, then PDFs, alphabetically
- On PDF click: `send({ type: 'load_pdf', path: entry.path })`

**Server: handle `load_pdf` WS message:**
- Validate path is within root and ends in `.pdf`
- Add `pdf-parse` dependency; on `load_pdf`, call `pdf-parse` to get `numpages`, update `AppState`, broadcast `pdf_loaded`
- Broadcast `{ type: 'pdf_loaded', path, name: basename, pageCount }`

**Update `App.svelte`:**
- After role selection: if no active PDF → show `FileBrowser`; else show presenter view
- `FileBrowser` accessible via a "Change PDF" button in presenter view too

**Test:**
1. Open app, auth, select role → file browser appears
2. Navigate into subfolders and back
3. Click a PDF → file browser closes; annotator and second open tab both show the PDF name/page count
4. Opening a second browser tab: same PDF shown after role selection + auth

---

### Step 8 — PDF Rendering (`PdfViewer.svelte`)

**Goal:** Selected PDF is rendered in-browser with PDF.js; slide index comes from the `currentSlide` store.

**Create `PdfViewer.svelte`:**
- Import `pdfjs-dist`; set `GlobalWorkerOptions.workerSrc` to the worker URL
  — Copy `node_modules/pdfjs-dist/build/pdf.worker.min.mjs` to `client/public/pdf.worker.min.mjs` or use Vite asset import
- On `activePdfPath` change: fetch the PDF via `GET /api/pdf?path=<path>&token=<token>` as `ArrayBuffer`, call `pdfjsLib.getDocument({ data })`, store `PDFDocumentProxy`
- On `currentSlide` change: call `pdfDoc.getPage(slide + 1)`, render to `<canvas>` at scale to fill container
- Resize observer: re-render on container size change
- Show loading spinner while rendering

**Test:**
1. Select a PDF → it renders in the browser
2. Verify the canvas fills the available area
3. Verify page 1 is shown initially

---

### Step 9 — Slide Navigation + WebSocket Sync

**Goal:** Next/prev buttons on both devices; slide changes sync across all connected clients.

**Update `PdfViewer.svelte`:**
- Add "Previous" / "Next" buttons (disabled at boundaries)
- On click: `send({ type: 'slide_change', slide: newSlide })`
- Subscribe to `currentSlide` store to re-render

**Server: handle `slide_change`:**
- Update `AppState.currentSlide`
- Broadcast `{ type: 'slide_changed', slide }`

**`ws-client.ts`:** Handle `slide_changed` → update `currentSlide` store

**Test:**
1. Open two browser tabs, both auth and select roles
2. Click Next in one tab → both tabs advance to slide 2
3. Click Prev → both go back
4. Buttons disabled at first/last slide

---

### Step 10 — Annotation Canvas: Basic Freehand Ink (`AnnotationCanvas.svelte`)

**Goal:** Annotator device can draw freehand ink strokes with the mouse or Apple Pencil. Strokes rendered locally only (sync comes in Step 11).

**Create `AnnotationCanvas.svelte`:**
- `<canvas>` overlay on top of PdfViewer (absolute position, same size, `pointer-events: auto` for annotator, `none` for presenter)
- Use `pointerdown`, `pointermove`, `pointerup` events (handles both mouse and Apple Pencil)
- `pointerId` tracking for multi-touch safety; `setPointerCapture` on down
- On stroke end: push completed `AnnotationStroke` to local `annotations` store
- On `currentSlide` or `annotations` store change: re-render all strokes for current slide
- `drawStroke(ctx, stroke)` — renders a stroke based on its tool type (ink: `lineTo` path)
- Clear canvas on slide change before re-rendering
- Normalized coordinate helpers: `toNorm(e)` and `fromNorm(p, canvas)` — divide/multiply by canvas width/height

**Test:**
1. Open app as annotator, load a PDF
2. Draw with mouse → strokes appear on canvas
3. Change slide → canvas clears, previous slide strokes gone
4. Go back to previous slide → strokes reappear (from local store)

---

### Step 11 — Annotation Sync via WebSocket

**Goal:** Strokes drawn on annotator are broadcast to all clients; presenter sees them in real-time.

**`AnnotationCanvas.svelte` changes:**
- On stroke end: `send({ type: 'stroke_added', slide: currentSlide, stroke })`
- Do not add stroke to local store until server echoes it back (avoids duplicates)

**Server: handle `stroke_added`:**
- Append stroke to `AppState.annotations[slide]`
- Broadcast `{ type: 'stroke_added', slide, stroke }` to ALL clients (including sender)

**`ws-client.ts` handler for `stroke_added`:**
- Update `annotations` store: append stroke to the given slide's array

**Add read-only canvas to `PdfViewer.svelte` (for presenter role):**
- Receive `annotations` store; re-render strokes on canvas whenever they change

**Test:**
1. Open two tabs: one as annotator, one as presenter
2. Draw on annotator → strokes appear on presenter in real-time
3. Change slide on either → both advance; annotations persist per slide
4. New client connects mid-session → receives `state_sync` with all existing annotations

---

### Step 12 — Toolbar (`Toolbar.svelte`): Tool, Color, Thickness Selection

**Goal:** Annotator has a toolbar for selecting tool, color, and stroke thickness. Toolbar only visible to annotator.

**Create `Toolbar.svelte`:**
- Tool buttons: Ink, Highlighter, Arrow, Box, Eraser
- Color swatches: Orange, Red, Green, Yellow, Black, Gray (rendered as colored circles)
  — Highlighter forces color = Yellow (disable other colors when highlighter selected)
- Thickness: Thin, Medium, Thick (small circle icons)
- Active states visually highlighted
- Stores: `activeTool`, `activeColor`, `activeThickness` (writable stores in `stores.ts`)

**Update `App.svelte`:** Render `<Toolbar>` above/beside `<AnnotationCanvas>` for annotator role only.

**Update `AnnotationCanvas.svelte`:** Read `activeTool`, `activeColor`, `activeThickness` stores when creating strokes.

**Test:**
1. As annotator, toolbar is visible; as presenter, toolbar is hidden
2. Select red color, medium thickness → new strokes use those properties
3. Select Highlighter → color swatch switches to yellow only; strokes drawn have yellow color

---

### Step 13 — Highlighter + Shape Tools

**Goal:** Highlighter renders as semi-transparent yellow; arrow and box tools draw shapes on click-drag.

**Update `drawStroke(ctx, stroke)`:**
- **Ink:** solid line, `lineJoin: 'round'`, `lineCap: 'round'`, thickness px from preset
- **Highlighter:** same path but `globalAlpha: 0.3`, thick line, yellow
- **Arrow:** two points → draw line + arrowhead (compute angle, draw two lines at ±30°)
- **Box:** two points → `strokeRect` with the bounding rectangle

**Update `AnnotationCanvas.svelte`:**
- For Arrow/Box tools: `pointerdown` sets start point; `pointermove` draws a live preview; `pointerup` finalizes stroke with `points: [start, end]`

**Test:**
1. Draw with Highlighter → semi-transparent yellow band
2. Draw Arrow → click-drag produces an arrow
3. Draw Box → click-drag produces a rectangle
4. All shapes sync to presenter tab

---

### Step 14 — Undo, Eraser, Clear Operations

**Goal:** Full annotation editing: undo last stroke, erase by pointer hit, clear current or all slides.

**Eraser tool (`AnnotationCanvas.svelte`):**
- On `pointermove` with eraser active: find strokes whose paths come within N pixels of pointer
- On hit: `send({ type: 'stroke_removed', slide, strokeId })`
- For shape strokes: hit-test bounding box

**Add to toolbar:** Undo button, Clear Slide button, Clear All button (with confirmation for Clear All)

**`AnnotationCanvas.svelte`:** Undo → `send({ type: 'undo', slide: currentSlide })`

**Server: new message handlers:**
- `undo`: pop last stroke from `AppState.annotations[slide]`, broadcast `stroke_undone`
- `stroke_removed`: remove stroke by ID, broadcast `stroke_removed`
- `clear_slide`: clear `AppState.annotations[slide]`, broadcast `slide_cleared`
- `clear_all`: clear all annotations, broadcast `all_cleared`

**Update shared types:** Add `stroke_removed` to `ClientMessage` and `ServerMessage`.

**Test:**
1. Draw 3 strokes → Undo removes last one on both devices
2. Eraser tool → hover over stroke to erase it; disappears on both devices
3. Clear Slide → current slide blank; other slides intact
4. Clear All → all slides blank

---

### Step 15 — Annotation Persistence

**Goal:** Annotations auto-save to `[filename].annotations.json` next to the PDF; auto-load on PDF selection.

**Server (`server.ts`):**
- `annotationsPath(pdfPath)` → replace `.pdf` with `.annotations.json`
- `saveAnnotations()` — `fs.writeFileSync(path, JSON.stringify(annotations))`, called on every stroke mutation (debounced 100ms)
- On `load_pdf`: check if `.annotations.json` exists; if so, load into `AppState.annotations` and include in `pdf_loaded` broadcast

**Test:**
1. Load a PDF, draw strokes
2. Kill the server, restart it with the same root
3. Re-select the same PDF → annotations appear automatically
4. Select a PDF with no annotation file → blank canvas

---

### Step 16 — PDF Export (Flatten Annotations + Download)

**Goal:** Annotator can download the PDF with all annotations baked in.

**Add "Export PDF" button to `Toolbar.svelte`.**

**`client/src/export.ts`:**
1. For each page 1..pageCount:
   a. Render PDF page to offscreen `<canvas>` at 2× scale
   b. Draw strokes for that slide using `drawStroke` logic
   c. Export as PNG: `canvas.toDataURL('image/png')`
2. Use `pdf-lib` to create a new PDF: embed each PNG as a page image
3. Trigger download: `PDFDocument.save()` → `Uint8Array` → `Blob` → object URL → `<a download>` click

**Test:**
1. Load PDF, draw annotations on several slides
2. Click "Export PDF" → browser downloads a PDF file
3. Open downloaded PDF → annotations baked onto each page
4. Blank pages have no annotations

---

## Verification (End-to-End)

After all steps:

1. **Build check:** `npm run build` completes without errors
2. **Two-device test:** Open on laptop + iPad; both enter PIN; laptop picks Presenter, iPad picks Annotator
3. **Sync test:** Advance slide on iPad → laptop advances; draw on iPad → appears on laptop in real-time
4. **Persistence test:** Draw, restart server, reload same PDF → annotations restored
5. **Export test:** Draw on several slides, export → downloaded PDF has annotations baked in
6. **Security test:** `/api/browse` without token → 401; path traversal → 403

---

## Key Files Per Step

| Step | Files Created/Modified |
|------|------------------------|
| 1 | `package.json`, `client/vite.config.ts`, `client/tsconfig.json`, `tsconfig.server.json`, `client/index.html`, `client/src/main.ts`, `client/src/App.svelte` |
| 2 | `shared/types.ts` |
| 3 | `server.ts` |
| 4 | `server.ts` |
| 5 | `server.ts`, `client/src/App.svelte` |
| 6 | `server.ts`, `client/src/stores.ts`, `client/src/ws-client.ts`, `client/src/App.svelte` |
| 7 | `server.ts`, `client/src/FileBrowser.svelte`, `client/src/App.svelte` |
| 8 | `client/src/PdfViewer.svelte`, `client/public/pdf.worker.min.mjs` |
| 9 | `server.ts`, `client/src/PdfViewer.svelte`, `client/src/ws-client.ts` |
| 10 | `client/src/AnnotationCanvas.svelte` |
| 11 | `server.ts`, `client/src/AnnotationCanvas.svelte`, `client/src/ws-client.ts`, `client/src/PdfViewer.svelte` |
| 12 | `client/src/Toolbar.svelte`, `client/src/stores.ts`, `client/src/App.svelte`, `client/src/AnnotationCanvas.svelte` |
| 13 | `client/src/AnnotationCanvas.svelte` |
| 14 | `server.ts`, `shared/types.ts`, `client/src/AnnotationCanvas.svelte`, `client/src/Toolbar.svelte`, `client/src/ws-client.ts` |
| 15 | `server.ts` |
| 16 | `client/src/Toolbar.svelte`, `client/src/export.ts` (new) |
