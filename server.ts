import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createHmac } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { WebSocketServer, WebSocket } from "ws";
import { assertAnnotationSlide } from "./generated/index.js";
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
  const activePdf = appState.activePdf;
  if (!activePdf) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const fileData: AnnotationsFile = {
        annotations: activePdf.annotations,
        whiteboardAnnotations: appState.whiteboard.annotations,
      };
      fs.writeFileSync(
        annotationsPath(fromRootRelative(activePdf.path)),
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
  const activeHtml = appState.activeHtml;
  if (!activeHtml) return;

  if (htmlSaveTimer) clearTimeout(htmlSaveTimer);
  htmlSaveTimer = setTimeout(() => {
    try {
      const fileData: HtmlAnnotationsFile = {
        annotations: activeHtml.annotations,
      };
      fs.writeFileSync(
        htmlAnnotationsPath(fromRootRelative(activeHtml.path)),
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
  activePdf: null,
  activeMode: { base: "pdf", whiteboard: false } as ActiveMode,
  whiteboard: { slide: 0, pageCount: 1, annotations: {} },
  activeHtml: null,
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

/**
 * Resolve annotation source to the concrete annotations map, undo stack, and
 * save function.  Returns null when the required state (PDF or HTML) is not
 * loaded, so callers can bail out early with a single `if (!ctx) return`.
 */
function resolveSource(source: AnnotationSource): {
  annotations: AnnotationMap;
  undoStack: UndoEntry[];
  save: () => void;
} | null {
  switch (source) {
    case "html":
      const h = appState.activeHtml;
      if (!h) return null;
      return {
        annotations: h.annotations,
        undoStack: htmlUndoStack,
        save: saveHtmlAnnotations,
      };
    case "pdf":
      const pdf = appState.activePdf;
      if (!pdf) return null;
      return {
        annotations: pdf.annotations,
        undoStack: pdfUndoStack,
        save: saveAnnotations,
      };
    case "whiteboard":
      return {
        annotations: appState.whiteboard.annotations,
        undoStack: whiteboardUndoStack,
        save: saveAnnotations,
      };
  }
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
        }, ws);
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
        }, ws);
        break;
      case "stroke_abandon":
        activePendingStroke = null;
        broadcast({
          type: "stroke_abandon",
          source: msg.source,
          strokeId: msg.strokeId,
        }, ws);
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
        broadcast(
          {
            type: "strokes_move_preview",
            source: msg.source,
            slide: msg.slide,
            strokes: msg.strokes,
          },
          ws, // exclude sender — presenter has local ghost state; echo causes full static-canvas rebuild per pointer event
        );
        break;
      case "move_preview_begin":
        broadcast({ type: "move_preview_begin", source: msg.source, slide: msg.slide, strokeIds: msg.strokeIds }, ws);
        break;
      case "move_preview_cancel":
        broadcast({ type: "move_preview_cancel", source: msg.source, slide: msg.slide }, ws);
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
        const activeHtml = appState.activeHtml;
        if (!activeHtml) return;
        activeHtml.latestDom = {
          html: msg.html,
          viewerWidth: msg.viewerWidth,
          viewerHeight: msg.viewerHeight,
          scrollX: msg.scrollX,
          scrollY: msg.scrollY,
        };
        broadcast({ type: "html_dom_relay", ...activeHtml.latestDom });
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
  const ctx = resolveSource(source);
  if (!ctx) return;
  ctx.annotations[slide] ??= [];
  ctx.annotations[slide].push(...strokes);
  ctx.undoStack.push({
    type: "remove_many",
    slide,
    strokeIds: strokes.map((s) => s.id),
  });
  broadcast({ type: "strokes_added", source, slide, strokes });
  ctx.save();
}

function handleStrokesUpdated(
  source: AnnotationSource,
  slide: number,
  strokes: AnnotationStroke[],
): void {
  const ctx = resolveSource(source);
  if (!ctx) return;
  const page = ctx.annotations[slide];
  if (!page) return;
  const oldStrokes: AnnotationStroke[] = [];
  for (const stroke of strokes) {
    const idx = page.findIndex((s) => s.id === stroke.id);
    if (idx !== -1) {
      oldStrokes.push(page[idx]);
      page[idx] = stroke;
    }
  }
  if (oldStrokes.length > 0) {
    ctx.undoStack.push({ type: "restore", slide, strokes: oldStrokes });
    broadcast({ type: "strokes_updated", source, slide, strokes });
    ctx.save();
  }
}

function handleSlideChange(source: AnnotationSource, slide: number): void {
  const activePdf = appState.activePdf;
  if (!activePdf) return;

  if (source === "whiteboard") {
    if (slide < 0 || slide >= appState.whiteboard.pageCount) return;
    appState.whiteboard.slide = slide;
  } else if (source === "html") {
    const activeHtml = appState.activeHtml;
    if (!activeHtml) return;
    if (slide < 0 || slide >= activeHtml.pageCount) return;
    activeHtml.slide = slide;
  } else {
    activePdf.currentSlide = slide;
  }
  broadcast({ type: "slide_changed", source, slide });
}

function handleUndo(source: AnnotationSource): void {
  const ctx = resolveSource(source);
  if (!ctx) return;
  const entry = ctx.undoStack.pop();
  if (!entry) return;

  if (entry.type === "remove_many") {
    const ids = new Set(entry.strokeIds);
    ctx.annotations[entry.slide] = (ctx.annotations[entry.slide] ?? []).filter(
      (s) => !ids.has(s.id),
    );
    broadcast({
      type: "strokes_removed",
      source,
      slide: entry.slide,
      strokeIds: entry.strokeIds,
    });
  } else if (entry.type === "restore") {
    const page = ctx.annotations[entry.slide];
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
    }
  } else {
    const page = ctx.annotations[entry.slide] ?? [];
    const pairs = entry.strokes
      .map((s, i) => ({ stroke: s, index: entry.indices[i] }))
      .sort((a, b) => a.index - b.index);
    for (const { stroke, index } of pairs) {
      page.splice(Math.min(index, page.length), 0, stroke);
    }
    ctx.annotations[entry.slide] = page;
    broadcast({
      type: "strokes_reinserted",
      source,
      slide: entry.slide,
      strokes: entry.strokes,
      indices: entry.indices,
    });
  }
  ctx.save();
}

