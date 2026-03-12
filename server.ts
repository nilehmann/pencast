import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createHmac } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { WebSocketServer, WebSocket } from "ws";
import type {
  AppState,
  AnnotationSource,
  AnnotationStroke,
  AnnotationTool,
  AnnotationMap,
  AnnotationsFile,
  HtmlAnnotationsFile,
  ActiveMode,
  BaseMode,
  ClientAsset,
  ClientMessage,
  DirectoryEntry,
  ServerMessage,
  StrokeColor,
  StrokeThickness,
  NormalizedPoint,
} from "./shared/types.ts";
let clientAssets: Map<string, ClientAsset> | null = null;
try {
  clientAssets = (await import("./generated/client-assets.js")).clientAssets;
} catch {
  // dev mode: generated/client-assets.ts not present, will serve from disk
}

// --- CLI arg validation ---
if (!process.argv[2]) {
  console.error("Usage: tsx server.ts <pdf-root-dir>");
  process.exit(1);
}
const PDF_ROOT = path.resolve(process.argv[2] ?? "");
if (!fs.existsSync(PDF_ROOT)) {
  console.error(`Error: path does not exist: ${PDF_ROOT}`);
  process.exit(1);
}

const CLIENT_DIR = path.join(import.meta.dirname, "dist", "client");
const PORT = 3001;
const PIN = process.env["PIN"] ?? "1234";

// --- Annotation persistence ---
function isPdf(name: string): boolean {
  return name.toLowerCase().endsWith(".pdf");
}

function isHtml(name: string): boolean {
  return name.toLowerCase().endsWith(".html");
}

function isAnnotations(name: string): boolean {
  return name.toLowerCase().endsWith(".annotations.json");
}

function annotationsPath(absPdfPath: string): string {
  return absPdfPath.replace(/\.pdf$/i, ".annotations.json");
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function saveAnnotations(): void {
  if (!appState.activePdfPath) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const fileData: AnnotationsFile = {
        annotations: appState.annotations,
        whiteboardAnnotations: appState.whiteboardAnnotations,
        whiteboardPageCount: appState.whiteboardPageCount,
      };
      fs.writeFileSync(
        annotationsPath(fromRootRelative(appState.activePdfPath!)),
        JSON.stringify(fileData),
      );
    } catch (e) {
      console.error("Failed to save annotations:", e);
    }
  }, 100);
}
function htmlAnnotationsPath(absHtmlPath: string): string {
  return absHtmlPath + ".annotations.json";
}

let htmlSaveTimer: ReturnType<typeof setTimeout> | null = null;
function saveHtmlAnnotations(): void {
  if (!appState.htmlPath) return;
  if (htmlSaveTimer) clearTimeout(htmlSaveTimer);
  htmlSaveTimer = setTimeout(() => {
    try {
      const fileData: HtmlAnnotationsFile = {
        htmlAnnotations: appState.htmlAnnotations,
        htmlPageCount: appState.htmlPageCount,
      };
      fs.writeFileSync(
        htmlAnnotationsPath(fromRootRelative(appState.htmlPath!)),
        JSON.stringify(fileData),
      );
    } catch (e) {
      console.error("Failed to save HTML annotations:", e);
    }
  }, 100);
}

const AUTH_SECRET = process.env["AUTH_SECRET"] ?? "dev-secret";

// --- Auth ---
function generateToken(pin: string): string {
  return createHmac("sha256", AUTH_SECRET).update(pin).digest("hex");
}

function isAuthenticated(req: http.IncomingMessage, url: URL): boolean {
  const token = url.searchParams.get("token") ?? req.headers["x-auth-token"];
  if (typeof token !== "string") return false;
  return token === generateToken(PIN);
}

// --- In-memory state ---
const appState: AppState = {
  activePdfPath: null,
  activePdfName: null,
  pageCount: 0,
  currentSlide: 0,
  annotations: {},
  activeMode: { base: "pdf", whiteboard: false } as ActiveMode,
  whiteboardSlide: 0,
  whiteboardPageCount: 1,
  whiteboardAnnotations: {},
  htmlPath: null,
  htmlAnnotations: {},
  htmlSlide: 0,
  htmlPageCount: 1,
  latestHtmlDom: null,
};

