// node_modules/perfect-freehand/dist/esm/index.mjs
var { PI: e } = Math;
var t = e + 1e-4;
var n = 0.5;
var r = [1, 1];
function i(e2, t2, n2, r2 = (e3) => e3) {
  return e2 * r2(0.5 - t2 * (0.5 - n2));
}
var { min: a } = Math;
function o(e2, t2, n2) {
  let r2 = a(1, t2 / n2);
  return a(1, e2 + (a(1, 1 - r2) - e2) * (r2 * 0.275));
}
function s(e2) {
  return [-e2[0], -e2[1]];
}
function c(e2, t2) {
  return [e2[0] + t2[0], e2[1] + t2[1]];
}
function l(e2, t2, n2) {
  return e2[0] = t2[0] + n2[0], e2[1] = t2[1] + n2[1], e2;
}
function u(e2, t2) {
  return [e2[0] - t2[0], e2[1] - t2[1]];
}
function d(e2, t2, n2) {
  return e2[0] = t2[0] - n2[0], e2[1] = t2[1] - n2[1], e2;
}
function f(e2, t2) {
  return [e2[0] * t2, e2[1] * t2];
}
function p(e2, t2, n2) {
  return e2[0] = t2[0] * n2, e2[1] = t2[1] * n2, e2;
}
function m(e2, t2) {
  return [e2[0] / t2, e2[1] / t2];
}
function h(e2) {
  return [e2[1], -e2[0]];
}
function g(e2, t2) {
  let n2 = t2[0];
  return e2[0] = t2[1], e2[1] = -n2, e2;
}
function ee(e2, t2) {
  return e2[0] * t2[0] + e2[1] * t2[1];
}
function _(e2, t2) {
  return e2[0] === t2[0] && e2[1] === t2[1];
}
function v(e2) {
  return Math.hypot(e2[0], e2[1]);
}
function y(e2, t2) {
  let n2 = e2[0] - t2[0], r2 = e2[1] - t2[1];
  return n2 * n2 + r2 * r2;
}
function b(e2) {
  return m(e2, v(e2));
}
function x(e2, t2) {
  return Math.hypot(e2[1] - t2[1], e2[0] - t2[0]);
}
function S(e2, t2, n2) {
  let r2 = Math.sin(n2), i2 = Math.cos(n2), a2 = e2[0] - t2[0], o2 = e2[1] - t2[1], s2 = a2 * i2 - o2 * r2, c2 = a2 * r2 + o2 * i2;
  return [s2 + t2[0], c2 + t2[1]];
}
function C(e2, t2, n2, r2) {
  let i2 = Math.sin(r2), a2 = Math.cos(r2), o2 = t2[0] - n2[0], s2 = t2[1] - n2[1], c2 = o2 * a2 - s2 * i2, l2 = o2 * i2 + s2 * a2;
  return e2[0] = c2 + n2[0], e2[1] = l2 + n2[1], e2;
}
function w(e2, t2, n2) {
  return c(e2, f(u(t2, e2), n2));
}
function te(e2, t2, n2, r2) {
  let i2 = n2[0] - t2[0], a2 = n2[1] - t2[1];
  return e2[0] = t2[0] + i2 * r2, e2[1] = t2[1] + a2 * r2, e2;
}
function T(e2, t2, n2) {
  return c(e2, f(t2, n2));
}
var E = [0, 0];
var D = [0, 0];
var O = [0, 0];
function k(e2, n2) {
  let r2 = T(e2, b(h(u(e2, c(e2, [1, 1])))), -n2), i2 = [], a2 = 1 / 13;
  for (let n3 = a2; n3 <= 1; n3 += a2) i2.push(S(r2, e2, t * 2 * n3));
  return i2;
}
function A(e2, n2, r2) {
  let i2 = [], a2 = 1 / r2;
  for (let r3 = a2; r3 <= 1; r3 += a2) i2.push(S(n2, e2, t * r3));
  return i2;
}
function j(e2, t2, n2) {
  let r2 = u(t2, n2), i2 = f(r2, 0.5), a2 = f(r2, 0.51);
  return [u(e2, i2), u(e2, a2), c(e2, a2), c(e2, i2)];
}
function M(e2, n2, r2, i2) {
  let a2 = [], o2 = T(e2, n2, r2), s2 = 1 / i2;
  for (let n3 = s2; n3 < 1; n3 += s2) a2.push(S(o2, e2, t * 3 * n3));
  return a2;
}
function ne(e2, t2, n2) {
  return [c(e2, f(t2, n2)), c(e2, f(t2, n2 * 0.99)), u(e2, f(t2, n2 * 0.99)), u(e2, f(t2, n2))];
}
function N(e2, t2, n2) {
  return e2 === false || e2 === void 0 ? 0 : e2 === true ? Math.max(t2, n2) : e2;
}
function re(e2, t2, n2) {
  return e2.slice(0, 10).reduce((e3, r2) => {
    let i2 = r2.pressure;
    return t2 && (i2 = o(e3, r2.distance, n2)), (e3 + i2) / 2;
  }, e2[0].pressure);
}
function P(e2, n2 = {}) {
  let { size: r2 = 16, smoothing: a2 = 0.5, thinning: f2 = 0.5, simulatePressure: m2 = true, easing: _2 = (e3) => e3, start: v2 = {}, end: b2 = {}, last: x2 = false } = n2, { cap: S2 = true, easing: w2 = (e3) => e3 * (2 - e3) } = v2, { cap: T2 = true, easing: P2 = (e3) => --e3 * e3 * e3 + 1 } = b2;
  if (e2.length === 0 || r2 <= 0) return [];
  let F2 = e2[e2.length - 1].runningLength, I2 = N(v2.taper, r2, F2), L2 = N(b2.taper, r2, F2), R2 = (r2 * a2) ** 2, z = [], B = [], V = re(e2, m2, r2), H = i(r2, f2, e2[e2.length - 1].pressure, _2), U, W = e2[0].vector, G = e2[0].point, K = G, q = G, J = K, Y = false;
  for (let n3 = 0; n3 < e2.length; n3++) {
    let { pressure: a3 } = e2[n3], { point: s2, vector: h2, distance: v3, runningLength: b3 } = e2[n3], x3 = n3 === e2.length - 1;
    if (!x3 && F2 - b3 < 3) continue;
    f2 ? (m2 && (a3 = o(V, v3, r2)), H = i(r2, f2, a3, _2)) : H = r2 / 2, U === void 0 && (U = H);
    let S3 = b3 < I2 ? w2(b3 / I2) : 1, T3 = F2 - b3 < L2 ? P2((F2 - b3) / L2) : 1;
    H = Math.max(0.01, H * Math.min(S3, T3));
    let k2 = (x3 ? e2[n3] : e2[n3 + 1]).vector, A2 = x3 ? 1 : ee(h2, k2), j2 = ee(h2, W) < 0 && !Y, M2 = A2 !== null && A2 < 0;
    if (j2 || M2) {
      g(E, W), p(E, E, H);
      for (let e3 = 0; e3 <= 1; e3 += 0.07692307692307693) d(D, s2, E), C(D, D, s2, t * e3), q = [D[0], D[1]], z.push(q), l(O, s2, E), C(O, O, s2, t * -e3), J = [O[0], O[1]], B.push(J);
      G = q, K = J, M2 && (Y = true);
      continue;
    }
    if (Y = false, x3) {
      g(E, h2), p(E, E, H), z.push(u(s2, E)), B.push(c(s2, E));
      continue;
    }
    te(E, k2, h2, A2), g(E, E), p(E, E, H), d(D, s2, E), q = [D[0], D[1]], (n3 <= 1 || y(G, q) > R2) && (z.push(q), G = q), l(O, s2, E), J = [O[0], O[1]], (n3 <= 1 || y(K, J) > R2) && (B.push(J), K = J), V = a3, W = h2;
  }
  let X = [e2[0].point[0], e2[0].point[1]], Z = e2.length > 1 ? [e2[e2.length - 1].point[0], e2[e2.length - 1].point[1]] : c(e2[0].point, [1, 1]), Q = [], $ = [];
  if (e2.length === 1) {
    if (!(I2 || L2) || x2) return k(X, U || H);
  } else {
    I2 || L2 && e2.length === 1 || (S2 ? Q.push(...A(X, B[0], 13)) : Q.push(...j(X, z[0], B[0])));
    let t2 = h(s(e2[e2.length - 1].vector));
    L2 || I2 && e2.length === 1 ? $.push(Z) : T2 ? $.push(...M(Z, t2, H, 29)) : $.push(...ne(Z, t2, H));
  }
  return z.concat($, B.reverse(), Q);
}
var F = [0, 0];
function I(e2) {
  return e2 != null && e2 >= 0;
}
function L(e2, t2 = {}) {
  let { streamline: i2 = 0.5, size: a2 = 16, last: o2 = false } = t2;
  if (e2.length === 0) return [];
  let s2 = 0.15 + (1 - i2) * 0.85, l2 = Array.isArray(e2[0]) ? e2 : e2.map(({ x: e3, y: t3, pressure: r2 = n }) => [e3, t3, r2]);
  if (l2.length === 2) {
    let e3 = l2[1];
    l2 = l2.slice(0, -1);
    for (let t3 = 1; t3 < 5; t3++) l2.push(w(l2[0], e3, t3 / 4));
  }
  l2.length === 1 && (l2 = [...l2, [...c(l2[0], r), ...l2[0].slice(2)]]);
  let u2 = [{ point: [l2[0][0], l2[0][1]], pressure: I(l2[0][2]) ? l2[0][2] : 0.25, vector: [...r], distance: 0, runningLength: 0 }], f2 = false, p2 = 0, m2 = u2[0], h2 = l2.length - 1;
  for (let e3 = 1; e3 < l2.length; e3++) {
    let t3 = o2 && e3 === h2 ? [l2[e3][0], l2[e3][1]] : w(m2.point, l2[e3], s2);
    if (_(m2.point, t3)) continue;
    let r2 = x(t3, m2.point);
    if (p2 += r2, e3 < h2 && !f2) {
      if (p2 < a2) continue;
      f2 = true;
    }
    d(F, m2.point, t3), m2 = { point: t3, pressure: I(l2[e3][2]) ? l2[e3][2] : n, vector: b(F), distance: r2, runningLength: p2 }, u2.push(m2);
  }
  return u2[0].vector = u2[1]?.vector || [0, 0], u2;
}
function R(e2, t2 = {}) {
  return P(L(e2, t2), t2);
}