function handleStrokesRemoved(
  source: AnnotationSource,
  slide: number,
  strokeIds: string[],
): void {
  const ctx = resolveSource(source);
  if (!ctx) return;
  const page = ctx.annotations[slide];
  if (!page) return;
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
    ctx.annotations[slide] = page.filter((s) => !idSet.has(s.id));
    ctx.undoStack.push({ type: "reinsert", slide, strokes: removed, indices });
    broadcast({ type: "strokes_removed", source, slide, strokeIds });
    ctx.save();
  }
}

function handleClearSlide(source: AnnotationSource, slide: number): void {
  const ctx = resolveSource(source);
  if (!ctx) return;
  ctx.annotations[slide] = [];
  ctx.undoStack.length = 0;
  broadcast({ type: "slide_cleared", source, slide });
  ctx.save();
}

function handleClearAll(source: AnnotationSource): void {
  const ctx = resolveSource(source);
  if (!ctx) return;

  if (source === "html") {
    const activeHtml = appState.activeHtml!;
    activeHtml.annotations = {};
    activeHtml.pageCount = 1;
    activeHtml.slide = 0;
    ctx.undoStack.length = 0;
    broadcast({ type: "all_cleared", source });
    ctx.save();
    return;
  }
  if (source === "whiteboard") {
    appState.whiteboard.annotations = {};
    appState.whiteboard.pageCount = 1;
    appState.whiteboard.slide = 0;
  } else {
    appState.activePdf!.annotations = {};
  }
  ctx.undoStack.length = 0;
  broadcast({ type: "all_cleared", source });
  ctx.save();
}

function broadcastModeChanged(): void {
  const activeHtml = appState.activeHtml;

  broadcast({
    type: "mode_changed",
    activeMode: appState.activeMode,
    activeHtml:
      appState.activeMode.base === "html" && activeHtml
        ? activeHtml
        : undefined,
  });
}

