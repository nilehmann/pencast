// PencastClient — GJS WebSocket client
// Connects to the pencast server and dispatches annotation events.

export class PencastClient {
  #url;
  #ws = null;
  #reconnectTimer = null;
  #intentionalClose = false;

  // Callbacks set by the caller (extension.js)
  onStrokesAdded = null;
  onStrokesRemoved = null;
  onStrokesUpdated = null;
  onPendingStroke = null;
  onPendingStrokeRemoved = null;
  onAllCleared = null;
  onModeChanged = null;

  constructor(url) {
    this.#url = url;
  }

  connect() {
    this.#intentionalClose = false;
    this.#openSocket();
  }

  disconnect() {
    this.#intentionalClose = true;
    if (this.#reconnectTimer !== null) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    if (this.#ws) {
      this.#ws.close();
      this.#ws = null;
    }
  }

  #openSocket() {
    try {
      this.#ws = new WebSocket(this.#url);
    } catch (e) {
      console.error(`[pencast-overlay] WebSocket error: ${e}`);
      this.#scheduleReconnect();
      return;
    }

    this.#ws.onopen = () => {
      console.log('[pencast-overlay] Connected to pencast server');
    };

    this.#ws.onclose = () => {
      this.#ws = null;
      if (!this.#intentionalClose) {
        console.log('[pencast-overlay] Connection closed, reconnecting in 3s…');
        this.#scheduleReconnect();
      }
    };

    this.#ws.onerror = (e) => {
      console.error(`[pencast-overlay] WebSocket error: ${e}`);
    };

    this.#ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      this.#handleMessage(msg);
    };
  }

  #scheduleReconnect() {
    if (this.#intentionalClose) return;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      if (!this.#intentionalClose) this.#openSocket();
    }, 3000);
  }

  #handleMessage(msg) {
    switch (msg.type) {
      case 'state_sync': {
        const { activeMode, activeScreen, cropTop } = msg.state;
        this.onModeChanged?.(activeMode, cropTop ?? 0);
        if (activeMode.base === 'screen' && activeScreen) {
          // Replay all existing strokes
          for (const [, strokes] of Object.entries(activeScreen.annotations)) {
            if (strokes.length) this.onStrokesAdded?.(strokes);
          }
        }
        break;
      }
      case 'mode_changed':
        this.onModeChanged?.(msg.activeMode, msg.cropTop ?? 0);
        if (msg.activeMode.base !== 'screen') {
          this.onAllCleared?.();
        } else if (msg.activeScreen) {
          for (const [, strokes] of Object.entries(msg.activeScreen.annotations)) {
            if (strokes.length) this.onStrokesAdded?.(strokes);
          }
        }
        break;
      case 'strokes_added':
        if (msg.source === 'screen') this.onStrokesAdded?.(msg.strokes);
        break;
      case 'strokes_removed':
        if (msg.source === 'screen') this.onStrokesRemoved?.(msg.strokeIds);
        break;
      case 'strokes_updated':
        if (msg.source === 'screen') this.onStrokesUpdated?.(msg.strokes);
        break;
      case 'stroke_begin':
        if (msg.source === 'screen') {
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
        if (msg.source === 'screen') this.onStrokesAdded?.(msg.strokes);
        break;
      case 'all_cleared':
        if (msg.source === 'screen') this.onAllCleared?.();
        break;
      case 'slide_cleared':
        if (msg.source === 'screen') this.onAllCleared?.();
        break;
    }
  }
}