let activePendingStroke: {
  strokeId: string;
  source: AnnotationSource;
  slide: number;
  tool: AnnotationTool;
  color: StrokeColor;
  thickness: StrokeThickness;
  points: NormalizedPoint[];
} | null = null;

// --- Undo stack ---
type UndoEntry =
  | { type: "remove_many"; slide: number; strokeIds: string[] }
  | { type: "restore"; slide: number; strokes: AnnotationStroke[] }
  | {
      type: "reinsert";
      slide: number;
      strokes: AnnotationStroke[];
      indices: number[];
    };

const pdfUndoStack: UndoEntry[] = [];
const whiteboardUndoStack: UndoEntry[] = [];
const htmlUndoStack: UndoEntry[] = [];

function activeUndoStack(source: AnnotationSource): UndoEntry[] {
  if (source === "html") return htmlUndoStack;
  return source === "whiteboard" ? whiteboardUndoStack : pdfUndoStack;
}

// --- MIME types ---
const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".pdf": "application/pdf",
};

// --- HTTP server ---
const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // Route API requests
  if (pathname.startsWith("/api/")) {
    handleApi(req, res, url);
    return;
  }

  // Static file serving with SPA fallback
  if (clientAssets !== null) {
    // Bundled mode: serve from embedded assets
    const asset =
      clientAssets.get(pathname) ?? clientAssets.get("/index.html")!;
    res.writeHead(200, { "Content-Type": asset.contentType });
    res.end(asset.data);
    return;
  }

  // Dev mode: serve from dist/client/ on disk
  let filePath = path.join(CLIENT_DIR, pathname);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(CLIENT_DIR, "index.html");
  }
  const ext = path.extname(filePath);
  const contentType = MIME[ext] ?? "application/octet-stream";
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
});

// --- Path security ---
function isWithinRoot(filePath: string): boolean {
  return filePath === PDF_ROOT || filePath.startsWith(PDF_ROOT + path.sep);
}

/** Resolve a root-relative path to an absolute path. */
function fromRootRelative(relPath: string): string {
  return path.join(PDF_ROOT, relPath);
}

/** Convert an absolute path to a root-relative path. */
function toRootRelative(absPath: string): string {
  return path.relative(PDF_ROOT, absPath);
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  data: unknown,
): void {
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body);
}

// --- API handler ---
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function handleApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
): void {
  const pathname = url.pathname;

  // POST /api/auth — unauthenticated
  if (req.method === "POST" && pathname === "/api/auth") {
    readBody(req)
      .then((body) => {
        let pin: string | undefined;
        try {
          pin = (JSON.parse(body) as { pin?: string }).pin;
        } catch {
          /* ignore */
        }
        if (pin === PIN) {
          const token = generateToken(pin);
          sendJson(res, 200, { token });
        } else {
          sendJson(res, 401, { error: "Invalid PIN" });
        }
      })
      .catch(() => {
        res.writeHead(400);
        res.end();
      });
    return;
  }

  // All other API routes require auth
  if (!isAuthenticated(req, url)) {
    res.writeHead(401);
    res.end("Unauthorized");
    return;
  }

  // GET /api/browse?path=<root-relative-dir>
  if (req.method === "GET" && pathname === "/api/browse") {
    const dirParam = url.searchParams.get("path") ?? "";
    const dirPath = fromRootRelative(dirParam);

    if (!isWithinRoot(dirPath)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const result: DirectoryEntry[] = entries
      .filter(
        (e) =>
          e.isDirectory() ||
          (e.isFile() && isPdf(e.name)) ||
          (e.isFile() && isHtml(e.name)) ||
          (e.isFile() && isAnnotations(e.name)),
      )
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory())
          return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map((e) => ({
        name: e.name,
        path: toRootRelative(path.join(dirPath, e.name)),
        type: e.isDirectory()
          ? "folder"
          : isAnnotations(e.name)
            ? "annotations"
            : isHtml(e.name)
              ? "html"
              : "pdf",
      }));

    sendJson(res, 200, result);
    return;
  }

  // GET /api/pdf?path=<root-relative-filepath>
  if (req.method === "GET" && pathname === "/api/pdf") {
    const fileParam = url.searchParams.get("path");
    if (!fileParam) {
      res.writeHead(400);
      res.end("Missing path");
      return;
    }

    const filePath = fromRootRelative(fileParam);

    if (!isWithinRoot(filePath) || !filePath.toLowerCase().endsWith(".pdf")) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const stat = fs.statSync(filePath);
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Length": stat.size,
    });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  // GET /api/html?path=<root-relative-filepath>
  if (req.method === "GET" && pathname === "/api/html") {
    const fileParam = url.searchParams.get("path");
    if (!fileParam) {
      res.writeHead(400);
      res.end("Missing path");
      return;
    }

    const filePath = fromRootRelative(fileParam);

    if (!isWithinRoot(filePath) || !filePath.toLowerCase().endsWith(".html")) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const stat = fs.statSync(filePath);
    res.writeHead(200, {
      "Content-Type": "text/html",
      "Content-Length": stat.size,
    });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  res.writeHead(404);
  res.end("Not found");
}