function handleSetMode(mode: BaseMode): void {
  if (mode !== "html" && appState.activeMode.base === "html") {
    const activeHtml = appState.activeHtml;
    if (activeHtml) {
      activeHtml.annotations = {};
      activeHtml.pageCount = 1;
      activeHtml.slide = 0;
      activeHtml.latestDom = null;
    }
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
  appState.whiteboard.pageCount++;
  const pageCount = appState.whiteboard.pageCount;
  const newSlide = pageCount - 1;
  appState.whiteboard.slide = newSlide;
  broadcast({
    type: "whiteboard_page_added",
    pageCount: pageCount,
    slide: newSlide,
  });
}

function handleHtmlAddPage(): void {
  const activeHtml = appState.activeHtml;
  if (!activeHtml) return;

  activeHtml.pageCount++;
  const pageCount = activeHtml.pageCount;
  const newSlide = pageCount - 1;
  activeHtml.slide = newSlide;
  broadcast({
    type: "html_page_added",
    pageCount: pageCount,
    slide: newSlide,
  });
  saveHtmlAnnotations();
}

function parseAnnotationMap(
  raw: unknown,
  fallback: AnnotationMap,
): AnnotationMap {
  if (Array.isArray(raw)) {
    // Backward-compat: old file format stored annotations as an array
    const result: AnnotationMap = {};
    for (let i = 0; i < raw.length; i++) {
      try {
        const slide = assertAnnotationSlide(raw[i]);
        if (slide.length > 0) result[i] = slide;
      } catch {
        // skip invalid slides
      }
    }
    return result;
  }
  if (typeof raw !== "object" || raw === null) return fallback;
  const result: AnnotationMap = {};
  for (const key of Object.keys(raw)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0) continue;
    try {
      const slide = assertAnnotationSlide(
        (raw as Record<string, unknown>)[key],
      );
      result[index] = slide;
    } catch {
      // skip invalid slides
    }
  }
  return result;
}

function parseAnnotationsFile(raw: unknown): AnnotationsFile {
  if (typeof raw !== "object" || raw === null) {
    return { annotations: {}, whiteboardAnnotations: {} };
  }
  const obj = raw as Record<string, unknown>;
  return {
    annotations: parseAnnotationMap(obj.annotations, {}),
    whiteboardAnnotations: parseAnnotationMap(obj.whiteboardAnnotations, {}),
  };
}

function parseHtmlAnnotationsFile(raw: unknown): HtmlAnnotationsFile {
  if (typeof raw !== "object" || raw === null) {
    return { annotations: {} };
  }
  const obj = raw as Record<string, unknown>;
  return { annotations: parseAnnotationMap(obj.annotations, {}) };
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

    // Load saved annotations if they exist
    const annFile = annotationsPath(pdfPath);
    let pdfAnnotations: AnnotationMap | undefined;
    let whiteboardAnnotations: AnnotationMap | undefined;
    try {
      if (fs.existsSync(annFile)) {
        const raw = parseAnnotationsFile(
          JSON.parse(fs.readFileSync(annFile, "utf8")),
        );
        pdfAnnotations = raw.annotations;
        whiteboardAnnotations = raw.whiteboardAnnotations;
        console.log(`Annotations loaded from ${annFile}`);
      }
    } catch {
      console.log(`Failed to load annotations from ${annFile}`);
    }

    appState.activePdf = {
      path: toRootRelative(pdfPath),
      name: path.basename(pdfPath),
      pageCount: pageCount,
      currentSlide: 0,
      annotations: pdfAnnotations ?? {},
    };
    appState.activeMode = { base: "pdf", whiteboard: false };
    const wb = whiteboardAnnotations ?? {};
    const wbPageCount =
      Object.keys(wb).length > 0
        ? Math.max(...Object.keys(wb).map(Number)) + 1
        : 1;
    appState.whiteboard = {
      annotations: wb,
      slide: 0,
      pageCount: wbPageCount,
    };
    appState.activeHtml = null;
    pdfUndoStack.length = 0;
    whiteboardUndoStack.length = 0;
    htmlUndoStack.length = 0;

    const loadedMsg: ServerMessage = {
      type: "pdf_loaded",
      pdf: appState.activePdf,
      whiteboard: appState.whiteboard,
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
  htmlUndoStack.length = 0;

  const annFile = htmlAnnotationsPath(htmlPath);
  let htmlAnnotations: AnnotationMap | undefined;
  try {
    if (fs.existsSync(annFile)) {
      const raw = parseHtmlAnnotationsFile(
        JSON.parse(fs.readFileSync(annFile, "utf8")),
      );
      htmlAnnotations = raw.annotations;
      console.log(`HTML annotations loaded from ${annFile}`);
    }
  } catch {
    console.log(`Failed to load annotations from ${annFile}`);
  }
  const ha = htmlAnnotations ?? {};
  const haPageCount =
    Object.keys(ha).length > 0
      ? Math.max(...Object.keys(ha).map(Number)) + 1
      : 1;
  appState.activeHtml = {
    path: toRootRelative(htmlPath),
    annotations: ha,
    slide: 0,
    pageCount: haPageCount,
    latestDom: null,
  };

  appState.activeMode = { base: "html", whiteboard: false };
  broadcastModeChanged();
  console.log(`HTML loaded: ${path.basename(htmlPath)}`);
}

function handleLogging(message: string): void {
  console.log(message);
}

// --- Broadcast ---

function broadcast(msg: ServerMessage, exclude?: WebSocket): void {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws !== exclude && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
