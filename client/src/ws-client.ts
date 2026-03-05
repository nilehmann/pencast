import type { ClientMessage, ServerMessage } from "../../shared/types";
import {
  applyState,
  annotations,
  currentSlide,
  activePdfPath,
  activePdfName,
  pageCount,
  wsState,
  wsReconnectAttempt,
  logout,
  registerDisconnect,
} from "./stores";

// ── Constants ────────────────────────────────────────────────────────────────

/** Backoff delays in ms, indexed by attempt number (0-based). */
export const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000] as const;

// ── Module-level state ───────────────────────────────────────────────────────

let ws: WebSocket | null = null;

/**
 * The auth token last passed to connect(). Needed by the reconnect loop so
 * it can reopen the socket without requiring the caller to pass it again.
 */
let currentToken = "";

/**
 * Set to true by disconnect() / logout() so the onclose handler knows the
 * close was intentional and should NOT trigger the reconnect loop.
 */
let intentionalClose = false;

/**
 * Set to true when we observe an error-before-open during the reconnect loop.
 * On exhaustion we then do a full logout (token cleared) rather than a soft one.
 */
let reconnectGot401 = false;

/** Handle for the pending backoff setTimeout, so it can be cancelled. */
let backoffTimer: ReturnType<typeof setTimeout> | null = null;

// ── Register disconnect with stores so logout() can call it ─────────────────
//
// stores.ts cannot import from ws-client.ts (that would be circular), so we
// inject the disconnect function once at module initialisation time.

registerDisconnect(rawDisconnect);

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
export function connect(token: string): Promise<void> {
  // Tear down any existing socket before opening a new one so we never leak
  // a stale socket with dangling event handlers.
  rawDisconnect();
  intentionalClose = false; // rawDisconnect sets this to true; reset it
  reconnectGot401 = false;

  currentToken = token;
  wsState.set("connecting");

  // attempt = 0 means "initial connect, not a retry"
  return openSocket(0);
}

/**
 * Intentionally close the connection without triggering reconnect.
 * Also called by logout() via the registered callback.
 */
export function disconnect(): void {
  rawDisconnect();
  wsState.set("disconnected");
  wsReconnectAttempt.set(0);
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
    const socket = new WebSocket(buildWsUrl(currentToken));
    ws = socket;

    let opened = false;

    // ── onopen ───────────────────────────────────────────────────────────────

    socket.onopen = () => {
      if (ws !== socket) return; // superseded by a newer connect() call

      opened = true;
      wsState.set("connected");
      wsReconnectAttempt.set(0);
      reconnectGot401 = false;

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

      if (!opened) {
        if (attempt === 0) {
          // Initial connect failed before open — fatal, reject the promise.
          // onclose will fire after this; use intentionalClose to suppress it.
          intentionalClose = true;
          wsState.set("disconnected");
          reject(new Error("WebSocket upgrade rejected"));
        } else {
          // Reconnect attempt failed before open — treat as 401 / auth failure.
          // Let onclose drive the next attempt or final exhaustion.
          reconnectGot401 = true;
        }
      }
      // Post-open errors: do nothing here; onclose fires next.
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
        wsState.set("disconnected");
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
    wsState.set("disconnected");
    wsReconnectAttempt.set(0);
    // Full logout (clears token → PIN screen) if we saw a 401 during the loop;
    // soft logout (keeps token → role-selection screen) otherwise.
    logout(reconnectGot401);
    return;
  }

  wsState.set("reconnecting");
  wsReconnectAttempt.set(attempt);

  const delay = BACKOFF_MS[attempt - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
  console.info(
    `WS: reconnect attempt ${attempt}/${BACKOFF_MS.length} in ${delay}ms`,
  );

  backoffTimer = setTimeout(() => {
    backoffTimer = null;
    if (intentionalClose) return;

    wsState.set("connecting");

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

  console.info("WS recv:", msg.type, msg);

  const handler = handlers.get(msg.type);
  if (handler) {
    handler(msg);
    return;
  }

  switch (msg.type) {
    case "state_sync":
      applyState(msg.state);
      break;
    case "slide_changed":
      currentSlide.set(msg.slide);
      break;
    case "stroke_added":
      annotations.update((ann) => {
        const page = ann[msg.slide] ?? [];
        return { ...ann, [msg.slide]: [...page, msg.stroke] };
      });
      break;
    case "strokes_updated": {
      const updatedMap = new Map(msg.strokes.map((s) => [s.id, s]));
      annotations.update((ann) => {
        const page = (ann[msg.slide] ?? []).map((s) =>
          updatedMap.has(s.id) ? updatedMap.get(s.id)! : s,
        );
        return { ...ann, [msg.slide]: page };
      });
      break;
    }
    case "stroke_undone":
      annotations.update((ann) => {
        const page = (ann[msg.slide] ?? []).filter(
          (s) => s.id !== msg.strokeId,
        );
        return { ...ann, [msg.slide]: page };
      });
      break;
    case "strokes_removed": {
      const idSet = new Set(msg.strokeIds);
      annotations.update((ann) => {
        const page = (ann[msg.slide] ?? []).filter((s) => !idSet.has(s.id));
        return { ...ann, [msg.slide]: page };
      });
      break;
    }
    case "strokes_reinserted": {
      annotations.update((ann) => {
        const page = [...(ann[msg.slide] ?? [])];
        const pairs = msg.strokes
          .map((s, i) => ({ stroke: s, index: msg.indices[i] }))
          .sort((a, b) => a.index - b.index);
        for (const { stroke, index } of pairs) {
          page.splice(Math.min(index, page.length), 0, stroke);
        }
        return { ...ann, [msg.slide]: page };
      });
      break;
    }
    case "slide_cleared":
      annotations.update((ann) => ({ ...ann, [msg.slide]: [] }));
      break;
    case "all_cleared":
      annotations.set({});
      break;
    case "pdf_loaded":
      activePdfPath.set(msg.path);
      activePdfName.set(msg.name);
      pageCount.set(msg.pageCount);
      currentSlide.set(0);
      annotations.set(msg.annotations);
      break;
    case "error":
      console.error("Server error:", msg.message);
      break;
  }
}

// ── URL builder ──────────────────────────────────────────────────────────────

function buildWsUrl(token: string): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  // In dev (Vite on 5173), the Vite proxy handles /ws → localhost:3001.
  // In prod, connect directly to the same host.
  const host = location.host;
  return `${proto}//${host}/ws?token=${encodeURIComponent(token)}`;
}