// --- WebSocket server ---
const clients = new Set<WebSocket>();
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  if (!isAuthenticated(req, url)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

wss.on("connection", (ws) => {
  clients.add(ws);
  console.log(`WS client connected (total: ${clients.size})`);
  ws.send(
    JSON.stringify({
      type: "state_sync",
      state: { ...appState, activePendingStroke },
    } satisfies ServerMessage),
  );

  ws.on("message", async (data) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(data.toString()) as ClientMessage;
    } catch {
      return;
    }

    switch (msg.type) {
      case "stroke_begin":
        activePendingStroke = { ...msg, points: [] };
        broadcast({
          type: "stroke_begin",
          source: msg.source,
          slide: msg.slide,
          strokeId: msg.strokeId,
          tool: msg.tool,
          color: msg.color,
          thickness: msg.thickness,
        });
        break;
      case "stroke_point":
        if (activePendingStroke?.strokeId === msg.strokeId) {
          const isShape = ["arrow", "box", "ellipse"].includes(
            activePendingStroke.tool,
          );
          if (isShape) activePendingStroke.points = msg.points;
          else activePendingStroke.points.push(...msg.points);
        }
        broadcast({
          type: "stroke_point",
          source: msg.source,
          strokeId: msg.strokeId,
          points: msg.points,
        });
        break;
      case "stroke_abandon":
        activePendingStroke = null;
        broadcast({
          type: "stroke_abandon",
          source: msg.source,
          strokeId: msg.strokeId,
        });
        break;
      case "strokes_added": {
        activePendingStroke = null;
        const { source, slide, strokes } = msg;
        handleStrokesAdded(source, slide, strokes);
        break;
      }
      case "strokes_updated": {
        const { source, slide, strokes } = msg;
        handleStrokesUpdated(source, slide, strokes);
        break;
      }
      case "strokes_move_preview":
        broadcast({
          type: "strokes_move_preview",
          source: msg.source,
          slide: msg.slide,
          strokes: msg.strokes,
        });
        break;
      case "slide_change": {
        const { source, slide } = msg;
        handleSlideChange(source, slide);
        break;
      }
      case "undo": {
        handleUndo(msg.source);
        break;
      }
      case "strokes_removed": {
        const { source, slide, strokeIds } = msg;
        handleStrokesRemoved(source, slide, strokeIds);
        break;
      }
      case "clear_slide": {
        const { source, slide } = msg;
        handleClearSlide(source, slide);
        break;
      }
      case "clear_all": {
        handleClearAll(msg.source);
        break;
      }
      case "load_pdf": {
        const { path: pdfRelPath } = msg;
        await handleLoadPdf(ws, pdfRelPath);
        break;
      }
      case "load_html": {
        handleLoadHtml(ws, msg.path);
        break;
      }
      case "set_mode": {
        handleSetMode(msg.mode);
        break;
      }
      case "set_whiteboard_mode": {
        handleSetWhiteboardMode(msg.enabled);
        break;
      }
      case "html_dom": {
        appState.latestHtmlDom = {
          html: msg.html,
          viewerWidth: msg.viewerWidth,
          viewerHeight: msg.viewerHeight,
          scrollX: msg.scrollX,
          scrollY: msg.scrollY,
        };
        broadcast({ type: "html_dom_relay", ...appState.latestHtmlDom });
        break;
      }
      case "whiteboard_add_page": {
        handleWhiteboardAddPage();
        break;
      }
      case "html_add_page": {
        handleHtmlAddPage();
        break;
      }

      case "logging": {
        const { message } = msg;
        handleLogging(message);
        break;
      }
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    console.log(`WS client disconnected (total: ${clients.size})`);
  });

  ws.on("error", (err) => {
    console.error("WS error:", err.message);
  });
});

