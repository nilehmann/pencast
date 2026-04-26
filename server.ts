import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { WebSocketServer, WebSocket } from "ws";
import {
  parseAnnotationsFile,
  parseHtmlAnnotationsFile,
} from "@pencast/shared/annotation-utils";
import type {
  AppState,
  AnnotationSource,
  AnnotationStroke,
  AnnotationTool,
  AnnotationMap,
  PdfAnnotationMap,
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
} from "@pencast/shared/types";
let clientAssets: Map<string, ClientAsset> | null = null;
try {
  clientAssets = (await import("./generated/client-assets.js")).clientAssets;
} catch {
  // dev mode: generated/client-assets.ts not present, will serve from disk
}

// --- CLI arg validation ---
const args = process.argv.slice(2);
let hostArg: string | undefined;
const filteredArgs: string[] = [];
for (let i = 0; i < args.length; i++) {
  if ((args[i] === "--host" || args[i] === "-H") && i + 1 < args.length) {
    hostArg = args[++i];
  } else {
    filteredArgs.push(args[i]);
  }
}
const PDF_ROOT = path.resolve(filteredArgs[0] ?? process.cwd());
if (!fs.existsSync(PDF_ROOT)) {
  console.error(`Error: path does not exist: ${PDF_ROOT}`);
  process.exit(1);
}

const CLIENT_DIR = path.join(import.meta.dirname, "dist", "client");
const PORT = 3001;
const HOST = hostArg;

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
        subPageCounts: activePdf.subPageCounts,
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

// --- In-memory state ---

const appState: AppState = {
  activePdf: null,
  activeMode: { base: "pdf", whiteboard: false } as ActiveMode,
  whiteboard: { slide: 0, pageCount: 1, annotations: {} },
  activeHtml: null,
  activeScreen: null,
};

let activePendingStroke: {
  strokeId: string;
  source: AnnotationSource;
  slide: number;
  page: number;
  tool: AnnotationTool;
  color: StrokeColor;
  thickness: StrokeThickness;
  points: NormalizedPoint[];
} | null = null;

// --- Undo stack ---
type UndoEntry =
  | { type: "remove_many"; slide: number; page: number; strokeIds: string[] }
  | { type: "restore"; slide: number; page: number; strokes: AnnotationStroke[] }
  | {
      type: "reinsert";
      slide: number;
      page: number;
      strokes: AnnotationStroke[];
      indices: number[];
    };

const pdfUndoStack: UndoEntry[] = [];
const whiteboardUndoStack: UndoEntry[] = [];
const htmlUndoStack: UndoEntry[] = [];
const screenUndoStack: UndoEntry[] = [];

/**
 * Resolve annotation source to helpers for accessing the stroke array,
 * undo stack, and save function.
 *
 * For PDF source, strokes are stored in a nested structure:
 *   annotations[slide][page] → AnnotationStroke[]
 * For all other sources, strokes are flat:
 *   annotations[slide] → AnnotationStroke[]
 *
 * The getPage/setPage helpers abstract over this difference.
 */
