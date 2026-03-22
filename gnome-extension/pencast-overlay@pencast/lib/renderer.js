import GObject from 'gi://GObject';
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
      this._cropTop = cropTop;
      this.connect('repaint', (_actor, cr) => this._paint(cr));
    }

    addStrokes(strokes) {
      for (const s of strokes) this._strokes.set(s.id, s);
      this.queue_repaint();
    }

    removeStrokes(ids) {
      for (const id of ids) this._strokes.delete(id);
      this.queue_repaint();
    }

    updateStrokes(strokes) {
      for (const s of strokes) this._strokes.set(s.id, s);
      this.queue_repaint();
    }

    clearAll() {
      this._strokes.clear();
      this._pendingStrokes.clear();
      this.queue_repaint();
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
      this.queue_repaint();
    }

    removePendingStroke(strokeId) {
      this._pendingStrokes.delete(strokeId);
      this.queue_repaint();
    }

    setCropTop(n) {
      this._cropTop = n;
      this.queue_repaint();
    }

    _paint(cr) {
      const w = this.get_width();
      const h = this.get_height();

      cr.save();
      cr.setOperator(0 /* CLEAR */);
      cr.paint();
      cr.restore();

      for (const stroke of this._strokes.values()) {
        drawStrokeCairo(cr, stroke, w, h, this._cropTop);
      }
      for (const stroke of this._pendingStrokes.values()) {
        drawStrokeCairo(cr, stroke, w, h, this._cropTop);
      }
    }
  }
);
