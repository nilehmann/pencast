# Pencast — Project Summary

## Overview
A self-hosted, offline-capable web app for delivering PDF slide presentations across two devices (laptop + iPad), with live pen annotation support.

---

## Infrastructure

- **Server:** Minimal Node.js (`server.ts`) — static file server + WebSocket server, written in **TypeScript** (compiled via `ts-node` or `tsx` for development, `tsc` for production)
- **Network:** Runs on local WiFi — no internet required after setup
- **Access:** Both devices open `http://[laptop-ip]:3000` in their browser
- **Startup:** `tsx server.ts /path/to/pdfs` (development) or `node dist/server.js /path/to/pdfs` (production) from the terminal on the laptop

---

## PDF Loading

- PDFs are selected via a **server-side file browser** in the browser UI
- The file browser lets users navigate the server's filesystem (folders and files)
- Only `.pdf` files are selectable; folders are navigable
- The server streams the selected PDF to all connected clients — the PDF binary is **not uploaded from a client device**
- The server holds a single active PDF — all connected devices always show the same PDF
- Selecting a new PDF from the file browser replaces it for everyone, exactly as uploading did previously
- Rendering is handled entirely in-browser using **PDF.js**

### File Browser Behavior
- The root path is passed as a command-line argument at startup: `tsx server.ts /path/to/pdfs`
- The server refuses to start if no root path is provided or if the path does not exist
- The file browser opens at the configured root — users cannot navigate above it
- Displays folders and `.pdf` files; non-PDF files are hidden
- Folders are navigable (click to enter, back button to go up)
- Selecting a PDF immediately loads it as the active PDF for all connected clients

### Server API for File Browser
- `GET /api/browse?path=<dir>` — returns directory listing (folders + PDF files) for the given path
- `GET /api/pdf?path=<filepath>` — streams the selected PDF file to the client
- Paths are resolved relative to the filesystem root; the server validates that paths don't escape the configured root

---

## Slide Control

- Slide navigation is **synced across both devices** via WebSocket
- Advancing or going back on either device moves both simultaneously

---

## Device Roles

| Device | Role |
|--------|------|
| **iPad** | Annotation device — full drawing tools, slide control, file browser access |
| **Laptop** | Presenter view — read-only mirror of current slide + annotations, no drawing tools |

---

## Annotations

Drawn on the iPad (Apple Pencil), mirrored live to the laptop in real-time via WebSocket.

### Supported tools:
- Freehand ink / drawing
- Highlighter
- Shapes: arrows, boxes

### Editing:
- **Undo:** removes the last stroke (gesture or button based)
- **Eraser:** erase individual strokes
- **Clear current slide:** removes all annotations on the current slide only
- **Clear all slides:** removes all annotations across the entire PDF

### Persistence:
- **In-session:** annotations held in server memory, synced to all devices via WebSocket
- **Auto-save:** written to disk as `[filename].annotations.json` next to the PDF on the server filesystem, on every annotation change
- **On load:** if a matching `.annotations.json` file exists next to the PDF, it is loaded automatically with no prompt

---

## Export

- Annotated PDF can be exported (annotations flattened onto pages) and **downloaded directly to whichever device initiates the action**
- Uses PDF.js canvas rendering + client-side PDF generation

---

## Tech Stack Summary

| Layer | Technology |
|-------|------------|
| Server | Node.js + TypeScript (`tsx` for dev, `tsc` for prod) |
| Real-time sync | WebSockets (native `ws` library) |
| PDF rendering | PDF.js (in-browser) |
| Annotation canvas | HTML5 Canvas |
| PDF export | Client-side canvas flattening |
| File browser | Server REST API + Svelte component |
| Frontend framework | Svelte + TypeScript (compiled via Vite) |
| Styling | Scoped CSS (Svelte built-in) |

---

## Client-Side Architecture

### Framework: Svelte + TypeScript + Vite

The frontend is built with **Svelte** and **TypeScript**, compiled by **Vite**. The build output is a static bundle (`dist/`) served by the existing `server.ts` as static files — no change to the server architecture is required.

**Why Svelte for this app:**
- Compiles to minimal vanilla JavaScript (~1.6 KB runtime vs React's ~42 KB) — important for the iPad, which is simultaneously rendering a PDF canvas and an annotation canvas
- Reactive bindings and stores map naturally to WebSocket-driven shared state (current slide, active PDF, annotation strokes)
- Scoped CSS per component, no CSS-in-JS needed
- Fully compatible with vanilla JS libraries — PDF.js integrates without any wrapper
- Simple syntax close to plain HTML/CSS/JS; minimal boilerplate for a project of this scope
- First-class TypeScript support via Vite — all `.svelte` components use `<script lang="ts">`

**Development workflow:**
- `npm run dev` — Vite dev server with hot reload (for development)
- `npm run build` — produces a static `dist/client/` bundle
- `tsx server.ts` — serves `dist/client/` as static files alongside the WebSocket and REST API

### Shared Types

A `shared/types.ts` module defines TypeScript interfaces used by both the server and client, ensuring consistency across the WebSocket protocol and REST API:

- `WebSocketMessage` — discriminated union of all WS message types (slide change, annotation update, PDF load, etc.)
- `DirectoryEntry` — shape of file/folder items returned by `/api/browse`
- `AnnotationStroke` — structure of a single drawn stroke (tool, color, thickness, points)
- `AppState` — server-held session state (active PDF path, current slide, all annotations)

### Component Structure

| Component | Responsibility |
|-----------|---------------|
| `App.svelte` | Top-level shell; PIN authentication gate, routes between FileBrowser and Presenter views |
| `FileBrowser.svelte` | Navigable server filesystem view; fetches `/api/browse`, triggers PDF load on selection |
| `PdfViewer.svelte` | PDF.js rendering; receives current slide index from shared store |
| `AnnotationCanvas.svelte` | HTML5 Canvas overlay; handles Apple Pencil input (iPad only), emits strokes via WebSocket |
| `Toolbar.svelte` | Drawing tool selector, color/thickness picker, undo/clear/export controls (iPad only) |

All components use `<script lang="ts">` for full TypeScript support.

### State Management

Svelte's built-in **stores** manage all shared client state — no third-party state library needed:

- `currentSlide` — integer, synced via WebSocket
- `activePdf` — filename + total page count, set on PDF load
- `annotations` — per-slide stroke arrays, synced via WebSocket and persisted server-side
- `deviceRole` — `"presenter"` (laptop) or `"annotator"` (iPad), determined at connect time

### Styling

Svelte's scoped CSS handles per-component styles. A small global stylesheet covers layout, typography, and the two device-specific view modes (full annotation toolbar on iPad; clean read-only view on laptop). No external CSS framework is used, keeping the bundle lean.

---

## Annotation Tools Detail

### Colors available:
Orange, Red, Green, Yellow, Black, Gray

### Stroke thickness:
Three presets — **Thin**, **Medium**, **Thick**

### Tools × color/thickness:
- Freehand ink — all colors, all thicknesses
- Highlighter — **yellow only** (semi-transparent), all thicknesses
- Shapes (arrows, boxes) — all colors, all thicknesses

---

## PDF Management

- **One PDF per session** — no library view needed
- Select a new PDF via the file browser to replace the current one for all devices

---

## Access Control

- A **simple PIN/password** is required to access the app
- Protects against unintended connections from others on the same WiFi
- PIN configured in `server.ts` before starting the server