function resolveSource(source: AnnotationSource): {
  undoStack: UndoEntry[];
  save: () => void;
  getPage: (slide: number, page: number) => AnnotationStroke[];
  setPage: (slide: number, page: number, strokes: AnnotationStroke[]) => void;
} | null {
  switch (source) {
    case "html": {
      const h = appState.activeHtml;
      if (!h) return null;
      return {
        undoStack: htmlUndoStack,
        save: saveHtmlAnnotations,
        getPage: (slide) => {
          h.annotations[slide] ??= [];
          return h.annotations[slide];
        },
        setPage: (slide, _page, strokes) => {
          h.annotations[slide] = strokes;
        },
      };
    }
    case "pdf": {
      const pdf = appState.activePdf;
      if (!pdf) return null;
      return {
        undoStack: pdfUndoStack,
        save: saveAnnotations,
        getPage: (slide, page) => {
          pdf.annotations[slide] ??= [[]];
          pdf.annotations[slide][page] ??= [];
          return pdf.annotations[slide][page];
        },
        setPage: (slide, page, strokes) => {
          pdf.annotations[slide] ??= [[]];
          pdf.annotations[slide][page] = strokes;
        },
      };
    }
    case "whiteboard":
      return {
        undoStack: whiteboardUndoStack,
        save: saveAnnotations,
        getPage: (slide) => {
          appState.whiteboard.annotations[slide] ??= [];
          return appState.whiteboard.annotations[slide];
        },
        setPage: (slide, _page, strokes) => {
          appState.whiteboard.annotations[slide] = strokes;
        },
      };
    case "screen": {
      const screen = appState.activeScreen;
      if (!screen) return null;
      return {
        undoStack: screenUndoStack,
        save: () => {},
        getPage: (slide) => {
          screen.annotations[slide] ??= [];
          return screen.annotations[slide];
        },
        setPage: (slide, _page, strokes) => {
          screen.annotations[slide] = strokes;
        },
      };
    }
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
const requestHandler: http.RequestListener = (req, res) => {
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
};

const server = http.createServer(requestHandler);

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
function handleApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
): void {
  const pathname = url.pathname;

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

function upgradeHandler(
  req: http.IncomingMessage,
  socket: import("node:stream").Duplex,
  head: Buffer,
): void {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
}

server.on("upgrade", upgradeHandler);

wss.on("connection", (ws) => {
  clients.add(ws);
  console.log(`WS client connected (total: ${clients.size})`);
  ws.send(
    JSON.stringify({
      type: "state_sync",
      state: { ...appState, activePendingStroke },
    } satisfies ServerMessage),
  );

  if (appState.activeMode.base === "screen") {
    broadcast({ type: "webrtc_restart" });
  }

  ws.on("message", async (data) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(data.toString()) as ClientMessage;
    } catch {
      return;
    }

    switch (msg.type) {
      case "stroke_begin":
        activePendingStroke = { ...msg, page: msg.page ?? 0, points: [] };
        broadcast(
          {
            type: "stroke_begin",
            source: msg.source,
            slide: msg.slide,
            page: msg.page,
            strokeId: msg.strokeId,
            tool: msg.tool,
            color: msg.color,
            thickness: msg.thickness,
          },
          ws,
        );
        break;
      case "stroke_point":
        if (activePendingStroke?.strokeId === msg.strokeId) {
          const isShape = ["arrow", "box", "ellipse"].includes(
            activePendingStroke.tool,
          );
          if (isShape) activePendingStroke.points = msg.points;
          else activePendingStroke.points.push(...msg.points);
        }
        broadcast(
          {
            type: "stroke_point",
            source: msg.source,
            strokeId: msg.strokeId,
            points: msg.points,
          },
          ws,
        );
        break;
      case "stroke_abandon":
        activePendingStroke = null;
        broadcast(
          {
            type: "stroke_abandon",
            source: msg.source,
            strokeId: msg.strokeId,
          },
          ws,
        );
        break;
      case "strokes_added": {
        activePendingStroke = null;
        const { source, slide, strokes } = msg;
        handleStrokesAdded(source, slide, msg.page ?? 0, strokes);
        break;
      }
      case "strokes_updated": {
        const { source, slide, strokes } = msg;
        handleStrokesUpdated(source, slide, msg.page ?? 0, strokes);
        break;
      }
      case "strokes_move_preview":
        broadcast(
          {
            type: "strokes_move_preview",
            source: msg.source,
            slide: msg.slide,
            page: msg.page,
            strokes: msg.strokes,
          },
          ws,
        );
        break;
      case "move_preview_begin":
        broadcast(
          {
            type: "move_preview_begin",
            source: msg.source,
            slide: msg.slide,
            page: msg.page,
            strokeIds: msg.strokeIds,
          },
          ws,
        );
        break;
      case "move_preview_cancel":
        broadcast(
          { type: "move_preview_cancel", source: msg.source, slide: msg.slide, page: msg.page },
          ws,
        );
        break;
      case "slide_change": {
        const { source, slide } = msg;
        handleSlideChange(source, slide, msg.page ?? 0);
        break;
      }
      case "undo": {
        handleUndo(msg.source);
        break;
      }
      case "strokes_removed": {
        const { source, slide, strokeIds } = msg;
        handleStrokesRemoved(source, slide, msg.page ?? 0, strokeIds);
        break;
      }
      case "clear_slide": {
        const { source, slide } = msg;
        handleClearSlide(source, slide, msg.page ?? 0);
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
      case "set_white_background": {
        handleSetWhiteBackground(msg.enabled);
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
      case "screen_add_page": {
        handleScreenAddPage();
        break;
      }
      case "pdf_add_sub_page": {
        handlePdfAddSubPage(msg.slide);
        break;
      }

      case "screen_capture_info": {
        if (appState.activeScreen) {
          appState.activeScreen.captureWidth = msg.captureWidth;
          appState.activeScreen.captureHeight = msg.captureHeight;
          broadcastModeChanged();
        }
        break;
      }

      case "webrtc_offer":
        broadcast({ type: "webrtc_offer_relay", sdp: msg.sdp }, ws);
        break;
      case "webrtc_answer":
        broadcast({ type: "webrtc_answer_relay", sdp: msg.sdp }, ws);
        break;
      case "webrtc_ice":
        broadcast({ type: "webrtc_ice_relay", candidate: msg.candidate }, ws);
        break;

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
  page: number,
  strokes: AnnotationStroke[],
): void {
  const ctx = resolveSource(source);
  if (!ctx) return;
  const arr = ctx.getPage(slide, page);
  arr.push(...strokes);
  ctx.undoStack.push({
    type: "remove_many",
    slide,
    page,
    strokeIds: strokes.map((s) => s.id),
  });
  broadcast({ type: "strokes_added", source, slide, page, strokes });
  ctx.save();
}

function handleStrokesUpdated(
  source: AnnotationSource,
  slide: number,
  page: number,
  strokes: AnnotationStroke[],
): void {
  const ctx = resolveSource(source);
  if (!ctx) return;
  const arr = ctx.getPage(slide, page);
  if (arr.length === 0) return;
  const oldStrokes: AnnotationStroke[] = [];
  for (const stroke of strokes) {
    const idx = arr.findIndex((s) => s.id === stroke.id);
    if (idx !== -1) {
      oldStrokes.push(arr[idx]);
      arr[idx] = stroke;
    }
  }
  if (oldStrokes.length > 0) {
    ctx.undoStack.push({ type: "restore", slide, page, strokes: oldStrokes });
    broadcast({ type: "strokes_updated", source, slide, page, strokes });
    ctx.save();
  }
}

function handleSlideChange(source: AnnotationSource, slide: number, page = 0): void {
  if (source === "whiteboard") {
    if (slide < 0 || slide >= appState.whiteboard.pageCount) return;
    appState.whiteboard.slide = slide;
  } else if (source === "screen") {
    const activeScreen = appState.activeScreen;
    if (!activeScreen) return;
    if (slide < 0 || slide >= activeScreen.pageCount) return;
    activeScreen.slide = slide;
  } else if (source === "html") {
    const activeHtml = appState.activeHtml;
    if (!activeHtml) return;
    if (slide < 0 || slide >= activeHtml.pageCount) return;
    activeHtml.slide = slide;
  } else {
    const activePdf = appState.activePdf;
    if (!activePdf) return;
    const subCount = activePdf.subPageCounts[slide] ?? 1;
    if (page < 0 || page >= subCount) return;
    activePdf.position = { slide, page };
  }
  if (source === "screen") {
    const activeScreen = appState.activeScreen;
    broadcast({
      type: "slide_changed",
      source,
      slide,
      strokes: activeScreen?.annotations[slide] ?? [],
    });
  } else if (source === "pdf") {
    broadcast({ type: "slide_changed", source, slide, page });
  } else {
    broadcast({ type: "slide_changed", source, slide });
  }
}

function handleScreenAddPage(): void {
  const s = appState.activeScreen;
  if (!s) return;
  s.pageCount++;
  const newSlide = s.pageCount - 1;
  s.slide = newSlide;
  broadcast({ type: "screen_page_added", pageCount: s.pageCount, slide: newSlide });
}

function handlePdfAddSubPage(slide: number): void {
  const pdf = appState.activePdf;
  if (!pdf) return;
  pdf.subPageCounts[slide] = (pdf.subPageCounts[slide] ?? 1) + 1;
  const page = pdf.subPageCounts[slide] - 1;
  pdf.position = { slide, page };
  broadcast({
    type: "pdf_sub_page_added",
    position: { slide, page },
    subPageCount: pdf.subPageCounts[slide],
  });
  saveAnnotations();
}

function handleUndo(source: AnnotationSource): void {
  const ctx = resolveSource(source);
  if (!ctx) return;
  const entry = ctx.undoStack.pop();
  if (!entry) return;

  if (entry.type === "remove_many") {
    const ids = new Set(entry.strokeIds);
    const arr = ctx.getPage(entry.slide, entry.page);
    ctx.setPage(entry.slide, entry.page, arr.filter((s) => !ids.has(s.id)));
    broadcast({
      type: "strokes_removed",
      source,
      slide: entry.slide,
      page: entry.page,
      strokeIds: entry.strokeIds,
    });
  } else if (entry.type === "restore") {
    const arr = ctx.getPage(entry.slide, entry.page);
    for (const saved of entry.strokes) {
      const idx = arr.findIndex((s) => s.id === saved.id);
      if (idx !== -1) arr[idx] = saved;
    }
    broadcast({
      type: "strokes_updated",
      source,
      slide: entry.slide,
      page: entry.page,
      strokes: entry.strokes,
    });
  } else {
    const arr = ctx.getPage(entry.slide, entry.page);
    const pairs = entry.strokes
      .map((s, i) => ({ stroke: s, index: entry.indices[i] }))
      .sort((a, b) => a.index - b.index);
    for (const { stroke, index } of pairs) {
      arr.splice(Math.min(index, arr.length), 0, stroke);
    }
    broadcast({
      type: "strokes_reinserted",
      source,
      slide: entry.slide,
      page: entry.page,
      strokes: entry.strokes,
      indices: entry.indices,
    });
  }
  ctx.save();
}

function handleStrokesRemoved(
  source: AnnotationSource,
  slide: number,
  page: number,
  strokeIds: string[],
): void {
  const ctx = resolveSource(source);
  if (!ctx) return;
  const arr = ctx.getPage(slide, page);
  if (arr.length === 0) return;
  const idSet = new Set(strokeIds);
  const removed: AnnotationStroke[] = [];
  const indices: number[] = [];
  for (let i = 0; i < arr.length; i++) {
    if (idSet.has(arr[i].id)) {
      removed.push(arr[i]);
      indices.push(i);
    }
  }
  if (removed.length > 0) {
    ctx.setPage(slide, page, arr.filter((s) => !idSet.has(s.id)));
    ctx.undoStack.push({ type: "reinsert", slide, page, strokes: removed, indices });
    broadcast({ type: "strokes_removed", source, slide, page, strokeIds });
    ctx.save();
  }
}

function handleClearSlide(source: AnnotationSource, slide: number, page = 0): void {
  const ctx = resolveSource(source);
  if (!ctx) return;
  ctx.setPage(slide, page, []);
  ctx.undoStack.length = 0;
  broadcast({ type: "slide_cleared", source, slide, page });
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
  if (source === "screen") {
    const activeScreen = appState.activeScreen!;
    activeScreen.annotations = {};
    activeScreen.pageCount = 1;
    activeScreen.slide = 0;
  } else if (source === "whiteboard") {
    appState.whiteboard.annotations = {};
    appState.whiteboard.pageCount = 1;
    appState.whiteboard.slide = 0;
  } else {
    const pdf = appState.activePdf!;
    pdf.annotations = {};
    pdf.subPageCounts = {};
    pdf.position = { slide: 0, page: 0 };
  }
  ctx.undoStack.length = 0;
  broadcast({ type: "all_cleared", source });
  ctx.save();
}

function broadcastModeChanged(): void {
  const activeHtml = appState.activeHtml;
  const activeScreen = appState.activeScreen;

  broadcast({
    type: "mode_changed",
    activeMode: appState.activeMode,
    activeHtml:
      appState.activeMode.base === "html" && activeHtml
        ? activeHtml
        : undefined,
    activeScreen:
      appState.activeMode.base === "screen" ? activeScreen : null,
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
  if (mode !== "screen" && appState.activeMode.base === "screen") {
    appState.activeScreen = null;
    screenUndoStack.length = 0;
  }
  if (mode === "screen") {
    appState.activeScreen = { slide: 0, pageCount: 1, annotations: {} };
    screenUndoStack.length = 0;
  }
  appState.activeMode = { base: mode, whiteboard: false, whiteBackground: false };
  broadcastModeChanged();
}

function handleSetWhiteboardMode(enabled: boolean): void {
  appState.activeMode = { ...appState.activeMode, whiteboard: enabled };
  broadcastModeChanged();
}

function handleSetWhiteBackground(enabled: boolean): void {
  appState.activeMode = { ...appState.activeMode, whiteBackground: enabled };
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
    let pdfAnnotations: PdfAnnotationMap | undefined;
    let whiteboardAnnotations: AnnotationMap | undefined;
    let subPageCounts: Record<number, number> | undefined;
    try {
      if (fs.existsSync(annFile)) {
        const raw = parseAnnotationsFile(
          JSON.parse(fs.readFileSync(annFile, "utf8")),
        );
        pdfAnnotations = raw.annotations;
        whiteboardAnnotations = raw.whiteboardAnnotations;
        subPageCounts = raw.subPageCounts;
        console.log(`Annotations loaded from ${annFile}`);
      }
    } catch {
      console.log(`Failed to load annotations from ${annFile}`);
    }

    appState.activePdf = {
      path: toRootRelative(pdfPath),
      name: path.basename(pdfPath),
      pageCount: pageCount,
      position: { slide: 0, page: 0 },
      annotations: pdfAnnotations ?? {},
      subPageCounts: subPageCounts ?? {},
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

server.listen(PORT, HOST, () => {
  const addr = HOST ? `${HOST}:${PORT}` : `0.0.0.0:${PORT}`;
  console.log(`Server running on ${addr}`);
});

if (HOST && HOST !== "localhost" && HOST !== "127.0.0.1") {
  const localhostServer = http.createServer(requestHandler);
  localhostServer.on("upgrade", upgradeHandler);
  localhostServer.listen(PORT, "127.0.0.1", () => {
    console.log(`Server also running on 127.0.0.1:${PORT}`);
  });
}
