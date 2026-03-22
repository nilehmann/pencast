# Plan: Screen Share Mode with GNOME Overlay

## Context

Add a new `"screen"` mode to pencast where the laptop shares its screen to the iPad via WebRTC, the iPad user draws annotations on top of the live video, and those annotations are rendered on a click-through GNOME Shell extension overlay on the laptop desktop. Annotations are ephemeral (not saved to disk). A fixed `cropTop` pixel value crops the GNOME top bar from the video shown on the iPad.

**Why GNOME Shell Extension?** Electron's click-through (`setIgnoreMouseEvents`) is broken on Wayland (issue #48064). `wlr-layer-shell` is not supported on GNOME. A GNOME Shell extension with a `reactive: false` Clutter actor is the only reliable approach.

**Role mapping:** iPad=Presenter (draws annotations), Laptop=Viewer (captures screen). This matches the HTML mode pattern: HtmlViewer (laptop) sources content, HtmlPresenter (iPad) draws on it.

---

## Architecture

```
iPad (Presenter)            pencast server              Laptop (Viewer)
  ScreenPresenter             relay WS msgs               ScreenViewer
  ├─ <video> (WebRTC)        ├─ WebRTC signaling relay    ├─ getDisplayMedia()
  ├─ AnnotationCanvas        ├─ screen annotations        ├─ RTCPeerConnection → iPad
  └─ draws strokes ──────►   │   (ephemeral, no disk)     └─ minimal status UI
                              │
                       GNOME Shell Extension
                         ├─ WebSocket client
                         └─ St.DrawingArea overlay
                             reactive: false (click-through)
                             maps norm coords → screen coords with cropTop offset
```

---

## Step 1: Add types to `shared/types.ts`

### Changes
- Extend `BaseMode`: `"pdf" | "html" | "screen"`
- Extend `AnnotationSource`: `"pdf" | "whiteboard" | "html" | "screen"`
- Add `ScreenState`:
  ```ts
  export interface ScreenState {
    annotations: AnnotationMap;  // keyed by slide 0 always
  }
  ```
- Extend `AppState`:
  ```ts
  activeScreen: ScreenState | null;
  cropTop: number;
  ```
- Add to `ClientMessage`:
  ```ts
  | { type: "webrtc_offer"; sdp: string }
  | { type: "webrtc_answer"; sdp: string }
  | { type: "webrtc_ice"; candidate: RTCIceCandidateInit }
  ```
- Add to `ServerMessage`:
  ```ts
  | { type: "webrtc_offer_relay"; sdp: string }
  | { type: "webrtc_answer_relay"; sdp: string }
  | { type: "webrtc_ice_relay"; candidate: RTCIceCandidateInit }
  ```
- Extend `mode_changed` ServerMessage to include `activeScreen?: ScreenState | null`
- Add `set_mode` support: `{ type: "set_mode"; mode: BaseMode }` already accepts `BaseMode`, so adding `"screen"` to `BaseMode` is sufficient.

### How to test
`npm run typecheck` — must pass. No runtime changes yet.

---

## Step 2: Server — screen mode + WebRTC relay (`server.ts`)

### Changes
- Parse `--crop-top N` CLI arg (alongside existing `--host`). Also read `PENCAST_CROP_TOP` env var. Default: 0.
- Init `appState.activeScreen = null` and `appState.cropTop = CROP_TOP`.
- Add `const screenUndoStack: UndoEntry[] = []`.
- Add `"screen"` case to `resolveSource()`:
  ```ts
  case "screen": {
    const screen = appState.activeScreen;
    if (!screen) return null;
    return {
      annotations: screen.annotations,
      undoStack: screenUndoStack,
      save: () => {},  // no-op: ephemeral, never written to disk
    };
  }
  ```
- Handle `set_mode` for `"screen"`:
  - Set `appState.activeMode = { base: "screen", whiteboard: false }`
  - Set `appState.activeScreen = { annotations: {} }`
  - Clear `screenUndoStack`
  - Broadcast `mode_changed` including `activeScreen`
- Handle exiting screen mode (when `set_mode` changes to `"pdf"` or `"html"`):
  - Set `appState.activeScreen = null`
