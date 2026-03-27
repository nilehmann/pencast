// PencastClient — GJS WebSocket client
// Connects to the pencast server and dispatches annotation events.

import Soup from 'gi://Soup';
import GLib from 'gi://GLib';

export class PencastClient {
  #url;
  #session = null;
  #conn = null;          // Soup.WebsocketConnection
  #reconnectSource = null;
  #intentionalClose = false;
  #screenSlide = 0;

  // Callbacks set by the caller (extension.js)
  onConnected = null;
  onDisconnected = null;
  onStrokesAdded = null;
  onStrokesRemoved = null;
  onStrokesUpdated = null;
  onPendingStroke = null;
  onPendingStrokeRemoved = null;
  onAllCleared = null;
  onModeChanged = null;
  onMovePreviewBegin = null;
  onMovePreview = null;
  onMovePreviewCancel = null;

  constructor(url) {
    this.#url = url;
    this.#session = new Soup.Session();
  }

  connect() {
    this.#intentionalClose = false;
    this.#openSocket();
  }

  disconnect() {
    this.#intentionalClose = true;
    this.#cancelReconnect();
    if (this.#conn) {
      this.#conn.close(Soup.WebsocketCloseCode.NORMAL, null);
      this.#conn = null;
    }
  }

  #openSocket() {
    const message = new Soup.Message({ method: 'GET', uri: GLib.Uri.parse(this.#url, GLib.UriFlags.NONE) });
    this.#session.websocket_connect_async(message, null, [], 0, null, (session, result) => {
      try {
        this.#conn = session.websocket_connect_finish(result);
        this.#conn.max_incoming_payload_size = 0; // unlimited
      } catch (e) {
        console.error(`[pencast-overlay] WebSocket connect failed: ${e}`);
        this.#scheduleReconnect();
        return;
      }

      console.log('[pencast-overlay] Connected to pencast server');
      this.onConnected?.();

      this.#conn.connect('message', (_conn, _type, data) => {
        let msg;
        try {
          const bytes = data instanceof Uint8Array ? data : new Uint8Array(data.get_data());
          const text = new TextDecoder().decode(bytes);
          msg = JSON.parse(text);
        } catch {
          return;
        }
        this.#handleMessage(msg);
      });

      this.#conn.connect('closed', () => {
        this.#conn = null;
        if (!this.#intentionalClose) {
          console.log('[pencast-overlay] Connection closed, reconnecting in 3s…');
          this.onDisconnected?.();
          this.#scheduleReconnect();
        }
      });

      this.#conn.connect('error', (_conn, err) => {
        console.error(`[pencast-overlay] WebSocket error: ${err}`);
      });
    });
  }

  #scheduleReconnect() {
    if (this.#intentionalClose) return;
    this.#reconnectSource = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 3, () => {
      this.#reconnectSource = null;
      if (!this.#intentionalClose) this.#openSocket();
      return GLib.SOURCE_REMOVE;
    });
  }

  #cancelReconnect() {
    if (this.#reconnectSource !== null) {
      GLib.Source.remove(this.#reconnectSource);
      this.#reconnectSource = null;
    }
  }

  #handleMessage(msg) {
    switch (msg.type) {
      case 'state_sync': {
        const { activeMode, activeScreen } = msg.state;
        this.onModeChanged?.(activeMode);
        if (activeMode.base === 'screen' && activeScreen) {
          this.#screenSlide = activeScreen.slide;
          const strokes = activeScreen.annotations[activeScreen.slide] ?? [];
          if (strokes.length) this.onStrokesAdded?.(strokes);
        }
        break;
      }
      case 'mode_changed':
        this.onModeChanged?.(msg.activeMode);
        if (msg.activeMode.base !== 'screen') {
          this.onAllCleared?.();
        } else if (msg.activeScreen) {
          this.#screenSlide = msg.activeScreen.slide;
          this.onAllCleared?.();
          const strokes = msg.activeScreen.annotations[msg.activeScreen.slide] ?? [];
          if (strokes.length) this.onStrokesAdded?.(strokes);
        }
        break;
      case 'slide_changed':
        if (msg.source === 'screen') {
          this.#screenSlide = msg.slide;
          this.onAllCleared?.();
          if (msg.strokes?.length) this.onStrokesAdded?.(msg.strokes);
        }
        break;
      case 'screen_page_added':
        this.#screenSlide = msg.slide;
        this.onAllCleared?.();
        break;
      case 'strokes_added':
        if (msg.source === 'screen' && msg.slide === this.#screenSlide) this.onStrokesAdded?.(msg.strokes);
        break;
      case 'strokes_removed':
        if (msg.source === 'screen' && msg.slide === this.#screenSlide) this.onStrokesRemoved?.(msg.strokeIds);
        break;
      case 'strokes_updated':
        if (msg.source === 'screen' && msg.slide === this.#screenSlide) this.onStrokesUpdated?.(msg.strokes);
        break;
      case 'stroke_begin':
        if (msg.source === 'screen' && msg.slide === this.#screenSlide) {
          this.onPendingStroke?.(msg.strokeId, {
            tool: msg.tool,
            color: msg.color,
            thickness: msg.thickness,
            points: [],
          });
        }
        break;
      case 'stroke_point':
        if (msg.source === 'screen') {
          // Pass as update — renderer will merge
          this.onPendingStroke?.(msg.strokeId, { points: msg.points, append: true });
        }
        break;
      case 'stroke_abandon':
        if (msg.source === 'screen') this.onPendingStrokeRemoved?.(msg.strokeId);
        break;
      case 'stroke_undone':
        if (msg.source === 'screen') this.onStrokesRemoved?.([msg.strokeId]);
        break;
      case 'strokes_reinserted':
        if (msg.source === 'screen' && msg.slide === this.#screenSlide) this.onStrokesAdded?.(msg.strokes);
        break;
      case 'move_preview_begin':
        if (msg.source === 'screen' && msg.slide === this.#screenSlide) this.onMovePreviewBegin?.(msg.strokeIds);
        break;
      case 'strokes_move_preview':
        if (msg.source === 'screen' && msg.slide === this.#screenSlide) this.onMovePreview?.(msg.strokes);
        break;
      case 'move_preview_cancel':
        if (msg.source === 'screen' && msg.slide === this.#screenSlide) this.onMovePreviewCancel?.();
        break;
      case 'all_cleared':
        if (msg.source === 'screen') {
          this.#screenSlide = 0;
          this.onAllCleared?.();
        }
        break;
      case 'slide_cleared':
        if (msg.source === 'screen' && msg.slide === this.#screenSlide) this.onAllCleared?.();
        break;
    }
  }
}
