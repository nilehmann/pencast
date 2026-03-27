import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Meta from 'gi://Meta';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
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
  #trackedSignals = [];
  #captureInfo = null;  // { captureWidth, captureHeight } — stored for menu rebuilds
  #fullMonitor = false;

  enable() {
    const overlay = new St.Widget({
      layout_manager: new Clutter.FixedLayout(),
      width: 24,
      height: 16,
      y_align: Clutter.ActorAlign.CENTER,
    });

    this.#icon = new St.Icon({
      gicon: this.#gicon('pencast-symbolic'),
      icon_size: 16,
      opacity: 89,
    });
    this.#icon.set_position(0, 0);

    this.#badge = new St.Widget({
      style: 'border-radius: 3px; width: 6px; height: 6px;',
      visible: false,
    });
    this.#badge.set_position(10, 0);

    overlay.add_child(this.#icon);
    overlay.add_child(this.#badge);

    const container = new St.BoxLayout({ vertical: false, y_align: Clutter.ActorAlign.CENTER });
    container.add_child(overlay);

    this.#indicator = new PanelMenu.Button(0, 'PencastOverlay', true);
    this.#indicator.add_child(container);
    this.#indicator.setMenu(new PopupMenu.PopupMenu(this.#indicator, 0, St.Side.TOP));

    this.#indicator.menu.connect('open-state-changed', (menu, open) => {
      if (open) this.#rebuildMenu();
    });
    this.#rebuildMenu();   // pre-populate so menu is never empty on first open

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

  #setup() {
    this.#active = true;
    this.#setState('disconnected');

    this.#overlayActor = new OverlayActor();
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
    this.#client.onModeChanged = (mode) => {
      this.#overlayActor.visible = mode.base === 'screen' && !mode.whiteboard;
      if (mode.base !== 'screen') this.#overlayActor.clearAll();
    };
    this.#client.onCaptureInfo = (w, h) => this.#repositionOverlay(w, h);
    this.#client.onMovePreviewBegin = (ids) => this.#overlayActor.movePreviewBegin(ids);
    this.#client.onMovePreview = (strokes) => this.#overlayActor.updateMovePreview(strokes);
    this.#client.onMovePreviewCancel = () => this.#overlayActor.cancelMovePreview();

    this.#client.connect();
  }

  #teardown() {
    this.#stopTracking();
    this.#client?.disconnect();
    this.#client = null;
    this.#overlayActor?.destroy();
    this.#overlayActor = null;
    this.#active = false;
    this.#captureInfo = null;
    this.#fullMonitor = false;
    this.#setState('off');
  }

  #stopTracking() {
    for (const { win, id } of this.#trackedSignals) win.disconnect(id);
    this.#trackedSignals = [];
  }

  #repositionOverlay(captureWidth, captureHeight) {
    this.#captureInfo = { captureWidth, captureHeight };
    this.#fullMonitor = false;
    this.#stopTracking();
    const monitor = Main.layoutManager.primaryMonitor;
    const scale = global.display.get_monitor_scale(global.display.get_primary_monitor());
    const logicalW = Math.round(captureWidth / scale);
    const logicalH = Math.round(captureHeight / scale);

    // If capture dimensions match the monitor, it's a full-monitor share.
    if (Math.abs(logicalW - monitor.width) <= 2 && Math.abs(logicalH - monitor.height) <= 2) {
      this.#fullMonitor = true;
      this.#overlayActor.setGeometry(monitor.x, monitor.y, monitor.width, monitor.height);
      return;
    }

    const mruList = global.display.get_tab_list(Meta.TabList.NORMAL, null);
    let best = null, bestScore = -1;
    for (let i = 0; i < mruList.length; i++) {
      const win = mruList[i];
      if (win.is_skip_taskbar()) continue;
      const rect = win.get_frame_rect();
      const dimMatch = Math.abs(rect.width - logicalW) <= 16 && Math.abs(rect.height - logicalH) <= 16;
      const mruMatch = i <= 2;
      const score = (dimMatch ? 2 : 0) + (mruMatch ? 1 : 0);
      if (score > bestScore) { bestScore = score; best = win; }
      if (score === 3) break;
    }

    // Require at least a dimension match; pure MRU-only is too speculative.
    if (!best || bestScore < 2) {
      this.#fullMonitor = true;
      this.#overlayActor.setGeometry(monitor.x, monitor.y, monitor.width, monitor.height);
      return;
    }
    this.#trackWindow(best);
  }

  #trackWindow(win) {
    this.#stopTracking();
    const update = () => {
      const r = win.get_frame_rect();
      this.#overlayActor.setGeometry(r.x, r.y, r.width, r.height);
    };
    update();
    this.#trackedSignals = [
      { win, id: win.connect('position-changed', update) },
      { win, id: win.connect('size-changed', update) },
    ];
  }

  #rebuildMenu() {
    this.#indicator.menu.removeAll();
    if (!this.#active) {
      const item = new PopupMenu.PopupMenuItem('Activate');
      item.connect('activate', () => { this.#indicator.menu.close(); this.#setup(); });
      this.#indicator.menu.addMenuItem(item);
      return;
    }
    if (this.#captureInfo) {
      const trackedWin = this.#trackedSignals[0]?.win ?? null;
      const monitor = Main.layoutManager.primaryMonitor;

      // "Full monitor" option at the top
      const monLabel = (this.#fullMonitor ? '✓ ' : '    ') + 'Full monitor';
      const monItem = new PopupMenu.PopupMenuItem(monLabel);
      monItem.connect('activate', () => {
        this.#indicator.menu.close();
        this.#stopTracking();
        this.#fullMonitor = true;
        this.#overlayActor.setGeometry(monitor.x, monitor.y, monitor.width, monitor.height);
      });
      this.#indicator.menu.addMenuItem(monItem);
      this.#indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      // Window list
      const mruList = global.display.get_tab_list(Meta.TabList.NORMAL, null);
      for (const win of mruList) {
        if (win.is_skip_taskbar()) continue;
        const title = win.get_title() ?? win.get_wm_class() ?? '?';
        const label = (win === trackedWin ? '✓ ' : '    ') + title;
        const item = new PopupMenu.PopupMenuItem(label);
        item.connect('activate', () => {
          this.#indicator.menu.close();
          this.#fullMonitor = false;
          this.#trackWindow(win);
        });
        this.#indicator.menu.addMenuItem(item);
      }
      this.#indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    }
    const disc = new PopupMenu.PopupMenuItem('Deactivate');
    disc.connect('activate', () => { this.#indicator.menu.close(); this.#teardown(); });
    this.#indicator.menu.addMenuItem(disc);
  }

  #setState(state) {
    if (!this.#icon || !this.#badge) return;
    if (state === 'off') {
      this.#icon.gicon = this.#gicon('pencast-symbolic');
      this.#icon.opacity = 89;
      this.#badge.visible = false;
    } else {
      this.#icon.gicon = this.#gicon('pencast-symbolic');
      this.#icon.opacity = 255;
      this.#badge.visible = true;
      this.#badge.set_position(8, -1);
      this.#badge.style = state === 'connected'
        ? 'border-radius: 5px; width: 8px; height: 8px; background-color: #22c55e;'
        : 'border-radius: 5px; width: 8px; height: 8px; background-color: #f59e0b;';
    }
  }
}