- Add WebRTC relay cases in the message switch:
  ```
  "webrtc_offer"  → broadcast { type: "webrtc_offer_relay",  sdp } (exclude sender)
  "webrtc_answer" → broadcast { type: "webrtc_answer_relay", sdp } (exclude sender)
  "webrtc_ice"    → broadcast { type: "webrtc_ice_relay", candidate } (exclude sender)
  ```
- Ensure `state_sync` includes `activeScreen` and `cropTop` (it already sends full `appState`).

### How to test
Start server with `--crop-top 32`. Connect via wscat. Send `{"type":"set_mode","mode":"screen"}`. Verify `mode_changed` received with `activeMode.base === "screen"` and `activeScreen` present. Send a `strokes_added` with `source: "screen"` and verify it's broadcast. Verify no `.annotations.json` file is created.

---

## Step 3: Client stores + ws-client

### `client/src/stores.svelte.ts`

- Add state fields:
  ```ts
  activeScreen = $state<ScreenState | null>(null);
  cropTop = $state(0);
  ```
- `applyState()`: add `this.activeScreen = state.activeScreen ?? null; this.cropTop = state.cropTop ?? 0;`
- `activeSource()`: handle screen mode — `if (m.base === "screen") return "screen";` (before whiteboard check? No — whiteboard flag takes precedence, but `set_mode("screen")` should set `whiteboard: false`. Still, add it: `if (m.base === "screen" && !m.whiteboard) return "screen"`).
- `activeContext()`: add `"screen"` branch:
  ```ts
  if (m.base === "screen") {
    const screen = this.activeScreen;
    return {
      source: "screen" as const,
      slide: 0,
      get strokes() { if (!screen) return []; screen.annotations[0] ??= []; return screen.annotations[0]; },
      set strokes(ann) { if (screen) screen.annotations[0] = ann; },
    };
  }
  ```
- `activePageCount()`: return 1 for screen mode.
- `patchAnnotations()`: add `"screen"` branch:
  ```ts
  else if (source === "screen") {
    if (!this.activeScreen) return;
    this.activeScreen.annotations[slide] = fn(this.activeScreen.annotations[slide] ?? []);
  }
  ```
- `clearScreen()`: `if (this.activeScreen) { this.activeScreen.annotations = {}; }`
- `logout()`: add `this.activeScreen = null;`

### `client/src/ws-client.ts`

- In `mode_changed` handler: add screen handling:
  ```ts
  if (msg.activeMode.base === "screen" && msg.activeScreen) {
    stores.activeScreen = msg.activeScreen;
  } else {
    stores.activeScreen = null;
  }
  ```
- In `slide_changed` handler: add `"screen"` case (no-op since screen has no slides, but prevents falling through to the pdf branch):
  ```ts
  else if (msg.source === "screen") { /* no-op */ }
  ```
- In `all_cleared` handler: add `"screen"` case → `stores.clearScreen()`
- Add `offMessage()` function (or make `onMessage` return an unsubscribe function):
  ```ts
  export function offMessage(type: string): void {
    handlers.delete(type);
  }
  ```
  This is needed so ScreenViewer/ScreenPresenter can clean up their WebRTC relay handlers on unmount.

### How to test
`npm run typecheck` passes. Connect, enter screen mode via server, verify `stores.activeScreen` is populated. Draw a stroke with `source: "screen"`, verify `patchAnnotations` updates correctly.

---

## Step 4: ScreenViewer — screen capture component (`client/src/ScreenViewer.svelte`, NEW)

Runs on the **Viewer** role (laptop). Captures the screen and streams to the iPad.

### Responsibilities
1. On mount: `navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 }, width: { ideal: 1920 } }, audio: false })`
2. Create `RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] })` — empty `iceServers: []` for offline LAN use.
3. Add video track from stream to peer connection.
4. Collect ICE candidates → `send({ type: "webrtc_ice", candidate })`.
5. Create SDP offer → set local description → `send({ type: "webrtc_offer", sdp })`.
6. Register `onMessage("webrtc_answer_relay")` → set remote description.
7. Register `onMessage("webrtc_ice_relay")` → add ICE candidate.
8. Show a small `<video muted autoplay>` preview + "Screen sharing active" status.
9. On destroy: close RTCPeerConnection, stop all tracks, call `offMessage` for all registered handlers.

