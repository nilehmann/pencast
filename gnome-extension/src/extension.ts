import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import Meta from "gi://Meta";
import Shell from "gi://Shell";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import Gio from "gi://Gio";
import St from "gi://St";
import Clutter from "gi://Clutter";
import { PencastClient } from "./lib/ws.js";
import { OverlayActor, OverlayActorClass } from "./lib/renderer.js";

import type { ActiveMode } from "../../shared/types.ts";

interface TrackedSignal {
  win: any;
  id: any;
}

interface CaptureInfo {
  captureWidth: number;
  captureHeight: number;
}

export default class PencastOverlay extends Extension {
  #overlayActor: OverlayActorClass | null = null;
  #client: PencastClient | null = null;
  #indicator: PanelMenu.Button | null = null;
  #popupMenu: PopupMenu.PopupMenu | null = null;
  #icon: any = null;
  #badge: St.Widget | null = null;
  #active = false;
  #trackedSignals: TrackedSignal[] = [];
  #captureInfo: CaptureInfo | null = null;
  #fullMonitor = false;
  #showBorder = false;

  enable() {
    const overlay = new St.Widget({
      layout_manager: new Clutter.FixedLayout(),
      width: 24,
      height: 16,
      y_align: Clutter.ActorAlign.CENTER,
    });

    this.#icon = new St.Icon({
      gicon: this.#gicon("pencast-symbolic"),
      icon_size: 16,
      opacity: 89,
    });
    this.#icon.set_position(0, 0);

    this.#badge = new St.Widget({
      style: "border-radius: 3px; width: 6px; height: 6px;",
      visible: false,
    });
    this.#badge.set_position(10, 0);

    overlay.add_child(this.#icon);
    overlay.add_child(this.#badge);

    const container = new St.BoxLayout({
      vertical: false,
      y_align: Clutter.ActorAlign.CENTER,
    });
    container.add_child(overlay);

    this.#indicator = new PanelMenu.Button(0, "PencastOverlay", true);
    this.#indicator.add_child(container);
    this.#popupMenu = new PopupMenu.PopupMenu(this.#indicator, 0, St.Side.TOP);
    this.#indicator.setMenu(this.#popupMenu);

    this.#popupMenu.connect("open-state-changed", (_menu, open) => {
      if (open) this.#rebuildMenu();
      return false;
    });
    this.#rebuildMenu();

    Main.panel.addToStatusArea("pencast-overlay", this.#indicator);
  }

  disable() {
    this.#teardown();
    this.#indicator?.destroy();
    this.#indicator = null;
    this.#popupMenu = null;
    this.#icon = null;
    this.#badge = null;
  }

  #gicon(name: string): any {
    return new Gio.FileIcon({
      file: Gio.File.new_for_path(`${this.path}/icons/${name}.svg`),
    });
  }

  #setup() {
    this.#active = true;
    this.#setState("disconnected");

    const overlayActor = new OverlayActor();
    this.#overlayActor = overlayActor;
    Main.layoutManager.uiGroup.add_child(this.#overlayActor);

    this.#client = new PencastClient("ws://localhost:3001/ws", {
      onConnected: () => this.#setState("connected"),
      onDisconnected: () => this.#setState("disconnected"),
      onStrokesAdded: (strokes) => overlayActor.addStrokes(strokes),
      onStrokesRemoved: (ids) => overlayActor.removeStrokes(ids),
      onStrokesUpdated: (strokes) => overlayActor.updateStrokes(strokes),
      onPendingStroke: (id, data) => overlayActor.setPendingStroke(id, data),
      onPendingStrokeRemoved: (id) => overlayActor.removePendingStroke(id),
      onAllCleared: () => overlayActor.clearAll(),
      onModeChanged: (mode: ActiveMode) => {
        overlayActor.visible = mode.base === "screen" && !mode.whiteboard;
        if (mode.base !== "screen") overlayActor.clearAll();
      },
      onCaptureInfo: (w, h) => this.#repositionOverlay(w, h),
      onMovePreviewBegin: (ids) => overlayActor.movePreviewBegin(ids),
      onMovePreview: (strokes) => overlayActor.updateMovePreview(strokes),
      onMovePreviewCancel: () => overlayActor.cancelMovePreview(),
    });

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
    this.#setState("off");
  }

  #stopTracking() {
    for (const { win, id } of this.#trackedSignals) win.disconnect(id);
    this.#trackedSignals = [];
  }

  #repositionOverlay(captureWidth: number, captureHeight: number) {
    this.#captureInfo = { captureWidth, captureHeight };
    const monitor = Main.layoutManager.primaryMonitor;
    const scale = (global as any).display.get_monitor_scale(
      (global as any).display.get_primary_monitor(),
    );
    const logicalW = Math.round(captureWidth / scale);
    const logicalH = Math.round(captureHeight / scale);

    const monitorWidth = monitor?.width ?? 1920;
    const monitorHeight = monitor?.height ?? 1200;
    if (
      Math.abs(logicalW - monitorWidth) <= 2 &&
      Math.abs(logicalH - monitorHeight) <= 2
    ) {
      this.#stopTracking();
      this.#fullMonitor = true;
      this.#overlayActor?.setGeometry(
        monitor?.x || 0,
        monitor?.y || 0,
        monitorWidth,
        monitorHeight,
      );
      return;
    }

    if (this.#fullMonitor) {
      this.#overlayActor?.setGeometry(
        monitor?.x || 0,
        monitor?.y || 0,
        monitorWidth,
        monitorHeight,
      );
    } else {
      const trackedWin = this.#trackedSignals[0]?.win ?? null;
      if (trackedWin) this.#trackWindow(trackedWin);
    }
  }

  #trackWindow(win: any) {
    this.#stopTracking();
    const update = () => {
      const r = win.get_frame_rect();
      this.#overlayActor?.setGeometry(r.x, r.y, r.width, r.height);
    };
    update();
    this.#trackedSignals = [
      { win, id: win.connect("position-changed", update) },
      { win, id: win.connect("size-changed", update) },
    ];
  }

  #rebuildMenu() {
    this.#popupMenu?.removeAll();
    if (!this.#active) {
      const item = new (PopupMenu as any).PopupMenuItem("Activate");
      item.connect("activate", () => {
        this.#popupMenu?.close();
        this.#setup();
      });
      this.#popupMenu?.addMenuItem(item);
      return;
    }
    if (this.#captureInfo) {
      const trackedWin = this.#trackedSignals[0]?.win ?? null;
      const monitor = (Main as any).layoutManager.primaryMonitor;

      const monLabel = (this.#fullMonitor ? "✓ " : "    ") + "Full monitor";
      const monItem = new (PopupMenu as any).PopupMenuItem(monLabel);
      monItem.connect("activate", () => {
        this.#popupMenu?.close();
        this.#stopTracking();
        this.#fullMonitor = true;
        this.#overlayActor?.setGeometry(
          monitor.x,
          monitor.y,
          monitor.width,
          monitor.height,
        );
      });
      this.#popupMenu?.addMenuItem(monItem);
      this.#popupMenu?.addMenuItem(
        new (PopupMenu as any).PopupSeparatorMenuItem(),
      );

      const tracker = (Shell as any).WindowTracker.get_default();
      const mruList = (global as any).display.get_tab_list(
        (Meta as any).TabList.NORMAL,
        null,
      );
      for (const win of mruList) {
        if (win.is_skip_taskbar()) continue;
        const title = win.get_title() ?? win.get_wm_class() ?? "?";
        const app = tracker.get_window_app(win);
        const icon = app?.get_icon() ?? null;
        const item = icon
          ? new (PopupMenu as any).PopupImageMenuItem(title, icon)
          : new (PopupMenu as any).PopupMenuItem(title);
        item.setOrnament(
          win === trackedWin
            ? (PopupMenu as any).Ornament.CHECK
            : (PopupMenu as any).Ornament.NONE,
        );
        item.connect("activate", () => {
          this.#popupMenu?.close();
          this.#fullMonitor = false;
          this.#trackWindow(win);
        });
        this.#popupMenu?.addMenuItem(item);
      }
      this.#popupMenu?.addMenuItem(
        new (PopupMenu as any).PopupSeparatorMenuItem(),
      );

      const borderLabel = (this.#showBorder ? "✓ " : "    ") + "Show border";
      const borderItem = new (PopupMenu as any).PopupMenuItem(borderLabel);
      borderItem.connect("activate", () => {
        this.#showBorder = !this.#showBorder;
        this.#overlayActor?.setBorder(this.#showBorder);
        this.#popupMenu?.close();
      });
      this.#popupMenu?.addMenuItem(borderItem);
      this.#popupMenu?.addMenuItem(
        new (PopupMenu as any).PopupSeparatorMenuItem(),
      );
    }
    const disc = new (PopupMenu as any).PopupMenuItem("Deactivate");
    disc.connect("activate", () => {
      this.#popupMenu?.close();
      this.#teardown();
    });
    this.#popupMenu?.addMenuItem(disc);
  }

  #setState(state: "off" | "disconnected" | "connected") {
    if (!this.#icon || !this.#badge) return;
    if (state === "off") {
      this.#icon.gicon = this.#gicon("pencast-symbolic");
      this.#icon.opacity = 89;
      this.#badge.visible = false;
    } else {
      this.#icon.gicon = this.#gicon("pencast-symbolic");
      this.#icon.opacity = 255;
      this.#badge.visible = true;
      this.#badge.set_position(8, -1);
      this.#badge.style =
        state === "connected"
          ? "border-radius: 5px; width: 8px; height: 8px; background-color: #22c55e;"
          : "border-radius: 5px; width: 8px; height: 8px; background-color: #f59e0b;";
    }
  }
}