// shared/stroke-draw.ts
var COLORS = {
  orange: [0.976, 0.451, 0.086],
  red: [0.937, 0.267, 0.267],
  green: [0.133, 0.773, 0.369],
  yellow: [0.918, 0.702, 0.031],
  black: [0.067, 0.067, 0.067],
  gray: [0.612, 0.639, 0.686],
  blue: [0.231, 0.51, 0.965]
};
function thicknessPx(t2) {
  if (t2 === "thin") return 4;
  if (t2 === "medium") return 7;
  return 12;
}
function getStrokeAlpha(tool) {
  return tool === "highlighter" ? 0.3 : 1;
}
function getStrokeOutlinePoints(stroke, w2, h2) {
  const px = (x2) => x2 * w2;
  const py = (y2) => y2 * h2;
  if (stroke.tool === "highlighter") {
    const pts2 = stroke.points.map((p2) => [px(p2.normX), py(p2.normY), 0.5]);
    return R(pts2, {
      size: thicknessPx("thick") * 2,
      thinning: 0,
      smoothing: 0.5,
      streamline: 0.5,
      simulatePressure: false
    });
  }
  const pts = stroke.points.map((p2) => [px(p2.normX), py(p2.normY), p2.pressure ?? 0.5]);
  return R(pts, {
    size: thicknessPx(stroke.thickness),
    thinning: 0.5,
    smoothing: 0.5,
    streamline: 0.5,
    simulatePressure: false
  });
}