### Template
```svelte
<div class="screen-source">
  <video bind:this={videoEl} muted autoplay playsinline style="max-width: 100%; max-height: 100%;"></video>
  <p>Screen sharing active</p>
</div>
```

No AnnotationCanvas needed on this side — annotations are rendered by the GNOME extension.

### How to test
Set iPad to presenter, laptop to viewer. Enter screen mode. Laptop browser prompts for screen selection. After selecting, local video preview shows the captured screen.

---

## Step 5: ScreenPresenter — video + annotations (`client/src/ScreenPresenter.svelte`, NEW)

Runs on the **Presenter** role (iPad). Receives video and draws annotations.

### Responsibilities
1. Create `RTCPeerConnection`.
2. Register `onMessage("webrtc_offer_relay")` → set remote description → create answer → set local description → `send({ type: "webrtc_answer", sdp })`.
3. Collect ICE candidates → `send({ type: "webrtc_ice", candidate })`.
4. Register `onMessage("webrtc_ice_relay")` → add ICE candidate.
5. `pc.ontrack` → `videoEl.srcObject = event.streams[0]`.
6. On `loadedmetadata`: read `videoEl.videoWidth / videoEl.videoHeight` to set the container's aspect ratio. This prevents letterboxing and ensures AnnotationCanvas normalization is correct.
7. Apply cropTop: CSS `clip-path: inset(${cropTopPercent}% 0 0 0)` where `cropTopPercent = (cropTop / videoHeight) * 100`. Also adjust the container height to exclude the cropped region.
8. `<AnnotationCanvas sourceCanvas={containerDiv} />` — writable, the presenter draws here.
9. On destroy: close RTCPeerConnection, call `offMessage` for all registered handlers.

### Aspect ratio handling
The video element must NOT use `object-fit: contain` (which causes letterboxing). Instead:
- Read intrinsic video dimensions from `videoEl.videoWidth/Height` on `loadedmetadata`
- Calculate effective dimensions after crop: `effectiveHeight = videoHeight - cropTop`
- Set container aspect ratio: `aspect-ratio: videoWidth / effectiveHeight`
- Use `object-fit: cover` or `object-fit: fill` with a precisely-sized container

### cropTop as a percentage
Since the iPad receives `cropTop` in pixels (relative to the captured screen), and the video is scaled down, we convert to a percentage of the video's intrinsic height: `cropPercent = cropTop / videoEl.videoHeight`.

### Template structure
```svelte
<div class="screen-container" bind:this={container} style="aspect-ratio: {aspectRatio};">
  <video bind:this={videoEl} autoplay playsinline
    style="margin-top: -{cropPercent * 100}%; width: 100%;" />
  <AnnotationCanvas sourceCanvas={container} />
</div>
```

### How to test
With screen mode active and video streaming: verify video appears on iPad. Verify no letterboxing (container matches video aspect ratio). Verify cropTop removes the top bar. Draw a stroke — verify it appears locally and is sent to the server via WebSocket.

---

## Step 6: Routing + UI integration

### `client/src/SlideView.svelte`
Add screen mode branch at the top:
```svelte
{#if stores.activeMode.base === "screen" && !stores.activeMode.whiteboard}
  {#if stores.deviceRole === "viewer"}
    <ScreenViewer />
  {:else}
    <ScreenPresenter cropTop={stores.cropTop} />
  {/if}
{:else if stores.activeMode.base === "html" && !stores.activeMode.whiteboard}
  ...existing...
```

### `client/src/App.svelte`
- Add `let isScreenMode = $derived(stores.activeMode.base === "screen");`
- Show Toolbar for presenter in screen mode: change condition from `(pdfPath || isHtmlMode)` to `(pdfPath || isHtmlMode || isScreenMode)`.
- Add "Start Screen Share" button (viewer role only, when not already in screen mode):
  ```svelte
  {#if role === "viewer" && !isScreenMode && !isHtmlMode}
    <button class="screen-share-fab" onclick={() => send({ type: "set_mode", mode: "screen" })}>
      Screen Share
    </button>
  {/if}
  ```
