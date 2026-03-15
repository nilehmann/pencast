import {
  type ClientMessage,
  type ServerMessage,
} from "../../shared/types";
import { stores } from "./stores.svelte";

// ── Constants ────────────────────────────────────────────────────────────────

/** Backoff delays in ms, indexed by attempt number (0-based). */
export const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000] as const;

// ── Module-level state ───────────────────────────────────────────────────────

let ws: WebSocket | null = null;

/**
 * Set to true by disconnect() / logout() so the onclose handler knows the
 * close was intentional and should NOT trigger the reconnect loop.
 */
let intentionalClose = false;

/** Handle for the pending backoff setTimeout, so it can be cancelled. */
let backoffTimer: ReturnType<typeof setTimeout> | null = null;

// ── Register disconnect with stores so logout() can call it ─────────────────
//
// stores.svelte.ts cannot import from ws-client.ts (that would be circular),
// so we inject the disconnect function once at module initialisation time.

stores.registerDisconnect(rawDisconnect);

// ── Public API ───────────────────────────────────────────────────────────────

type MessageHandler<T extends ServerMessage["type"]> = (
  msg: Extract<ServerMessage, { type: T }>,
) => void;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handlers = new Map<string, MessageHandler<any>>();

export function onMessage<T extends ServerMessage["type"]>(
  type: T,
  handler: MessageHandler<T>,
): void {
  handlers.set(type, handler);
}

export function send(msg: ClientMessage): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
  // Intentionally silent when disconnected/reconnecting — the server is the
  // source of truth and will re-sync state on reconnect via state_sync.
}

/**
 * Open a WebSocket connection.
 *
 * Resolves when the connection is open. The server sends state_sync immediately
 * on connection. Rejects for fatal pre-open failures (upgrade rejected, etc.).
 *
 * Transient connection losses *after* open are handled transparently by the
 * internal reconnect loop; callers do not need to do anything extra.
 */
export function connect(): Promise<void> {
  // Tear down any existing socket before opening a new one so we never leak
  // a stale socket with dangling event handlers.
  rawDisconnect();
  intentionalClose = false; // rawDisconnect sets this to true; reset it

  stores.wsState = "connecting";

  // attempt = 0 means "initial connect, not a retry"
  return openSocket(0);
}

/**
 * Intentionally close the connection without triggering reconnect.
 * Also called by logout() via the registered callback.
 */
export function disconnect(): void {
  rawDisconnect();
  stores.wsState = "disconnected";
  stores.wsReconnectAttempt = 0;
}

// ── Internal: raw teardown ───────────────────────────────────────────────────

function rawDisconnect(): void {
  intentionalClose = true;
  cancelBackoff();
  if (ws) {
    ws.onopen = null;
    ws.onerror = null;
    ws.onclose = null;
    ws.onmessage = null;
    ws.close();
    ws = null;
  }
}

function cancelBackoff(): void {
  if (backoffTimer !== null) {
    clearTimeout(backoffTimer);
    backoffTimer = null;
  }
}

// ── Internal: socket lifecycle ───────────────────────────────────────────────

/**
 * Open a single WebSocket and wire up all lifecycle handlers.
 *
 * @param attempt  0 = initial connect; 1..MAX = reconnect attempt number.
 *                 Passed through into the onclose handler so the retry
 *                 sequence always knows which attempt just failed without
 *                 needing module-level mutable counters.
 */