// gnome-extension/src/lib/draw-cairo.ts
function parseColor(color) {
  return COLORS[color] ?? COLORS["blue"];
}
function setColor(cr, color, alpha = 1) {
  const [r2, g2, b2] = parseColor(color);
  cr.setSourceRGBA(r2, g2, b2, alpha);
}
function lastPoint(stroke) {
  return stroke.points[stroke.points.length - 1];
}
function ellipseParams(stroke) {
  const p0 = stroke.points[0];
  const p1 = lastPoint(stroke);
  const cx = (p0.normX + p1.normX) / 2;
  const cy = (p0.normY + p1.normY) / 2;
  const rx = Math.abs(p1.normX - p0.normX) / 2;
  const ry = Math.abs(p1.normY - p0.normY) / 2;
  const angle = stroke.rotation ?? 0;
  return { cx, cy, rx, ry, angle };
}
function renderFreehandOutlineCairo(cr, pts) {
  if (!pts.length) return;
  cr.newPath();
  cr.moveTo(pts[0][0], pts[0][1]);
  for (let i2 = 1; i2 < pts.length - 1; i2++) {
    const mx = (pts[i2][0] + pts[i2 + 1][0]) / 2;
    const my = (pts[i2][1] + pts[i2 + 1][1]) / 2;
    cr.curveTo(pts[i2][0], pts[i2][1], pts[i2][0], pts[i2][1], mx, my);
  }
  cr.closePath();
  cr.fill();
}
function drawStrokeCairo(cr, stroke, w2, h2) {
  if (!stroke.points || stroke.points.length < 2) return;
  const px = (x2) => x2 * w2;
  const py = (y2) => y2 * h2;
  cr.save();
  switch (stroke.tool) {
    case "ink":
    case "pointer": {
      const outline = getStrokeOutlinePoints(stroke, w2, h2);
      setColor(cr, stroke.color, getStrokeAlpha(stroke.tool));
      renderFreehandOutlineCairo(cr, outline);
      break;
    }
    case "highlighter": {
      const outline = getStrokeOutlinePoints(stroke, w2, h2);
      setColor(cr, "yellow", getStrokeAlpha(stroke.tool));
      renderFreehandOutlineCairo(cr, outline);
      break;
    }
    case "line": {
      setColor(cr, stroke.color, 1);
      cr.setLineWidth(thicknessPx(stroke.thickness));
      cr.setLineCap(
        1
        /* Cairo.LineCap.ROUND */
      );
      const la = {
        x: px(stroke.points[0].normX),
        y: py(stroke.points[0].normY)
      };
      const lb = {
        x: px(lastPoint(stroke).normX),
        y: py(lastPoint(stroke).normY)
      };
      cr.newPath();
      cr.moveTo(la.x, la.y);
      cr.lineTo(lb.x, lb.y);
      cr.stroke();
      break;
    }
    case "arrow": {
      setColor(cr, stroke.color, 1);
      cr.setLineWidth(thicknessPx(stroke.thickness));
      cr.setLineJoin(
        0
        /* Cairo.LineJoin.MITER */
      );
      cr.setLineCap(
        1
        /* Cairo.LineCap.ROUND */
      );
      const a2 = {
        x: px(stroke.points[0].normX),
        y: py(stroke.points[0].normY)
      };
      const b2 = {
        x: px(lastPoint(stroke).normX),
        y: py(lastPoint(stroke).normY)
      };
      cr.newPath();
      cr.moveTo(a2.x, a2.y);
      cr.lineTo(b2.x, b2.y);
      cr.stroke();
      const angle = Math.atan2(b2.y - a2.y, b2.x - a2.x);
      const headLen = 16 + thicknessPx(stroke.thickness) * 2;
      cr.newPath();
      cr.moveTo(b2.x, b2.y);
      cr.lineTo(
        b2.x - headLen * Math.cos(angle - Math.PI / 6),
        b2.y - headLen * Math.sin(angle - Math.PI / 6)
      );
      cr.moveTo(b2.x, b2.y);
      cr.lineTo(
        b2.x - headLen * Math.cos(angle + Math.PI / 6),
        b2.y - headLen * Math.sin(angle + Math.PI / 6)
      );
      cr.stroke();
      break;
    }
    case "box": {
      const bp0 = stroke.points[0];
      const bp1 = lastPoint(stroke);
      const bcx = (bp0.normX + bp1.normX) / 2;
      const bcy = (bp0.normY + bp1.normY) / 2;
      const bhw = Math.abs(bp1.normX - bp0.normX) / 2;
      const bhh = Math.abs(bp1.normY - bp0.normY) / 2;
      const bangle = stroke.rotation ?? 0;
      setColor(cr, stroke.color, 1);
      cr.setLineWidth(thicknessPx(stroke.thickness));
      cr.setLineJoin(
        0
        /* Cairo.LineJoin.MITER */
      );
      cr.translate(px(bcx), py(bcy));
      cr.rotate(bangle);
      cr.rectangle(-px(bhw), -py(bhh), px(bhw) * 2, py(bhh) * 2);
      cr.stroke();
      break;
    }
    case "ellipse": {
      const { cx, cy, rx, ry, angle } = ellipseParams(stroke);
      setColor(cr, stroke.color, 1);
      cr.setLineWidth(thicknessPx(stroke.thickness));
      cr.setLineJoin(
        0
        /* Cairo.LineJoin.MITER */
      );
      cr.save();
      cr.translate(px(cx), py(cy));
      cr.rotate(angle);
      const radiusX = Math.max(1, rx * w2);
      const radiusY = Math.max(1, ry * h2);
      cr.scale(1, radiusY / radiusX);
      cr.newPath();
      cr.arc(0, 0, radiusX, 0, 2 * Math.PI);
      cr.restore();
      cr.stroke();
      break;
    }
  }
  cr.restore();
}
export {
  drawStrokeCairo
};
