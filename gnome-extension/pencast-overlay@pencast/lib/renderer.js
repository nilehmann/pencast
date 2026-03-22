import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { drawStrokeCairo } from './draw-cairo.js';

export const OverlayActor = GObject.registerClass(
  class OverlayActor extends St.DrawingArea {
    _init(cropTop) {
      const monitor = Main.layoutManager.primaryMonitor;
      super._init({
        x: monitor.x,
        y: monitor.y,
        width: monitor.width,
        height: monitor.height,
        reactive: false,
        visible: false,
      });
      this._strokes = new Map();
      this._pendingStrokes = new Map();
      this._movePreviewHiddenIds = new Set();
      this._movePreviewStrokes = new Map();
      this._cropTop = cropTop;
      this._repaintPending = false;
      this.connect('repaint', (actor) => {
        const cr = actor.get_context();
        this._paint(cr);
        cr.$dispose();
      });
    }

    addStrokes(strokes) {
      for (const s of strokes) this._strokes.set(s.id, s);
      this._scheduleRepaint();
    }

    removeStrokes(ids) {
      for (const id of ids) this._strokes.delete(id);
      this._scheduleRepaint();
    }

    updateStrokes(strokes) {
      for (const s of strokes) this._strokes.set(s.id, s);
      this._movePreviewHiddenIds = new Set();
      this._movePreviewStrokes = new Map();
      this._scheduleRepaint();
    }

    movePreviewBegin(ids) {
      this._movePreviewHiddenIds = new Set(ids);
      this._movePreviewStrokes = new Map();
      this._scheduleRepaint();
    }

    updateMovePreview(strokes) {
      for (const s of strokes) this._movePreviewStrokes.set(s.id, s);
      this._scheduleRepaint();
    }

    cancelMovePreview() {
      this._movePreviewHiddenIds = new Set();
      this._movePreviewStrokes = new Map();
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
        existing.points = [...existing.points, ...data.points];
      } else if (existing) {
        Object.assign(existing, data);
      } else {
        this._pendingStrokes.set(strokeId, {
          id: strokeId,
          tool: data.tool,
          color: data.color,
          thickness: data.thickness,
          points: data.points ?? [],
        });
      }
      this._scheduleRepaint();
    }

    removePendingStroke(strokeId) {
      this._pendingStrokes.delete(strokeId);
      this._scheduleRepaint();
    }

    setCropTop(n) {
      this._cropTop = n;
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
      cr.setOperator(0 /* CLEAR */);
      cr.paint();
      cr.restore();

      for (const stroke of this._strokes.values()) {
        if (!this._movePreviewHiddenIds.has(stroke.id)) {
          drawStrokeCairo(cr, stroke, w, h, this._cropTop);
        }
      }
      for (const stroke of this._movePreviewStrokes.values()) {
        drawStrokeCairo(cr, stroke, w, h, this._cropTop);
      }
      for (const stroke of this._pendingStrokes.values()) {
        drawStrokeCairo(cr, stroke, w, h, this._cropTop);
      }
    }
  }
);