// --- WebSocket message handlers ---

function handleStrokesAdded(
  source: AnnotationSource,
  slide: number,
  strokes: AnnotationStroke[],
): void {
  if (source === "html") {
    if (!appState.htmlAnnotations[slide]) appState.htmlAnnotations[slide] = [];
    for (const stroke of strokes) appState.htmlAnnotations[slide].push(stroke);
    htmlUndoStack.push({
      type: "remove_many",
      slide,
      strokeIds: strokes.map((s) => s.id),
    });
    broadcast({ type: "strokes_added", source, slide, strokes });
    saveHtmlAnnotations();
    return;
  }
  const annotationSource =
    source === "whiteboard"
      ? appState.whiteboardAnnotations
      : appState.annotations;
  if (!annotationSource[slide]) annotationSource[slide] = [];
  for (const stroke of strokes) annotationSource[slide].push(stroke);
  const undoStack =
    source === "whiteboard" ? whiteboardUndoStack : pdfUndoStack;
  undoStack.push({
    type: "remove_many",
    slide,
    strokeIds: strokes.map((s) => s.id),
  });
  broadcast({ type: "strokes_added", source, slide, strokes });
  saveAnnotations();
}

function handleStrokesUpdated(
  source: AnnotationSource,
  slide: number,
  strokes: AnnotationStroke[],
): void {
  if (source === "html") {
    const page = appState.htmlAnnotations[slide];
    if (page) {
      const oldStrokes: AnnotationStroke[] = [];
      for (const stroke of strokes) {
        const idx = page.findIndex((s) => s.id === stroke.id);
        if (idx !== -1) {
          oldStrokes.push(page[idx]);
          page[idx] = stroke;
        }
      }
      if (oldStrokes.length > 0) {
        htmlUndoStack.push({ type: "restore", slide, strokes: oldStrokes });
        broadcast({ type: "strokes_updated", source, slide, strokes });
        saveHtmlAnnotations();
      }
    }
    return;
  }
  const annotationSource =
    source === "whiteboard"
      ? appState.whiteboardAnnotations
      : appState.annotations;
  const page = annotationSource[slide];
  if (page) {
    const oldStrokes: AnnotationStroke[] = [];
    for (const stroke of strokes) {
      const idx = page.findIndex((s) => s.id === stroke.id);
      if (idx !== -1) {
        oldStrokes.push(page[idx]);
        page[idx] = stroke;
      }
    }
    if (oldStrokes.length > 0) {
      activeUndoStack(source).push({
        type: "restore",
        slide,
        strokes: oldStrokes,
      });
      broadcast({ type: "strokes_updated", source, slide, strokes });
      saveAnnotations();
    }
  }
}

function handleSlideChange(source: AnnotationSource, slide: number): void {
  if (source === "whiteboard") {
    if (slide < 0 || slide >= appState.whiteboardPageCount) return;
    appState.whiteboardSlide = slide;
  } else if (source === "html") {
    if (slide < 0 || slide >= appState.htmlPageCount) return;
    appState.htmlSlide = slide;
  } else {
    appState.currentSlide = slide;
  }
  broadcast({ type: "slide_changed", source, slide });
}

