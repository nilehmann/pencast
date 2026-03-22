import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { PencastClient } from './lib/ws.js';
import { OverlayActor } from './lib/renderer.js';

let overlayActor = null;
let client = null;

export function enable() {
  overlayActor = new OverlayActor(0);
  Main.uiGroup.add_child(overlayActor);

  client = new PencastClient('ws://localhost:3001/ws');

  client.onStrokesAdded = (strokes) => overlayActor.addStrokes(strokes);
  client.onStrokesRemoved = (ids) => overlayActor.removeStrokes(ids);
  client.onStrokesUpdated = (strokes) => overlayActor.updateStrokes(strokes);
  client.onPendingStroke = (id, data) => overlayActor.setPendingStroke(id, data);
  client.onPendingStrokeRemoved = (id) => overlayActor.removePendingStroke(id);
  client.onAllCleared = () => overlayActor.clearAll();
  client.onModeChanged = (mode, cropTop) => {
    overlayActor.visible = mode.base === 'screen' && !mode.whiteboard;
    overlayActor.setCropTop(cropTop);
    if (mode.base !== 'screen') overlayActor.clearAll();
  };

  client.connect();
}

export function disable() {
  client?.disconnect();
  client = null;

  overlayActor?.destroy();
  overlayActor = null;
}
