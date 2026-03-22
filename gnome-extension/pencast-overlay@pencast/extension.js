import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { PencastClient } from './lib/ws.js';
import { OverlayActor } from './lib/renderer.js';

export default class PencastOverlay extends Extension {
  #overlayActor = null;
  #client = null;

  enable() {
    this.#overlayActor = new OverlayActor(0);
    Main.uiGroup.add_child(this.#overlayActor);

    this.#client = new PencastClient('ws://localhost:3001/ws');

    this.#client.onStrokesAdded = (strokes) => this.#overlayActor.addStrokes(strokes);
    this.#client.onStrokesRemoved = (ids) => this.#overlayActor.removeStrokes(ids);
    this.#client.onStrokesUpdated = (strokes) => this.#overlayActor.updateStrokes(strokes);
    this.#client.onPendingStroke = (id, data) => this.#overlayActor.setPendingStroke(id, data);
    this.#client.onPendingStrokeRemoved = (id) => this.#overlayActor.removePendingStroke(id);
    this.#client.onAllCleared = () => this.#overlayActor.clearAll();
    this.#client.onModeChanged = (mode, cropTop) => {
      this.#overlayActor.visible = mode.base === 'screen' && !mode.whiteboard;
      this.#overlayActor.setCropTop(cropTop);
      if (mode.base !== 'screen') this.#overlayActor.clearAll();
    };

    this.#client.connect();
  }

  disable() {
    this.#client?.disconnect();
    this.#client = null;

    this.#overlayActor?.destroy();
    this.#overlayActor = null;
  }
}
