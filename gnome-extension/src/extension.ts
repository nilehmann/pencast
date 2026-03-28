import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { PencastClient } from './lib/ws.js';
import { OverlayActor } from './lib/renderer.js';

import type { ActiveMode } from '../../shared/types.ts';

interface TrackedSignal {
  win: any;
  id: any;
}

interface CaptureInfo {
  captureWidth: number;
  captureHeight: number;
}

export default class PencastOverlay extends (Extension as any) {
  #overlayActor: any = null;
  #client: PencastClient | null = null;
  #indicator: any = null;
  #icon: any = null;
  #badge: any = null;
  #active = false;
  #trackedSignals: TrackedSignal[] = [];
  #captureInfo: CaptureInfo | null = null;
  #fullMonitor = false;
  #showBorder = false;

  enable() {
    const overlay = new (St as any).Widget({
      layout_manager: new (Clutter as any).FixedLayout(),
      width: 24,
      height: 16,
      y_align: (Clutter as any).ActorAlign.CENTER,
    });

    this.#icon = new (St as any).Icon({
      gicon: this.#gicon('pencast-symbolic'),
      icon_size: 16,
      opacity: 89,
    });
    this.#icon.set_position(0, 0);

    this.#badge = new (St as any).Widget({
      style: 'border-radius: 3px; width: 6px; height: 6px;',
      visible: false,
    });
    this.#badge.set_position(10, 0);

    overlay.add_child(this.#icon);
    overlay.add_child(this.#badge);

    const container = new (St as any).BoxLayout({ vertical: false, y_align: (Clutter as any).ActorAlign.CENTER });
    container.add_child(overlay);

    this.#indicator = new (PanelMenu as any).Button(0, 'PencastOverlay', true);
    this.#indicator.add_child(container);
    this.#indicator.setMenu(new (PopupMenu as any).PopupMenu(this.#indicator, 0, (St as any).Side.TOP));

    this.#indicator.menu.connect('open-state-changed', (_menu: any, open: boolean) => {
      if (open) this.#rebuildMenu();
    });
    this.#rebuildMenu();

    (Main as any).panel.addToStatusArea('pencast-overlay', this.#indicator);
  }

  disable() {
    this.#teardown();
    this.#indicator?.destroy();
    this.#indicator = null;
    this.#icon = null;
    this.#badge = null;
  }

  #gicon(name: string): any {
    return new (Gio as any).FileIcon({
      file: (Gio as any).File.new_for_path(`${(this as any).path}/icons/${name}.svg`),
    });
  }

  #setup() {
    this.#active = true;
    this.#setState('disconnected');

    this.#overlayActor = new OverlayActor();
    (Main as any).uiGroup.add_child(this.#overlayActor);

    this.#client = new PencastClient('ws://localhost:3001/ws');
    this.#client.onConnected = () => this.#setState('connected');
    this.#client.onDisconnected = () => this.#setState('disconnected');
    this.#client.onStrokesAdded = (strokes) => this.#overlayActor.addStrokes(strokes);
    this.#client.onStrokesRemoved = (ids) => this.#overlayActor.removeStrokes(ids);
    this.#client.onStrokesUpdated = (strokes) => this.#overlayActor.updateStrokes(strokes);
    this.#client.onPendingStroke = (id, data) => this.#overlayActor.setPendingStroke(id, data);
    this.#client.onPendingStrokeRemoved = (id) => this.#overlayActor.removePendingStroke(id);
    this.#client.onAllCleared = () => this.#overlayActor.clearAll();
    this.#client.onModeChanged = (mode: ActiveMode) => {
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
    this.#showBorder = false;
    this.#setState('off');
  }

  #stopTracking() {
    for (const { win, id } of this.#trackedSignals) win.disconnect(id);
    this.#trackedSignals = [];
  }

  #repositionOverlay(captureWidth: number, captureHeight: number) {
    this.#captureInfo = { captureWidth, captureHeight };
    const monitor = (Main as any).layoutManager.primaryMonitor;
    const scale = (global as any).display.get_monitor_scale((global as any).display.get_primary_monitor());
    const logicalW = Math.round(captureWidth / scale);
    const logicalH = Math.round(captureHeight / scale);

    if (Math.abs(logicalW - monitor.width) <= 2 && Math.abs(logicalH - monitor.height) <= 2) {
      this.#stopTracking();
      this.#fullMonitor = true;
      this.#overlayActor.setGeometry(monitor.x, monitor.y, monitor.width, monitor.height);
      return;
    }

    if (this.#fullMonitor) {
      this.#overlayActor.setGeometry(monitor.x, monitor.y, monitor.width, monitor.height);
    } else {
      const trackedWin = this.#trackedSignals[0]?.win ?? null;
      if (trackedWin) this.#trackWindow(trackedWin);
    }
  }

  #trackWindow(win: any) {
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
      const item = new (PopupMenu as any).PopupMenuItem('Activate');
      item.connect('activate', () => { this.#indicator.menu.close(); this.#setup(); });
      this.#indicator.menu.addMenuItem(item);
      return;
    }
    if (this.#captureInfo) {
      const trackedWin = this.#trackedSignals[0]?.win ?? null;
      const monitor = (Main as any).layoutManager.primaryMonitor;

      const monLabel = (this.#fullMonitor ? '✓ ' : '    ') + 'Full monitor';
      const monItem = new (PopupMenu as any).PopupMenuItem(monLabel);
      monItem.connect('activate', () => {
        this.#indicator.menu.close();
        this.#stopTracking();
        this.#fullMonitor = true;
        this.#overlayActor.setGeometry(monitor.x, monitor.y, monitor.width, monitor.height);
      });
      this.#indicator.menu.addMenuItem(monItem);
      this.#indicator.menu.addMenuItem(new (PopupMenu as any).PopupSeparatorMenuItem());

      const tracker = (Shell as any).WindowTracker.get_default();
      const mruList = (global as any).display.get_tab_list((Meta as any).TabList.NORMAL, null);
      for (const win of mruList) {
        if (win.is_skip_taskbar()) continue;
        const title = win.get_title() ?? win.get_wm_class() ?? '?';
        const app = tracker.get_window_app(win);
        const icon = app?.get_icon() ?? null;
        const item = icon
          ? new (PopupMenu as any).PopupImageMenuItem(title, icon)
          : new (PopupMenu as any).PopupMenuItem(title);
        item.setOrnament(win === trackedWin
          ? (PopupMenu as any).Ornament.CHECK
          : (PopupMenu as any).Ornament.NONE);
        item.connect('activate', () => {
          this.#indicator.menu.close();
          this.#fullMonitor = false;
          this.#trackWindow(win);
        });
        this.#indicator.menu.addMenuItem(item);
      }
      this.#indicator.menu.addMenuItem(new (PopupMenu as any).PopupSeparatorMenuItem());

      const borderLabel = (this.#showBorder ? '✓ ' : '    ') + 'Show border';
      const borderItem = new (PopupMenu as any).PopupMenuItem(borderLabel);
      borderItem.connect('activate', () => {
        this.#showBorder = !this.#showBorder;
        this.#overlayActor.setBorder(this.#showBorder);
        this.#indicator.menu.close();
      });
      this.#indicator.menu.addMenuItem(borderItem);
      this.#indicator.menu.addMenuItem(new (PopupMenu as any).PopupSeparatorMenuItem());
    }
    const disc = new (PopupMenu as any).PopupMenuItem('Deactivate');
    disc.connect('activate', () => { this.#indicator.menu.close(); this.#teardown(); });
    this.#indicator.menu.addMenuItem(disc);
  }

  #setState(state: 'off' | 'disconnected' | 'connected') {
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
