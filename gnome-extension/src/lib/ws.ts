// PencastClient — GJS WebSocket client
// Connects to the pencast server and dispatches annotation events.

import Soup from "gi://Soup";
import GLib from "gi://GLib";

import type {
  ActiveMode,
  AnnotationStroke,
  AnnotationTool,
  StrokeColor,
  StrokeThickness,
  NormalizedPoint,
  ScreenState,
} from "../../../shared/types.ts";

export interface Delegate {
  onConnected?: () => void;
  onDisconnected?: () => void;
  onStrokesAdded?: (strokes: AnnotationStroke[]) => void;
  onStrokesRemoved?: (ids: string[]) => void;
  onStrokesUpdated?: (strokes: AnnotationStroke[]) => void;
  onPendingStroke?: (id: string, data: PendingStrokeData) => void;
  onPendingStrokeRemoved?: (id: string) => void;
  onAllCleared?: () => void;
  onModeChanged?: (mode: ActiveMode) => void;
  onCaptureInfo?: (w: number, h: number) => void;
  onMovePreviewBegin?: (ids: string[]) => void;
  onMovePreview?: (strokes: AnnotationStroke[]) => void;
  onMovePreviewCancel?: () => void;
}

export class PencastClient {
  readonly #url: string;
  #session: Soup.Session;
  #conn: Soup.WebsocketConnection | null = null;
  #reconnectSource: number | null = null;
  #intentionalClose = false;
  #screenSlide = 0;
  #delegate: Delegate;

  constructor(url: string, delegate: Delegate) {
    this.#url = url;
    this.#session = new Soup.Session();
    this.#delegate = delegate;
  }

  connect(): void {
    this.#intentionalClose = false;
    this.#openSocket();
  }

