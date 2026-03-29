// gnome-extension/src/extension.ts
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
import { OverlayActor } from "./lib/renderer.js";
var PencastOverlay = class extends Extension {
  #overlayActor = null;
  #client = null;
  #indicator = null;
  #popupMenu = null;
  #icon = null;
  #badge = null;
  #active = false;
  #trackedSignals = [];
  #captureInfo = null;
  #fullMonitor = false;
  #showBorder = true;
  #whiteBackground = false;
  #coverBelowWindows = true;
  enable() {
    const overlay = new St.Widget({
      layout_manager: new Clutter.FixedLayout(),
      width: 24,
      height: 16,
      y_align: Clutter.ActorAlign.CENTER
    });
    this.#icon = new St.Icon({
      gicon: this.#gicon("pencast-symbolic"),
      icon_size: 16,
      opacity: 89
    });
    this.#icon.set_position(0, 0);
    this.#badge = new St.Widget({
      style: "border-radius: 3px; width: 6px; height: 6px;",
      visible: false
    });
    this.#badge.set_position(10, 0);
    overlay.add_child(this.#icon);
    overlay.add_child(this.#badge);
    const container = new St.BoxLayout({
      vertical: false,
      y_align: Clutter.ActorAlign.CENTER
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
  #gicon(name) {
    return new Gio.FileIcon({
      file: Gio.File.new_for_path(`${this.path}/icons/${name}.svg`)
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
      onModeChanged: (mode) => {
        overlayActor.visible = mode.base === "screen" && !mode.whiteboard;
        if (mode.base !== "screen") overlayActor.clearAll();
        const wb = mode.whiteBackground ?? false;
        this.#whiteBackground = wb;
        overlayActor.setWhiteBackground(wb);
      },
      onCaptureInfo: (w, h) => this.#repositionOverlay(w, h),
      onMovePreviewBegin: (ids) => overlayActor.movePreviewBegin(ids),
      onMovePreview: (strokes) => overlayActor.updateMovePreview(strokes),
      onMovePreviewCancel: () => overlayActor.cancelMovePreview()
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
    this.#showBorder = true;
    this.#whiteBackground = false;
    this.#coverBelowWindows = true;
    this.#setState("off");
  }
  #stopTracking() {
    for (const { win, id } of this.#trackedSignals) win.disconnect(id);
    this.#trackedSignals = [];
    if (this.#overlayActor) {
      const parent = this.#overlayActor.get_parent();
      if (parent === global.window_group) {
        parent.remove_child(this.#overlayActor);
        Main.layoutManager.uiGroup.add_child(this.#overlayActor);
      }
    }
  }
  #updateOverlayParent() {
    if (!this.#overlayActor) return;
    const actor = this.#overlayActor;
    const useWindowGroup = this.#coverBelowWindows && !this.#fullMonitor;
    const currentParent = actor.get_parent();
    const targetParent = useWindowGroup ? global.window_group : Main.layoutManager.uiGroup;
    if (currentParent === targetParent) return;
    currentParent?.remove_child(actor);
    targetParent.add_child(actor);
  }
  #raiseAboveTracked() {
    if (!this.#overlayActor || this.#fullMonitor || !this.#coverBelowWindows) return;
    const trackedWin = this.#trackedSignals[0]?.win ?? null;
    if (!trackedWin) return;
    const actors = global.get_window_actors();
    const winActor = actors.find((a) => a.meta_window === trackedWin);
    if (winActor) {
      global.window_group.set_child_above_sibling(this.#overlayActor, winActor);
    }
  }
  #repositionOverlay(captureWidth, captureHeight) {
    this.#captureInfo = { captureWidth, captureHeight };
    const monitor = Main.layoutManager.primaryMonitor;
    const scale = global.display.get_monitor_scale(
      global.display.get_primary_monitor()
    );
    const logicalW = Math.round(captureWidth / scale);
    const logicalH = Math.round(captureHeight / scale);
    const monitorWidth = monitor?.width ?? 1920;
    const monitorHeight = monitor?.height ?? 1200;
    if (Math.abs(logicalW - monitorWidth) <= 2 && Math.abs(logicalH - monitorHeight) <= 2) {
      this.#stopTracking();
      this.#fullMonitor = true;
      this.#overlayActor?.setGeometry(
        monitor?.x || 0,
        monitor?.y || 0,
        monitorWidth,
        monitorHeight
      );
      return;
    }
    if (this.#fullMonitor) {
      this.#overlayActor?.setGeometry(
        monitor?.x || 0,
        monitor?.y || 0,
        monitorWidth,
        monitorHeight
      );
    } else {
      const trackedWin = this.#trackedSignals[0]?.win ?? null;
      if (trackedWin) this.#trackWindow(trackedWin);
    }
  }
  #trackWindow(win) {
    this.#stopTracking();
    const update = () => {
      const r = win.get_frame_rect();
      this.#overlayActor?.setGeometry(r.x, r.y, r.width, r.height);
    };
    update();
    const focusId = global.display.connect("notify::focus-window", () => {
      if (global.display.focus_window === win) {
        this.#raiseAboveTracked();
      }
    });
    this.#trackedSignals = [
      { win, id: win.connect("position-changed", update) },
      { win, id: win.connect("size-changed", update) },
      { win: global.display, id: focusId }
    ];
    this.#updateOverlayParent();
    this.#raiseAboveTracked();
  }
  #rebuildMenu() {
    this.#popupMenu?.removeAll();
    if (!this.#active) {
      const item = new PopupMenu.PopupMenuItem("Activate");
      item.connect("activate", () => {
        this.#popupMenu?.close();
        this.#setup();
      });
      this.#popupMenu?.addMenuItem(item);
      return;
    }
    if (this.#captureInfo) {
      const trackedWin = this.#trackedSignals[0]?.win ?? null;
      const monitor = Main.layoutManager.primaryMonitor;
      const monLabel = (this.#fullMonitor ? "\u2713 " : "    ") + "Full monitor";
      const monItem = new PopupMenu.PopupMenuItem(monLabel);
      monItem.connect("activate", () => {
        this.#popupMenu?.close();
        this.#stopTracking();
        this.#fullMonitor = true;
        this.#overlayActor?.setGeometry(
          monitor?.x || 0,
          monitor?.y || 0,
          monitor?.width || 0,
          monitor?.height || 0
        );
      });
      this.#popupMenu?.addMenuItem(monItem);
      this.#popupMenu?.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
      const tracker = Shell.WindowTracker.get_default();
      const mruList = global.display.get_tab_list(
        Meta.TabList.NORMAL,
        null
      );
      for (const win of mruList) {
        if (win.is_skip_taskbar()) continue;
        const title = win.get_title() ?? win.get_wm_class() ?? "?";
        const app = tracker.get_window_app(win);
        const icon = app?.get_icon() ?? null;
        const item = icon ? new PopupMenu.PopupImageMenuItem(title, icon) : new PopupMenu.PopupMenuItem(title);
        item.setOrnament(
          win === trackedWin ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE
        );
        item.connect("activate", () => {
          this.#popupMenu?.close();
          this.#fullMonitor = false;
          this.#trackWindow(win);
        });
        this.#popupMenu?.addMenuItem(item);
      }
      this.#popupMenu?.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
      const borderLabel = (this.#showBorder ? "\u2713 " : "    ") + "Show border";
      const borderItem = new PopupMenu.PopupMenuItem(borderLabel);
      borderItem.connect("activate", () => {
        this.#showBorder = !this.#showBorder;
        this.#overlayActor?.setBorder(this.#showBorder);
        this.#popupMenu?.close();
      });
      this.#popupMenu?.addMenuItem(borderItem);
      const wbLabel = (this.#whiteBackground ? "\u2713 " : "    ") + "White background";
      const wbItem = new PopupMenu.PopupMenuItem(wbLabel);
      wbItem.connect("activate", () => {
        this.#client?.send({
          type: "set_white_background",
          enabled: !this.#whiteBackground
        });
        this.#popupMenu?.close();
      });
      this.#popupMenu?.addMenuItem(wbItem);
      if (!this.#fullMonitor) {
        const cbwLabel = (this.#coverBelowWindows ? "\u2713 " : "    ") + "Cover below windows";
        const cbwItem = new PopupMenu.PopupMenuItem(cbwLabel);
        cbwItem.connect("activate", () => {
          this.#coverBelowWindows = !this.#coverBelowWindows;
          this.#updateOverlayParent();
          if (this.#coverBelowWindows) this.#raiseAboveTracked();
          this.#popupMenu?.close();
        });
        this.#popupMenu?.addMenuItem(cbwItem);
      }
      this.#popupMenu?.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    }
    const disc = new PopupMenu.PopupMenuItem("Deactivate");
    disc.connect("activate", () => {
      this.#popupMenu?.close();
      this.#teardown();
    });
    this.#popupMenu?.addMenuItem(disc);
  }
  #setState(state) {
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
      this.#badge.style = state === "connected" ? "border-radius: 5px; width: 8px; height: 8px; background-color: #22c55e;" : "border-radius: 5px; width: 8px; height: 8px; background-color: #f59e0b;";
    }
  }
};
export {
  PencastOverlay as default
};