- Add "Exit Screen Share" button (when in screen mode):
  ```svelte
  {#if isScreenMode}
    <button class="exit-html-fab" onclick={() => send({ type: "set_mode", mode: "pdf" })}>
      ← Exit Screen Share
    </button>
  {/if}
  ```
- Disable slide navigation in screen mode:
  - `isSwipeBlocked()`: add `|| isScreenMode` to the blocked condition.
  - `handleGlobalKeydown()`: add `else if (isScreenMode) { /* no-op */ }` before the existing navigation branches.
- Auto-close browsers when entering screen mode (similar to HTML mode effect).
- SlidePreview: add `&& !isScreenMode` to visibility condition.

### `client/src/navigation.ts`
No changes needed — screen mode doesn't call any navigation functions.

### `client/src/NavFab.svelte`
The "Screen Share" button could alternatively go here instead of App.svelte. Check the existing NavFab to see what fits better. The "Load HTML" button is in NavFab, so "Screen Share" should be too for consistency.

### How to test
Full flow:
1. Open laptop browser as viewer, iPad browser as presenter
2. Laptop: click "Screen Share" in NavFab
3. Laptop: browser prompts for screen capture → select screen
4. iPad: video appears (with crop applied if `--crop-top` set)
5. iPad: toolbar visible, can draw annotations
6. iPad: draw a stroke → appears locally on video
7. Laptop: "Exit Screen Share" exits back to PDF mode
8. Run `npm run typecheck` — 0 errors

---

## Step 7: GNOME Shell Extension — WebSocket client

### File structure
```
gnome-extension/pencast-overlay@pencast/
  extension.js      — enable/disable entry point
  metadata.json     — extension metadata
  lib/
    ws.js           — WebSocket client (GJS Soup3 or WebSocket global)
    renderer.js     — St.DrawingArea overlay actor
    draw-cairo.js   — Cairo port of draw.ts
    perfect-freehand.js — vendored bundle (built by esbuild)
```

### Build step (add to root `package.json`)
```json
"build:gnome-freehand": "esbuild node_modules/perfect-freehand/src/index.ts --bundle --format=esm --outfile=gnome-extension/pencast-overlay@pencast/lib/perfect-freehand.js"
```

### `metadata.json`
```json
{
  "name": "Pencast Overlay",
  "description": "Click-through annotation overlay for pencast screen share mode",
  "uuid": "pencast-overlay@pencast",
  "shell-version": ["45", "46", "47", "48"],
  "version": 1
}
```

### `lib/ws.js` — PencastClient
- Connects to `ws://localhost:3001/ws`
- Auto-reconnect with 3s delay on close
- Handles messages:
  - `state_sync` → extract `activeMode`, `activeScreen`, `cropTop`, `activePendingStroke`
  - `mode_changed` → update visibility (show only when `activeMode.base === "screen"`)
  - `strokes_added` (source=screen) → add finalized strokes
  - `strokes_removed` (source=screen) → remove strokes by ID
  - `strokes_updated` (source=screen) → replace strokes
  - `stroke_begin` (source=screen) → start pending stroke preview
  - `stroke_point` (source=screen) → append points to pending stroke
  - `stroke_abandon` (source=screen) → discard pending stroke
  - `stroke_undone` (source=screen) → remove stroke by ID
  - `all_cleared` (source=screen) → clear everything
  - `slide_cleared` (source=screen, slide=0) → clear everything

### How to test
Enable extension, start pencast server in screen mode, check GNOME Shell logs (`journalctl -f /usr/bin/gnome-shell`) for connection and message logs.

---

## Step 8: GNOME Shell Extension — overlay rendering

### `lib/renderer.js` — OverlayActor

```js
class OverlayActor extends St.DrawingArea {
  #strokes = new Map();        // finalized strokes: id → AnnotationStroke
  #pendingStrokes = new Map(); // in-progress strokes: strokeId → {tool, color, thickness, points}
  #cropTop = 0;

  constructor(cropTop) {
    const monitor = Main.layoutManager.primaryMonitor;
    super({
      x: monitor.x, y: monitor.y,
      width: monitor.width, height: monitor.height,
      reactive: false,  // click-through
      visible: false,
    });
    this.#cropTop = cropTop;
    this.connect('repaint', (_, cr) => this.#paint(cr));
  }
}
```