  send(msg: object): void {
    if (!this.#conn) return;
    this.#conn.send_text(JSON.stringify(msg));
  }

  disconnect(): void {
    this.#intentionalClose = true;
    this.#cancelReconnect();
    if (this.#conn) {
      this.#conn.close(Soup.WebsocketCloseCode.NORMAL, null);
      this.#conn = null;
    }
  }

  #openSocket(): void {
    const message = new Soup.Message({
      method: "GET",
      uri: GLib.Uri.parse(this.#url, GLib.UriFlags.NONE),
    });
    this.#session.websocket_connect_async(
      message,
      null,
      [],
      0,
      null,
      (session, result) => {
        if (!session) {
          console.error(`[pencast-overlay] Session is null`);
          return;
        }
        try {
          this.#conn = session.websocket_connect_finish(result);
          this.#conn.max_incoming_payload_size = 0; // unlimited
        } catch (e) {
          console.error(`[pencast-overlay] WebSocket connect failed: ${e}`);
          this.#scheduleReconnect();
          return;
        }

        console.log("[pencast-overlay] Connected to pencast server");
        this.#delegate.onConnected?.();
        this.#conn.connect("message", (_conn, _type, data) => {
          let msg: any;
          try {
            const bytes =
              data instanceof Uint8Array
                ? data
                : new Uint8Array(data.get_data() || []);
            const text = new TextDecoder().decode(bytes);
            msg = JSON.parse(text);
          } catch {
            return;
          }
          this.#handleMessage(msg);
        });

        this.#conn.connect("closed", () => {
          this.#conn = null;
          if (!this.#intentionalClose) {
            console.log(
              "[pencast-overlay] Connection closed, reconnecting in 3s…",
            );
            this.#delegate.onDisconnected?.();
            this.#scheduleReconnect();
          }
        });

        this.#conn.connect("error", (_conn, err) => {
          console.error(`[pencast-overlay] WebSocket error: ${err}`);
        });
      },
    );
  }

  #scheduleReconnect(): void {
    if (this.#intentionalClose) return;
    this.#reconnectSource = GLib.timeout_add_seconds(
      GLib.PRIORITY_DEFAULT,
      3,
      () => {
        this.#reconnectSource = null;
        if (!this.#intentionalClose) this.#openSocket();
        return GLib.SOURCE_REMOVE;
      },
    );
  }

  #cancelReconnect(): void {
    if (this.#reconnectSource !== null) {
      GLib.Source.remove(this.#reconnectSource);
      this.#reconnectSource = null;
    }
  }

  #handleMessage(msg: any): void {
    switch (msg.type) {
      case "state_sync": {
        const { activeMode, activeScreen } = msg.state as {
          activeMode: ActiveMode;
          activeScreen: ScreenState | null;
        };
        this.#delegate.onModeChanged?.(activeMode);
        if (activeMode.base === "screen" && activeScreen?.captureWidth) {
          this.#delegate.onCaptureInfo?.(
            activeScreen.captureWidth,
            activeScreen.captureHeight!,
          );
        }
        if (activeMode.base === "screen" && activeScreen) {
          this.#screenSlide = activeScreen.slide;
          const strokes: AnnotationStroke[] =
            activeScreen.annotations[activeScreen.slide] ?? [];
          if (strokes.length) this.#delegate.onStrokesAdded?.(strokes);
        }
        break;
      }
      case "mode_changed": {
        this.#delegate.onModeChanged?.(msg.activeMode as ActiveMode);
        const s: ScreenState | undefined = msg.activeScreen;
        if (msg.activeMode?.base === "screen" && s?.captureWidth) {
          this.#delegate.onCaptureInfo?.(s.captureWidth!, s.captureHeight!);
        }
        if (msg.activeMode.base !== "screen") {
          this.#delegate.onAllCleared?.();
        } else if (msg.activeScreen) {
          this.#screenSlide = msg.activeScreen.slide;
          this.#delegate.onAllCleared?.();
          const strokes: AnnotationStroke[] =
            msg.activeScreen.annotations[msg.activeScreen.slide] ?? [];
          if (strokes.length) this.#delegate.onStrokesAdded?.(strokes);
        }
        break;
      }
      case "slide_changed":
        if (msg.source === "screen") {
          this.#screenSlide = msg.slide as number;
          this.#delegate.onAllCleared?.();
          if ((msg.strokes as AnnotationStroke[] | undefined)?.length)
            this.#delegate.onStrokesAdded?.(msg.strokes);
        }
        break;
      case "screen_page_added":
        this.#screenSlide = msg.slide as number;
        this.#delegate.onAllCleared?.();
        break;
      case "strokes_added":
        if (msg.source === "screen" && msg.slide === this.#screenSlide)
          this.#delegate.onStrokesAdded?.(msg.strokes);
        break;
      case "strokes_removed":
        if (msg.source === "screen" && msg.slide === this.#screenSlide)
          this.#delegate.onStrokesRemoved?.(msg.strokeIds);
        break;
      case "strokes_updated":
        if (msg.source === "screen" && msg.slide === this.#screenSlide)
          this.#delegate.onStrokesUpdated?.(msg.strokes);
        break;
      case "stroke_begin":
        if (msg.source === "screen" && msg.slide === this.#screenSlide) {
          this.#delegate.onPendingStroke?.(msg.strokeId as string, {
            tool: msg.tool as AnnotationTool,
            color: msg.color as StrokeColor,
            thickness: msg.thickness as StrokeThickness,
            points: [],
          });
        }
        break;
      case "stroke_point":
        if (msg.source === "screen") {
          this.#delegate.onPendingStroke?.(msg.strokeId as string, {
            points: msg.points as NormalizedPoint[],
            append: true,
          });
        }
        break;
      case "stroke_abandon":
        if (msg.source === "screen")
          this.#delegate.onPendingStrokeRemoved?.(msg.strokeId as string);
        break;
      case "stroke_undone":
        if (msg.source === "screen")
          this.#delegate.onStrokesRemoved?.([msg.strokeId as string]);
        break;
      case "strokes_reinserted":
        if (msg.source === "screen" && msg.slide === this.#screenSlide)
          this.#delegate.onStrokesAdded?.(msg.strokes);
        break;
      case "move_preview_begin":
        if (msg.source === "screen" && msg.slide === this.#screenSlide)
          this.#delegate.onMovePreviewBegin?.(msg.strokeIds);
        break;
      case "strokes_move_preview":
        if (msg.source === "screen" && msg.slide === this.#screenSlide)
          this.#delegate.onMovePreview?.(msg.strokes);
        break;
      case "move_preview_cancel":
        if (msg.source === "screen" && msg.slide === this.#screenSlide)
          this.#delegate.onMovePreviewCancel?.();
        break;
      case "all_cleared":
        if (msg.source === "screen") {
          this.#screenSlide = 0;
          this.#delegate.onAllCleared?.();
        }
        break;
      case "slide_cleared":
        if (msg.source === "screen" && msg.slide === this.#screenSlide)
          this.#delegate.onAllCleared?.();
        break;
    }
  }
}

export interface PendingStrokeData {
  tool?: AnnotationTool;
  color?: StrokeColor;
  thickness?: StrokeThickness;
  points?: NormalizedPoint[];
  append?: boolean;
}