function openSocket(attempt: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(buildWsUrl());
    ws = socket;

    let opened = false;

    // ── onopen ───────────────────────────────────────────────────────────────

    socket.onopen = () => {
      if (ws !== socket) return; // superseded by a newer connect() call

      opened = true;
      stores.wsState = "connected";
      stores.wsReconnectAttempt = 0;

      resolve();
    };

    // ── onerror ──────────────────────────────────────────────────────────────
    //
    // The browser WebSocket API never exposes the HTTP status code, so we
    // cannot distinguish a 401 from a network error by reading the event.
    // However, an error that fires *before* onopen almost always means the
    // HTTP upgrade was rejected (401 in this app, since the server only rejects
    // authenticated upgrades), so we treat it as a fatal auth failure.
    //
    // An error that fires *after* onopen is a transport-level error on an
    // already-established connection; onclose will fire immediately after and
    // drive the reconnect decision.

    socket.onerror = () => {
      if (ws !== socket) return;

      if (!opened && attempt === 0) {
        // Initial connect failed before open — fatal, reject the promise.
        // onclose will fire after this; use intentionalClose to suppress it.
        intentionalClose = true;
        stores.wsState = "disconnected";
        reject(new Error("WebSocket connection failed"));
      }
      // Post-open errors or reconnect attempt errors: onclose fires next.
    };

    // ── onclose ──────────────────────────────────────────────────────────────
    //
    // This is the single place that decides whether to reconnect. The `attempt`
    // parameter from the enclosing openSocket() call tells us exactly where we
    // are in the sequence without any extra module-level counter.

    socket.onclose = () => {
      if (ws !== socket) return;
      if (intentionalClose) return;

      if (!opened && attempt === 0) {
        // Closed before open on the initial connect with no preceding error
        // event — treat as a transient failure and reject.
        stores.wsState = "disconnected";
        reject(new Error("WebSocket closed before opening"));
        return;
      }

      // Unexpected close (mid-session or during a reconnect attempt).
      scheduleReconnect(attempt + 1);
    };

    // ── onmessage ────────────────────────────────────────────────────────────

    socket.onmessage = (event) => {
      if (ws !== socket) return;
      handleMessage(event);
    };
  });
}

// ── Internal: reconnect loop ─────────────────────────────────────────────────

