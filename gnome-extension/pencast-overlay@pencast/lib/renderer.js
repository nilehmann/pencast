// gnome-extension/src/lib/renderer.ts
import GObject from "gi://GObject";
import GLib from "gi://GLib";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { drawStrokeCairo } from "./draw-cairo.js";
var OverlayActorClass = class extends St.DrawingArea {
  _strokes = /* @__PURE__ */ new Map();
  _pendingStrokes = /* @__PURE__ */ new Map();
  _movePreviewHiddenIds = /* @__PURE__ */ new Set();
  _movePreviewStrokes = /* @__PURE__ */ new Map();
  _repaintPending = false;
  _showBorder = true;
  _whiteBackground = false;
  _init() {
    const monitor = Main.layoutManager.primaryMonitor;
    super._init({
      x: monitor?.x,
      y: monitor?.y,
      width: monitor?.width,
      height: monitor?.height,
      reactive: false,
      visible: false
    });
    this.connect("repaint", (actor) => {
      const cr = actor.get_context();
      this._paint(cr);
      cr.$dispose();
    });
  }
  addStrokes(strokes) {
    for (const s of strokes) {
      this._strokes.set(s.id, s);
      this._pendingStrokes.delete(s.id);
    }
    this._scheduleRepaint();
  }
  removeStrokes(ids) {
    for (const id of ids) this._strokes.delete(id);
    this._scheduleRepaint();
  }
  updateStrokes(strokes) {
    for (const s of strokes) this._strokes.set(s.id, s);
    this._movePreviewHiddenIds = /* @__PURE__ */ new Set();
    this._movePreviewStrokes = /* @__PURE__ */ new Map();
    this._scheduleRepaint();
  }
  movePreviewBegin(ids) {
    this._movePreviewHiddenIds = new Set(ids);
    this._movePreviewStrokes = /* @__PURE__ */ new Map();
    this._scheduleRepaint();
  }
  updateMovePreview(strokes) {
    for (const s of strokes) {
      this._movePreviewStrokes.set(s.id, s);
      this._movePreviewHiddenIds.add(s.id);
    }
    this._scheduleRepaint();
  }
  cancelMovePreview() {
    this._movePreviewHiddenIds = /* @__PURE__ */ new Set();
    this._movePreviewStrokes = /* @__PURE__ */ new Map();
    this._scheduleRepaint();
  }
  clearAll() {
    this._strokes.clear();
    this._pendingStrokes.clear();
    this._scheduleRepaint();
  }
  setPendingStroke(strokeId, data) {
    const existing = this._pendingStrokes.get(strokeId);
    if (data.append && existing) {
      existing.points = [...existing.points, ...data.points ?? []];
    } else if (existing) {
      Object.assign(existing, data);
    } else {
      this._pendingStrokes.set(strokeId, {
        id: strokeId,
        tool: data.tool,
        color: data.color,
        thickness: data.thickness,
        points: data.points ?? []
      });
    }
    this._scheduleRepaint();
  }
  removePendingStroke(strokeId) {
    this._pendingStrokes.delete(strokeId);
    this._scheduleRepaint();
  }
  setBorder(enabled) {
    this._showBorder = enabled;
    this._scheduleRepaint();
  }
  setWhiteBackground(enabled) {
    this._whiteBackground = enabled;
    this._scheduleRepaint();
  }
  setGeometry(x, y, w, h) {
    this.set_position(x, y);
    this.set_size(w, h);
    this._scheduleRepaint();
  }
  _scheduleRepaint() {
    if (this._repaintPending) return;
    this._repaintPending = true;
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      this._repaintPending = false;
      this.queue_repaint();
      return GLib.SOURCE_REMOVE;
    });
  }
  _paint(cr) {
    const w = this.get_width();
    const h = this.get_height();
    cr.save();
    cr.setOperator(
      0
      /* CLEAR */
    );
    cr.paint();
    cr.restore();
    if (this._whiteBackground) {
      cr.setSourceRGBA(1, 1, 1, 1);
      cr.rectangle(0, 0, w, h);
      cr.fill();
    }
    for (const stroke of this._strokes.values()) {
      if (!this._movePreviewHiddenIds.has(stroke.id)) {
        drawStrokeCairo(cr, stroke, w, h);
      }
    }
    for (const stroke of this._movePreviewStrokes.values()) {
      drawStrokeCairo(cr, stroke, w, h);
    }
    for (const stroke of this._pendingStrokes.values()) {
      drawStrokeCairo(cr, stroke, w, h);
    }
    if (this._showBorder) {
      cr.setSourceRGBA(1, 0.5, 0, 0.85);
      cr.setLineWidth(3);
      cr.rectangle(1.5, 1.5, w - 3, h - 3);
      cr.stroke();
    }
  }
};
var OverlayActor = GObject.registerClass(OverlayActorClass);
export {
  OverlayActor,
  OverlayActorClass
};
