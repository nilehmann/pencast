import type { ClientMessage, ServerMessage } from "../../shared/types";
import {
  applyState,
  annotations,
  currentSlide,
  activePdfPath,
  activePdfName,
  pageCount,
} from "./stores";

let ws: WebSocket | null = null;

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
}

export function connect(
  token: string,
  role: import("../../shared/types").DeviceRole,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const wsUrl = buildWsUrl(token);
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      send({ type: "hello", role });
      resolve();
    };

    ws.onerror = (e) => reject(e);

    ws.onmessage = (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data as string) as ServerMessage;
      } catch {
        console.error("WS: invalid JSON", event.data);
        return;
      }

      console.log("WS recv:", msg.type, msg);

      const handler = handlers.get(msg.type);
      if (handler) {
        handler(msg);
        return;
      }

      // Built-in handlers
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
        case "stroke_undone":
          annotations.update((ann) => {
            const page = (ann[msg.slide] ?? []).filter(
              (s) => s.id !== msg.strokeId,
            );
            return { ...ann, [msg.slide]: page };
          });
          break;
        case "stroke_removed":
          annotations.update((ann) => {
            const page = (ann[msg.slide] ?? []).filter(
              (s) => s.id !== msg.strokeId,
            );
            return { ...ann, [msg.slide]: page };
          });
          break;
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
    };

    ws.onclose = () => {
      console.log("WS disconnected");
    };
  });
}

export function disconnect(): void {
  if (ws) {
    ws.onclose = null; // suppress the console log
    ws.close();
    ws = null;
  }
}

function buildWsUrl(token: string): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  // In dev (Vite on 5173), proxy handles /ws → localhost:3001
  // In prod, connect directly to same host
  const host = location.host;
  return `${proto}//${host}/ws?token=${encodeURIComponent(token)}`;
}