function handleUndo(source: AnnotationSource): void {
  if (source === "html") {
    const entry = htmlUndoStack.pop();
    if (!entry) return;
    if (entry.type === "remove_many") {
      const ids = new Set(entry.strokeIds);
      appState.htmlAnnotations[entry.slide] = (
        appState.htmlAnnotations[entry.slide] ?? []
      ).filter((s) => !ids.has(s.id));
      broadcast({
        type: "strokes_removed",
        source: "html",
        slide: entry.slide,
        strokeIds: entry.strokeIds,
      });
    } else if (entry.type === "restore") {
      const page = appState.htmlAnnotations[entry.slide];
      if (page) {
        for (const saved of entry.strokes) {
          const idx = page.findIndex((s) => s.id === saved.id);
          if (idx !== -1) page[idx] = saved;
        }
        broadcast({
          type: "strokes_updated",
          source: "html",
          slide: entry.slide,
          strokes: entry.strokes,
        });
      }
    } else {
      const page = appState.htmlAnnotations[entry.slide] ?? [];
      const pairs = entry.strokes
        .map((s, i) => ({ stroke: s, index: entry.indices[i] }))
        .sort((a, b) => a.index - b.index);
      for (const { stroke, index } of pairs) {
        page.splice(Math.min(index, page.length), 0, stroke);
      }
      appState.htmlAnnotations[entry.slide] = page;
      broadcast({
        type: "strokes_reinserted",
        source: "html",
        slide: entry.slide,
        strokes: entry.strokes,
        indices: entry.indices,
      });
    }
    saveHtmlAnnotations();
    return;
  }
  const entry = activeUndoStack(source).pop();
  if (!entry) return;
  const annotationSource =
    source === "whiteboard"
      ? appState.whiteboardAnnotations
      : appState.annotations;
  if (entry.type === "remove_many") {
    const ids = new Set(entry.strokeIds);
    annotationSource[entry.slide] = (
      annotationSource[entry.slide] ?? []
    ).filter((s) => !ids.has(s.id));
    broadcast({
      type: "strokes_removed",
      source,
      slide: entry.slide,
      strokeIds: entry.strokeIds,
    });
    saveAnnotations();
  } else if (entry.type === "restore") {
    // restore: replace each stroke by id with saved version
    const page = annotationSource[entry.slide];
    if (page) {
      for (const saved of entry.strokes) {
        const idx = page.findIndex((s) => s.id === saved.id);
        if (idx !== -1) page[idx] = saved;
      }
      broadcast({
        type: "strokes_updated",
        source,
        slide: entry.slide,
        strokes: entry.strokes,
      });
      saveAnnotations();
    }
  } else {
    // reinsert: put erased strokes back at their original positions
    const page = annotationSource[entry.slide] ?? [];
    const pairs = entry.strokes
      .map((s, i) => ({ stroke: s, index: entry.indices[i] }))
      .sort((a, b) => a.index - b.index);
    for (const { stroke, index } of pairs) {
      page.splice(Math.min(index, page.length), 0, stroke);
    }
    annotationSource[entry.slide] = page;
    broadcast({
      type: "strokes_reinserted",
      source,
      slide: entry.slide,
      strokes: entry.strokes,
      indices: entry.indices,
    });
    saveAnnotations();
  }
}

function handleStrokesRemoved(
  source: AnnotationSource,
  slide: number,
  strokeIds: string[],
): void {
  if (source === "html") {
    const page = appState.htmlAnnotations[slide];
    if (page) {
      const idSet = new Set(strokeIds);
      const removed: AnnotationStroke[] = [];
      const indices: number[] = [];
      for (let i = 0; i < page.length; i++) {
        if (idSet.has(page[i].id)) {
          removed.push(page[i]);
          indices.push(i);
        }
      }
      if (removed.length > 0) {
        appState.htmlAnnotations[slide] = page.filter((s) => !idSet.has(s.id));
        htmlUndoStack.push({
          type: "reinsert",
          slide,
          strokes: removed,
          indices,
        });
        broadcast({ type: "strokes_removed", source, slide, strokeIds });
        saveHtmlAnnotations();
      }
    }
    return;
  }
  const annotationSource =
    source === "whiteboard"
      ? appState.whiteboardAnnotations
      : appState.annotations;
  const page = annotationSource[slide];
  if (page) {
    const idSet = new Set(strokeIds);
    const removed: AnnotationStroke[] = [];
    const indices: number[] = [];
    for (let i = 0; i < page.length; i++) {
      if (idSet.has(page[i].id)) {
        removed.push(page[i]);
        indices.push(i);
      }
    }
    if (removed.length > 0) {
      annotationSource[slide] = page.filter((s) => !idSet.has(s.id));
      activeUndoStack(source).push({
        type: "reinsert",
        slide,
        strokes: removed,
        indices,
      });
      broadcast({ type: "strokes_removed", source, slide, strokeIds });
      saveAnnotations();
    }
  }
}