- `addStrokes(strokes)`, `removeStrokes(ids)`, `clearAll()`: update `#strokes`, call `queue_repaint()`
- `setPendingStroke(id, data)`, `removePendingStroke(id)`: update `#pendingStrokes`, call `queue_repaint()`
- `setCropTop(n)`: update offset
- `#paint(cr)`: clear canvas, then for each stroke call `drawStrokeCairo(cr, stroke, w, h, cropTop)`

### Coordinate mapping
Annotations are normalized 0-1 relative to the cropped video area on the iPad. On the desktop overlay (full screen):
```
screenX = normX * screenWidth
screenY = cropTop + normY * (screenHeight - cropTop)
```

The `drawStrokeCairo` function receives `cropTop` and applies this mapping when converting normalized points to pixel coordinates:
```js
const px = (x) => x * w;
const py = (y) => cropTop + y * (h - cropTop);
```

### `lib/draw-cairo.js` — Cairo port of `client/src/draw.ts`

Port each tool type from Canvas 2D to Cairo:

| Canvas 2D | Cairo |
|---|---|
| `ctx.beginPath()` | implicit (new path on `cr.newPath()`) |
| `ctx.moveTo(x, y)` | `cr.moveTo(x, y)` |
| `ctx.lineTo(x, y)` | `cr.lineTo(x, y)` |
| `ctx.quadraticCurveTo(cpx, cpy, x, y)` | `cr.curveTo(cpx, cpy, cpx, cpy, x, y)` (quadratic→cubic, CP duplicated) |
| `ctx.arc(x, y, r, a1, a2)` | `cr.arc(x, y, r, a1, a2)` |
| `ctx.fill()` | `cr.fill()` |
| `ctx.stroke()` | `cr.stroke()` |
| `ctx.fillStyle = color` | `cr.setSourceRGBA(r, g, b, a)` |
| `ctx.lineWidth = w` | `cr.setLineWidth(w)` |
| `ctx.lineCap = "round"` | `cr.setLineCap(Cairo.LineCap.ROUND)` |
| `ctx.lineJoin = "round"` | `cr.setLineJoin(Cairo.LineJoin.ROUND)` |
| `ctx.globalAlpha = 0.3` | `cr.setSourceRGBA(r, g, b, 0.3)` |
| `ctx.setLineDash([a, b])` | `cr.setDash([a, b], 0)` |
| `ctx.save()/restore()` | `cr.save()/restore()` |
| `ctx.translate(x, y)` | `cr.translate(x, y)` |
| `ctx.rotate(angle)` | `cr.rotate(angle)` |

Tools to port (reference: `client/src/draw.ts`):
- **ink / pointer**: getStroke() from perfect-freehand → filled outline polygon via curveTo
- **highlighter**: same as ink but with 30% opacity, yellow color, no thinning
- **line**: moveTo → lineTo → stroke
- **arrow**: line + two arrowhead prongs
- **box**: save → translate → rotate → rectangle → stroke → restore
- **ellipse**: arc/ellipse → stroke

Only render finalized strokes and pending stroke previews. No selection handles, no ripples, no lasso — the overlay is display-only.

### `extension.js` — Entry point

```js
export function enable() {
  overlayActor = new OverlayActor(cropTop);
  Main.uiGroup.add_child(overlayActor);

  client = new PencastClient('ws://localhost:3001/ws');
  client.onStrokesAdded = (strokes) => overlayActor.addStrokes(strokes);
  client.onStrokesRemoved = (ids) => overlayActor.removeStrokes(ids);
  client.onPendingStroke = (id, data) => overlayActor.setPendingStroke(id, data);
  client.onPendingStrokeRemoved = (id) => overlayActor.removePendingStroke(id);
  client.onAllCleared = () => overlayActor.clearAll();
  client.onModeChanged = (mode, cropTop) => {
    overlayActor.visible = mode.base === 'screen';
    overlayActor.setCropTop(cropTop);
    if (mode.base !== 'screen') overlayActor.clearAll();
  };
  client.connect();
}

export function disable() {
  client?.disconnect();
  overlayActor?.destroy();
}
```

