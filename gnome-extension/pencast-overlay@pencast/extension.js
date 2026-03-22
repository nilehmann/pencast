import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { PencastClient } from './lib/ws.js';
import { OverlayActor } from './lib/renderer.js';

export default class PencastOverlay extends Extension {
  #overlayActor = null;
  #client = null;
  #indicator = null;
  #icon = null;
  #badge = null;
  #active = false;

  enable() {
    const container = new St.Widget({ layout_manager: new Clutter.BinLayout() });

    this.#icon = new St.Icon({
      gicon: this.#gicon('pencast-off-symbolic'),
      icon_size: 16,
    });

    this.#badge = new St.Widget({
      style: 'border-radius: 5px; width: 8px; height: 8px;',
      x_align: Clutter.ActorAlign.END,
      y_align: Clutter.ActorAlign.END,
      visible: false,
    });

    container.add_child(this.#icon);
    container.add_child(this.#badge);

    this.#indicator = new PanelMenu.Button(0, 'PencastOverlay', true);
    this.#indicator.add_child(container);
    this.#indicator.connect('button-press-event', () => this.#toggle());
    Main.panel.addToStatusArea('pencast-overlay', this.#indicator);
  }

  disable() {
    this.#teardown();
    this.#indicator?.destroy();
    this.#indicator = null;
    this.#icon = null;
    this.#badge = null;
  }

  #gicon(name) {
    return new Gio.FileIcon({
      file: Gio.File.new_for_path(`${this.path}/icons/${name}.svg`),
    });
  }

  #toggle() {
    if (this.#active) {
      this.#teardown();
    } else {
      this.#setup();
    }
  }

  #setup() {
    this.#active = true;
    this.#setState('disconnected');

    this.#overlayActor = new OverlayActor(0);
    Main.uiGroup.add_child(this.#overlayActor);

    this.#client = new PencastClient('ws://localhost:3001/ws');
    this.#client.onConnected = () => this.#setState('connected');
    this.#client.onDisconnected = () => this.#setState('disconnected');
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
    this.#client.onMovePreviewBegin = (ids) => this.#overlayActor.movePreviewBegin(ids);
    this.#client.onMovePreview = (strokes) => this.#overlayActor.updateMovePreview(strokes);
    this.#client.onMovePreviewCancel = () => this.#overlayActor.cancelMovePreview();

    this.#client.connect();
  }

  #teardown() {
    this.#client?.disconnect();
    this.#client = null;
    this.#overlayActor?.destroy();
    this.#overlayActor = null;
    this.#active = false;
    this.#setState('off');
  }

  #setState(state) {
    if (!this.#icon || !this.#badge) return;
    if (state === 'off') {
      this.#icon.gicon = this.#gicon('pencast-off-symbolic');
      this.#badge.visible = false;
    } else {
      this.#icon.gicon = this.#gicon('pencast-symbolic');
      this.#badge.visible = true;
      this.#badge.style = state === 'connected'
        ? 'border-radius: 5px; width: 8px; height: 8px; background-color: #22c55e;'
        : 'border-radius: 5px; width: 8px; height: 8px; background-color: #f59e0b;';
    }
  }
}