function handleClearSlide(source: AnnotationSource, slide: number): void {
  if (source === "html") {
    appState.htmlAnnotations[slide] = [];
    htmlUndoStack.length = 0;
    broadcast({ type: "slide_cleared", source, slide });
    saveHtmlAnnotations();
    return;
  }
  if (source === "whiteboard") {
    appState.whiteboardAnnotations[slide] = [];
  } else {
    appState.annotations[slide] = [];
  }
  activeUndoStack(source).length = 0;
  broadcast({ type: "slide_cleared", source, slide });
  saveAnnotations();
}

function handleClearAll(source: AnnotationSource): void {
  if (source === "html") {
    appState.htmlAnnotations = {};
    htmlUndoStack.length = 0;
    broadcast({ type: "all_cleared", source });
    saveHtmlAnnotations();
    return;
  }
  if (source === "whiteboard") {
    appState.whiteboardAnnotations = {};
  } else {
    appState.annotations = {};
  }
  activeUndoStack(source).length = 0;
  broadcast({ type: "all_cleared", source });
  saveAnnotations();
}

function broadcastModeChanged(): void {
  broadcast({
    type: "mode_changed",
    activeMode: appState.activeMode,
    htmlPath: appState.activeMode.base === "html" ? appState.htmlPath : null,
    ...(appState.activeMode.base === "html"
      ? {
          htmlAnnotations: appState.htmlAnnotations,
          htmlPageCount: appState.htmlPageCount,
        }
      : {}),
  });
}

function handleSetMode(mode: BaseMode): void {
  if (mode !== "html" && appState.activeMode.base === "html") {
    appState.htmlAnnotations = {};
    appState.htmlSlide = 0;
    appState.htmlPageCount = 1;
    appState.latestHtmlDom = null;
    htmlUndoStack.length = 0;
  }
  appState.activeMode = { ...appState.activeMode, base: mode };
  broadcastModeChanged();
}

function handleSetWhiteboardMode(enabled: boolean): void {
  appState.activeMode = { ...appState.activeMode, whiteboard: enabled };
  broadcastModeChanged();
}

function handleWhiteboardAddPage(): void {
  appState.whiteboardPageCount += 1;
  const newSlide = appState.whiteboardPageCount - 1;
  appState.whiteboardSlide = newSlide;
  broadcast({
    type: "whiteboard_page_added",
    pageCount: appState.whiteboardPageCount,
    slide: newSlide,
  });
}

function handleHtmlAddPage(): void {
  appState.htmlPageCount += 1;
  const newSlide = appState.htmlPageCount - 1;
  appState.htmlSlide = newSlide;
  broadcast({
    type: "html_page_added",
    pageCount: appState.htmlPageCount,
    slide: newSlide,
  });
  saveHtmlAnnotations();
}

