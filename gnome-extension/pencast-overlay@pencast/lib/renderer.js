import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { drawStrokeCairo } from './draw-cairo.js';

export class OverlayActor extends St.DrawingArea {
  #strokes = new Map();        // id → AnnotationStroke (finalized)
  #pendingStrokes = new Map(); // strokeId → { tool, color, thickness, points }
  #cropTop = 0;

  constructor(cropTop) {
    const monitor = Main.layoutManager.primaryMonitor;
    super({
      x: monitor.x,
      y: monitor.y,
      width: monitor.width,
      height: monitor.height,
      reactive: false,  // click-through
      visible: false,
    });
    this.#cropTop = cropTop;
    this.connect('repaint', (_actor, cr) => this.#paint(cr));
  }

  addStrokes(strokes) {
    for (const s of strokes) this.#strokes.set(s.id, s);
    this.queue_repaint();
  }

  removeStrokes(ids) {
    for (const id of ids) this.#strokes.delete(id);
    this.queue_repaint();
  }

  updateStrokes(strokes) {
    for (const s of strokes) this.#strokes.set(s.id, s);
    this.queue_repaint();
  }

  clearAll() {
    this.#strokes.clear();
    this.#pendingStrokes.clear();
    this.queue_repaint();
  }

  setPendingStroke(strokeId, data) {
    const existing = this.#pendingStrokes.get(strokeId);
    if (data.append && existing) {
      existing.points = [...existing.points, ...data.points];
    } else if (existing) {
      Object.assign(existing, data);
    } else {
      this.#pendingStrokes.set(strokeId, {
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
    this.#pendingStrokes.delete(strokeId);
    this.queue_repaint();
  }

  setCropTop(n) {
    this.#cropTop = n;
    this.queue_repaint();
  }

  #paint(cr) {
    const w = this.get_width();
    const h = this.get_height();

    // Clear to transparent
    cr.save();
    cr.setOperator(0 /* CLEAR */);
    cr.paint();
    cr.restore();

    for (const stroke of this.#strokes.values()) {
      drawStrokeCairo(cr, stroke, w, h, this.#cropTop);
    }
    for (const stroke of this.#pendingStrokes.values()) {
      drawStrokeCairo(cr, stroke, w, h, this.#cropTop);
    }
  }
}