### How to test
1. Enter screen mode from the browser
2. Draw a stroke on the iPad
3. Verify the stroke appears on the desktop overlay
4. Verify clicking on desktop apps goes through the overlay (click-through)
5. Draw multiple tool types (ink, line, arrow, box, ellipse, highlighter)
6. Verify live stroke preview (appears while finger is still down)
7. Undo → stroke disappears from overlay
8. Exit screen mode → overlay hides

---

## Step 9: Extension installation + preferences

### `prefs.js`
Optional preferences panel for:
- Server URL (default: `ws://localhost:3001/ws`)
- Manual cropTop override (if not relying on server value)

### Installation
```sh
# Symlink for development
ln -s $(pwd)/gnome-extension/pencast-overlay@pencast ~/.local/share/gnome-shell/extensions/pencast-overlay@pencast

# Or install from zip
gnome-extensions install pencast-overlay@pencast.zip
```

Add a script to `package.json`:
```json
"install:gnome": "ln -sfn $(pwd)/gnome-extension/pencast-overlay@pencast ~/.local/share/gnome-shell/extensions/pencast-overlay@pencast"
```

### How to test
Run `npm run install:gnome`. Enable extension: `gnome-extensions enable pencast-overlay@pencast`. Verify it appears in Extensions app. Alt+F2 → `r` (X11) or log out/in (Wayland) to reload.

---

## Known limitations (v1)

- **Single monitor only**: the overlay covers `Main.layoutManager.primaryMonitor`. Multi-monitor support would require tracking which monitor was captured.
- **No reconnection of WebRTC on WS reconnect**: if the WebSocket drops and reconnects, the WebRTC peer connection is not automatically re-established. The user must exit and re-enter screen mode. (Can be improved later by having ScreenPresenter send a `webrtc_request` message on mount, and ScreenViewer responding with a fresh offer.)
- **Eraser tool**: eraser works via hit-testing and `strokes_removed` messages, which the extension handles. No special eraser rendering needed.
- **No screen audio**: `audio: false` in `getDisplayMedia()`.

---

## Full file change summary

### Modified files
| File | Changes |
|---|---|
| `shared/types.ts` | Add `"screen"` to BaseMode + AnnotationSource; add ScreenState; extend AppState; add WebRTC message types |
| `server.ts` | cropTop CLI arg; resolveSource("screen") with no-op save; screenUndoStack; WebRTC relay cases; handle set_mode "screen" |
| `client/src/stores.svelte.ts` | activeScreen + cropTop state; activeContext/patchAnnotations/clearScreen/applyState/logout for "screen" |
| `client/src/ws-client.ts` | mode_changed screen handling; slide_changed/all_cleared screen cases; offMessage() function |
| `client/src/SlideView.svelte` | Add screen mode branch → ScreenViewer (viewer) / ScreenPresenter (presenter) |
| `client/src/App.svelte` | Screen Share FAB; Exit button; toolbar for screen mode; disable nav in screen mode |

### New files
| File | Purpose |
|---|---|
| `client/src/ScreenViewer.svelte` | Laptop (viewer): getDisplayMedia + WebRTC offer + status UI |
| `client/src/ScreenPresenter.svelte` | iPad (presenter): WebRTC answer + video + AnnotationCanvas |
| `gnome-extension/pencast-overlay@pencast/extension.js` | GNOME extension entry point |
| `gnome-extension/pencast-overlay@pencast/metadata.json` | Extension metadata |
| `gnome-extension/pencast-overlay@pencast/lib/ws.js` | GJS WebSocket client |
| `gnome-extension/pencast-overlay@pencast/lib/renderer.js` | St.DrawingArea overlay actor |
| `gnome-extension/pencast-overlay@pencast/lib/draw-cairo.js` | Cairo port of draw.ts |
| `gnome-extension/pencast-overlay@pencast/lib/perfect-freehand.js` | Vendored bundle |
