import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createHmac } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { WebSocketServer, WebSocket } from "ws";
import type {
  AppState,
  AnnotationStroke,
  AnnotationTool,
  AnnotationMap,
  AnnotationsFile,
  ClientAsset,
  ClientMessage,
  DirectoryEntry,
  ServerMessage,
  StrokeColor,
  StrokeThickness,
  Point,
} from "./shared/types.ts";
let clientAssets: Map<string, ClientAsset> | null = null;
try {
  clientAssets = (await import("./generated/client-assets.ts")).clientAssets;
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
  whiteboardMode: false,
  whiteboardSlide: 0,
  whiteboardPageCount: 1,
  whiteboardAnnotations: {},
};

let activePendingStroke: {
  strokeId: string;
  source: "pdf" | "whiteboard";
  slide: number;
  tool: AnnotationTool;
  color: StrokeColor;
  thickness: StrokeThickness;
  points: Point[];
} | null = null;

// --- Undo stack ---
type UndoEntry =
  | { type: "remove"; slide: number; strokeId: string }
  | { type: "restore"; slide: number; strokes: AnnotationStroke[] }
  | {
      type: "reinsert";
      slide: number;
      strokes: AnnotationStroke[];
      indices: number[];
    };

const pdfUndoStack: UndoEntry[] = [];
const whiteboardUndoStack: UndoEntry[] = [];

function activeUndoStack(): UndoEntry[] {
  return appState.whiteboardMode ? whiteboardUndoStack : pdfUndoStack;
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
            : "file",
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
      case "stroke_added": {
        activePendingStroke = null;
        const { source, slide, stroke } = msg;
        handleStrokeAdded(source, slide, stroke);
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
      case "set_whiteboard_mode": {
        handleSetWhiteboardMode(msg.enabled);
        break;
      }
      case "whiteboard_add_page": {
        handleWhiteboardAddPage();
        break;
      }
      case "whiteboard_slide_change": {
        handleWhiteboardSlideChange(msg.slide);
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

function handleStrokeAdded(
  source: "pdf" | "whiteboard",
  slide: number,
  stroke: AnnotationStroke,
): void {
  if (source === "whiteboard") {
    handleStrokeAddedWhiteboard(slide, stroke);
    return;
  }
  if (!appState.annotations[slide]) appState.annotations[slide] = [];
  appState.annotations[slide].push(stroke);
  pdfUndoStack.push({ type: "remove", slide, strokeId: stroke.id });
  broadcast({ type: "stroke_added", source, slide, stroke });
  saveAnnotations();
}

function handleStrokesUpdated(
  source: "pdf" | "whiteboard",
  slide: number,
  strokes: AnnotationStroke[],
): void {
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
      activeUndoStack().push({ type: "restore", slide, strokes: oldStrokes });
      broadcast({ type: "strokes_updated", source, slide, strokes });
      saveAnnotations();
    }
  }
}

function handleSlideChange(source: "pdf" | "whiteboard", slide: number): void {
  appState.currentSlide = slide;
  broadcast({ type: "slide_changed", source, slide });
}

function handleUndo(source: "pdf" | "whiteboard"): void {
  const entry = activeUndoStack().pop();
  if (!entry) return;
  const annotationSource =
    source === "whiteboard"
      ? appState.whiteboardAnnotations
      : appState.annotations;
  if (entry.type === "remove") {
    const page = annotationSource[entry.slide];
    if (page) {
      annotationSource[entry.slide] = page.filter(
        (s) => s.id !== entry.strokeId,
      );
      broadcast({
        type: "stroke_undone",
        source,
        slide: entry.slide,
        strokeId: entry.strokeId,
      });
      saveAnnotations();
    }
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
  source: "pdf" | "whiteboard",
  slide: number,
  strokeIds: string[],
): void {
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
      activeUndoStack().push({
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

function handleClearSlide(source: "pdf" | "whiteboard", slide: number): void {
  if (source === "whiteboard") {
    appState.whiteboardAnnotations[slide] = [];
  } else {
    appState.annotations[slide] = [];
  }
  activeUndoStack().length = 0;
  broadcast({ type: "slide_cleared", source, slide });
  saveAnnotations();
}

function handleClearAll(source: "pdf" | "whiteboard"): void {
  if (source === "whiteboard") {
    appState.whiteboardAnnotations = {};
  } else {
    appState.annotations = {};
  }
  activeUndoStack().length = 0;
  broadcast({ type: "all_cleared", source });
  saveAnnotations();
}

function handleSetWhiteboardMode(enabled: boolean): void {
  const slideToRestore = appState.currentSlide;
  appState.whiteboardMode = enabled;
  if (enabled) {
    appState.whiteboardSlide = 0;
  }
  broadcast({ type: "whiteboard_mode_changed", enabled, slideToRestore });
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

function handleWhiteboardSlideChange(slide: number): void {
  if (slide < 0 || slide >= appState.whiteboardPageCount) return;
  appState.whiteboardSlide = slide;
  broadcast({ type: "whiteboard_slide_changed", slide });
}

// Whiteboard undo helpers — reuse the same undoStack but operate on whiteboardAnnotations
function handleStrokeAddedWhiteboard(
  slide: number,
  stroke: AnnotationStroke,
): void {
  if (!appState.whiteboardAnnotations[slide])
    appState.whiteboardAnnotations[slide] = [];
  appState.whiteboardAnnotations[slide].push(stroke);
  whiteboardUndoStack.push({ type: "remove", slide, strokeId: stroke.id });
  broadcast({ type: "stroke_added", source: "whiteboard", slide, stroke });
  saveAnnotations();
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
    appState.whiteboardMode = false;
    appState.whiteboardSlide = 0;
    appState.whiteboardPageCount = 1;
    pdfUndoStack.length = 0;
    whiteboardUndoStack.length = 0;

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