async function handleLoadPdf(ws: WebSocket, pdfRelPath: string): Promise<void> {
  const pdfPath = fromRootRelative(pdfRelPath);
  if (!isWithinRoot(pdfPath) || !pdfPath.toLowerCase().endsWith(".pdf")) {
    const errMsg: ServerMessage = {
      type: "error",
      message: "Invalid PDF path",
    };
    ws.send(JSON.stringify(errMsg));
    return;
  }
  if (!fs.existsSync(pdfPath)) {
    const errMsg: ServerMessage = { type: "error", message: "PDF not found" };
    ws.send(JSON.stringify(errMsg));
    return;
  }
  try {
    const data = fs.readFileSync(pdfPath);
    const doc = await PDFDocument.load(data, { ignoreEncryption: true });
    const pageCount = doc.getPageCount();

    appState.activePdfPath = toRootRelative(pdfPath);
    appState.activePdfName = path.basename(pdfPath);
    appState.pageCount = pageCount;
    appState.currentSlide = 0;
    appState.activeMode = { base: "pdf", whiteboard: false };
    appState.whiteboardSlide = 0;
    appState.whiteboardPageCount = 1;
    appState.htmlPath = null;
    appState.htmlAnnotations = {};
    appState.htmlSlide = 0;
    appState.htmlPageCount = 1;
    appState.latestHtmlDom = null;
    pdfUndoStack.length = 0;
    whiteboardUndoStack.length = 0;
    htmlUndoStack.length = 0;

    // Load saved annotations if they exist
    const annFile = annotationsPath(pdfPath);
    try {
      if (fs.existsSync(annFile)) {
        const raw = JSON.parse(fs.readFileSync(annFile, "utf8")) as
          | AnnotationsFile
          | AnnotationMap; // legacy format: plain AnnotationMap
        // Support old format (plain AnnotationMap) and new format (AnnotationsFile)
        if (
          raw &&
          typeof raw === "object" &&
          "annotations" in raw &&
          !Array.isArray(raw)
        ) {
          const file = raw as AnnotationsFile;
          appState.annotations = file.annotations ?? {};
          appState.whiteboardAnnotations = file.whiteboardAnnotations ?? {};
          appState.whiteboardPageCount = file.whiteboardPageCount ?? 1;
        } else {
          // Legacy: the file was a plain AnnotationMap
          appState.annotations = raw as AnnotationMap;
          appState.whiteboardAnnotations = {};
          appState.whiteboardPageCount = 1;
        }
        console.log(`Annotations loaded from ${annFile}`);
      } else {
        appState.annotations = {};
        appState.whiteboardAnnotations = {};
        appState.whiteboardPageCount = 1;
      }
    } catch {
      appState.annotations = {};
      appState.whiteboardAnnotations = {};
      appState.whiteboardPageCount = 1;
    }

    const loadedMsg: ServerMessage = {
      type: "pdf_loaded",
      path: toRootRelative(pdfPath),
      name: path.basename(pdfPath),
      pageCount,
      annotations: appState.annotations,
      whiteboardAnnotations: appState.whiteboardAnnotations,
      whiteboardPageCount: appState.whiteboardPageCount,
    };
    broadcast(loadedMsg);
    console.log(`PDF loaded: ${path.basename(pdfPath)} (${pageCount} pages)`);
  } catch (e) {
    console.error("Failed to load PDF:", e);
    const errMsg: ServerMessage = {
      type: "error",
      message: "Failed to load PDF",
    };
    ws.send(JSON.stringify(errMsg));
  }
}

function handleLoadHtml(ws: WebSocket, htmlRelPath: string): void {
  const htmlPath = fromRootRelative(htmlRelPath);
  if (!isWithinRoot(htmlPath) || !htmlPath.toLowerCase().endsWith(".html")) {
    const errMsg: ServerMessage = {
      type: "error",
      message: "Invalid HTML path",
    };
    ws.send(JSON.stringify(errMsg));
    return;
  }
  if (!fs.existsSync(htmlPath)) {
    const errMsg: ServerMessage = {
      type: "error",
      message: "HTML file not found",
    };
    ws.send(JSON.stringify(errMsg));
    return;
  }
  appState.htmlPath = toRootRelative(htmlPath);
  appState.htmlAnnotations = {};
  appState.htmlSlide = 0;
  appState.htmlPageCount = 1;
  appState.latestHtmlDom = null;
  htmlUndoStack.length = 0;

  const annFile = htmlAnnotationsPath(htmlPath);
  try {
    if (fs.existsSync(annFile)) {
      const raw = JSON.parse(
        fs.readFileSync(annFile, "utf8"),
      ) as HtmlAnnotationsFile;
      appState.htmlAnnotations = raw.htmlAnnotations ?? {};
      appState.htmlPageCount = raw.htmlPageCount ?? 1;
      console.log(`HTML annotations loaded from ${annFile}`);
    }
  } catch {
    appState.htmlAnnotations = {};
    appState.htmlPageCount = 1;
  }

  appState.activeMode = { base: "html", whiteboard: false };
  broadcastModeChanged();
  console.log(`HTML loaded: ${path.basename(htmlPath)}`);
}

function handleLogging(message: string): void {
  console.log(message);
}

// --- Broadcast ---

function broadcast(msg: ServerMessage): void {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