function scheduleReconnect(attempt: number): void {
  if (attempt > BACKOFF_MS.length) {
    stores.wsState = "disconnected";
    stores.wsReconnectAttempt = 0;
    stores.logout();
    return;
  }

  stores.wsState = "reconnecting";
  stores.wsReconnectAttempt = attempt;

  const delay = BACKOFF_MS[attempt - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
  console.info(
    `WS: reconnect attempt ${attempt}/${BACKOFF_MS.length} in ${delay}ms`,
  );

  backoffTimer = setTimeout(() => {
    backoffTimer = null;
    if (intentionalClose) return;

    stores.wsState = "connecting";

    // Null out the old (closed) socket reference before opening a new one.
    if (ws) {
      ws.onopen = null;
      ws.onerror = null;
      ws.onclose = null;
      ws.onmessage = null;
      ws = null;
    }

    // openSocket's onclose handler will call scheduleReconnect(attempt + 1)
    // if this attempt also fails, naturally threading the counter forward.
    openSocket(attempt).then(
      () => {
        // Successfully reconnected — wsState and stores already updated inside
        // openSocket's onopen handler. Nothing more to do here.
      },
      () => {
        // openSocket only rejects when attempt === 0 (initial connect).
        // During retries all failures go through onclose → scheduleReconnect,
        // so this branch should never be reached. Guard defensively anyway.
      },
    );
  }, delay);
}

// ── Message dispatcher ───────────────────────────────────────────────────────


function handleMessage(event: MessageEvent): void {
  let msg: ServerMessage;
  try {
    msg = JSON.parse(event.data as string) as ServerMessage;
  } catch {
    console.error("WS: invalid JSON", event.data);
    return;
  }

  // console.info("WS recv:", msg.type, msg);

  const handler = handlers.get(msg.type);
  if (handler) {
    handler(msg);
    return;
  }

  switch (msg.type) {
    case "state_sync":
      stores.applyState(msg.state);
      if (msg.state.activePendingStroke) {
        stores.pendingStrokes = new Map([
          [
            msg.state.activePendingStroke.strokeId,
            msg.state.activePendingStroke,
          ],
        ]);
      }
      break;
    case "slide_changed":
      if (msg.source === "whiteboard") {
        stores.whiteboard.slide = msg.slide;
      } else if (msg.source === "html") {
        if (stores.activeHtml) {
          stores.activeHtml.slide = msg.slide;
        }
      } else {
        if (stores.activePdf) {
          stores.activePdf.currentSlide = msg.slide;
        }
      }
      break;
    case "stroke_begin": {
      const m = new Map(stores.pendingStrokes);
      m.set(msg.strokeId, {
        strokeId: msg.strokeId,
        source: msg.source,
        slide: msg.slide,
        tool: msg.tool,
        color: msg.color,
        thickness: msg.thickness,
        points: [],
      });
      stores.pendingStrokes = m;
      break;
    }
    case "stroke_point": {
      const entry = stores.pendingStrokes.get(msg.strokeId);
      if (entry) {
        const m = new Map(stores.pendingStrokes);
        const isShape = ["arrow", "box", "ellipse"].includes(entry.tool);
        m.set(msg.strokeId, {
          ...entry,
          points: isShape ? msg.points : [...entry.points, ...msg.points],
        });
        stores.pendingStrokes = m;
      }
      break;
    }
    case "stroke_abandon": {
      const m = new Map(stores.pendingStrokes);
      m.delete(msg.strokeId);
      stores.pendingStrokes = m;
      break;
    }
    case "strokes_added": {
      const m = new Map(stores.pendingStrokes);
      for (const s of msg.strokes) m.delete(s.id);
      stores.pendingStrokes = m;
      stores.patchAnnotations(msg.source, msg.slide, (p) => [...p, ...msg.strokes]);
      break;
    }
    case "strokes_updated": {
      stores.movePreviewHiddenIds = new Set();
      stores.movePreviewStrokes = new Map();
      const updatedMap = new Map(msg.strokes.map((s) => [s.id, s]));
      stores.patchAnnotations(msg.source, msg.slide, (p) =>
        p.map((s) => updatedMap.get(s.id) ?? s),
      );
      break;
    }
    case "strokes_move_preview": {
      const map = new Map<string, (typeof msg.strokes)[number]>();
      for (const s of msg.strokes) map.set(s.id, s);
      stores.movePreviewStrokes = map;
      break;
    }
    case "move_preview_begin":
      stores.movePreviewHiddenIds = new Set(msg.strokeIds);
      break;
    case "move_preview_cancel":
      stores.movePreviewHiddenIds = new Set();
      stores.movePreviewStrokes = new Map();
      break;
    case "stroke_undone":
      stores.patchAnnotations(msg.source, msg.slide, (p) =>
        p.filter((s) => s.id !== msg.strokeId),
      );
      break;
    case "strokes_removed": {
      const idSet = new Set(msg.strokeIds);
      stores.patchAnnotations(msg.source, msg.slide, (p) =>
        p.filter((s) => !idSet.has(s.id)),
      );
      break;
    }
    case "strokes_reinserted": {
      stores.patchAnnotations(msg.source, msg.slide, (page) => {
        const result = [...page];
        const pairs = msg.strokes
          .map((s, i) => ({ stroke: s, index: msg.indices[i] }))
          .sort((a, b) => a.index - b.index);
        for (const { stroke, index } of pairs) {
          result.splice(Math.min(index, result.length), 0, stroke);
        }
        return result;
      });
      break;
    }
    case "slide_cleared":
      stores.patchAnnotations(msg.source, msg.slide, () => []);
      break;
    case "all_cleared":
      if (msg.source === "html") {
        stores.clearHtml();
      } else if (msg.source === "whiteboard") {
        stores.clearWhiteboard();
      } else {
        stores.clearPdf();
      }
      break;
    case "pdf_loaded":
      stores.activePdf = msg.pdf;
      stores.activeMode = { base: "pdf", whiteboard: false };
      stores.whiteboard = msg.whiteboard;
      break;
    case "mode_changed": {
      stores.activeMode = msg.activeMode;
      const activeHtml = msg.activeHtml;
      if (msg.activeMode.base === "html" && activeHtml) {
        stores.activeHtml = activeHtml;
      } else {
        stores.activeHtml = null;
      }
      break;
    }

    case "whiteboard_page_added":
      stores.whiteboard.pageCount = msg.pageCount;
      stores.whiteboard.slide = msg.slide;
      break;

    case "html_page_added": {
      const activeHtml = stores.activeHtml;
      if (activeHtml) {
        activeHtml.pageCount = msg.pageCount;
        activeHtml.slide = msg.slide;
      }
      break;
    }

    case "html_dom_relay":
      if (stores.activeHtml) {
        stores.activeHtml.latestDom = {
          html: msg.html,
          viewerWidth: msg.viewerWidth,
          viewerHeight: msg.viewerHeight,
          scrollX: msg.scrollX,
          scrollY: msg.scrollY,
        };
      }
      break;

    case "error":
      console.error("Server error:", msg.message);
      break;
  }
}

// ── URL builder ──────────────────────────────────────────────────────────────

function buildWsUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  // In dev (Vite on 5173), the Vite proxy handles /ws → localhost:3001.
  // In prod, connect directly to the same host.
  return `${proto}//${location.host}/ws`;
}
