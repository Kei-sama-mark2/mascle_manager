'use strict';
/* =========================================================
 *  種目の図（棒人間アニメーション）と筋肉マップの描画
 *  座標系: SVG（右が前方、下が床方向）。床は y=150。
 *  角度: 0=真下, 90=前, 180=真上, 270=後ろ
 * ========================================================= */

const FigureKit = (() => {
  const L = { T: 48, N: 7, HR: 8.5, UA: 27, FA: 25, TH: 37, SH: 36, FOOT: 11, SW: 17, HW: 9 };
  const CX = 100;

  const rad = (d) => (d * Math.PI) / 180;
  const dir = (deg) => [Math.sin(rad(deg)), Math.cos(rad(deg))];
  const add = (p, v, s = 1) => [p[0] + v[0] * s, p[1] + v[1] * s];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const len = (v) => Math.hypot(v[0], v[1]);
  const unit = (v) => { const l = len(v) || 1; return [v[0] / l, v[1] / l]; };
  const lerp = (a, b, u) => a + (b - a) * u;
  const lerpP = (a, b, u) => [lerp(a[0], b[0], u), lerp(a[1], b[1], u)];
  const dist = (a, b) => len(sub(a, b));

  /** 2関節IK: 根元S、目標P、長さa,b。s=+1で画面上時計回り側に関節を出す */
  function ikMid(S, P, a, b, s) {
    const d0 = sub(P, S);
    let d = len(d0);
    d = Math.min(Math.max(d, Math.abs(a - b) + 0.01), a + b - 0.01);
    const base = Math.atan2(d0[1], d0[0]);
    const alpha = Math.acos(Math.min(1, Math.max(-1, (a * a + d * d - b * b) / (2 * a * d))));
    const ang = base + s * alpha;
    return [S[0] + a * Math.cos(ang), S[1] + a * Math.sin(ang)];
  }
  function chain(S, spec, a, b, defSign) {
    if (spec.ua != null) {
      const m = add(S, dir(spec.ua), a);
      return [m, add(m, dir(spec.fa), b)];
    }
    const m = ikMid(S, spec.h, a, b, spec.s ?? defSign);
    return [m, add(m, unit(sub(spec.h, m)), b)];
  }
  /** 補間用: 目標とひじ/ひざの推定位置から、近い方のIK解を選ぶ */
  function chainNear(S, target, guess, a, b) {
    const m1 = ikMid(S, target, a, b, 1);
    const m2 = ikMid(S, target, a, b, -1);
    const m = dist(m1, guess) <= dist(m2, guess) ? m1 : m2;
    return [m, add(m, unit(sub(target, m)), b)];
  }

  /* ---------- ポーズ → 関節座標 ---------- */
  function solveSide(p) {
    const J = { t: p.t, hip: p.hip };
    J.sh = add(p.hip, dir(p.t), L.T);
    J.head = add(J.sh, dir(p.t), L.N + L.HR);
    const arm = p.h ? { h: p.h, s: p.hs ?? 1 } : p.ua != null ? { ua: p.ua, fa: p.fa } : { h: add(J.sh, [0, 1], 50), s: 1 };
    [J.el, J.ha] = chain(J.sh, arm, L.UA, L.FA, 1);
    const arm2 = p.h2 ? { h: p.h2, s: p.hs2 ?? 1 } : p.ua2 != null ? { ua: p.ua2, fa: p.fa2 } : arm;
    [J.el2, J.ha2] = chain(J.sh, arm2, L.UA, L.FA, 1);
    const leg = p.k ? { h: p.k, s: p.ks ?? -1 } : p.th != null ? { ua: p.th, fa: p.sh } : { h: add(p.hip, [0, 1], 73), s: -1 };
    [J.kn, J.an] = chain(p.hip, leg, L.TH, L.SH, -1);
    const leg2 = p.k2 ? { h: p.k2, s: p.ks2 ?? -1 } : p.th2 != null ? { ua: p.th2, fa: p.sh2 } : leg;
    [J.kn2, J.an2] = chain(p.hip, leg2, L.TH, L.SH, -1);
    J.ft = p.ft ?? 90;
    J.ft2 = p.ft2 ?? J.ft;
    return J;
  }

  function mirrorSpec(r) {
    if (r.ua != null) return { ua: -r.ua, fa: -r.fa };
    return { h: [2 * CX - r.h[0], r.h[1]], s: -(r.s ?? -1) };
  }
  function solveFront(p) {
    const sw = p.sw ?? L.SW;
    const tl = p.tl ?? L.T;
    const shrug = p.shrug || 0;
    const J = { front: true };
    J.hipR = [CX + L.HW, p.hy];
    J.hipL = [CX - L.HW, p.hy];
    J.neck = [CX, p.hy - tl];
    J.shR = [CX + sw, p.hy - tl - shrug];
    J.shL = [CX - sw, p.hy - tl - shrug];
    J.head = p.head ?? [CX, p.hy - tl - L.N - L.HR];
    const r = p.r ?? { h: [CX + sw + 2, p.hy - tl + 50], s: -1 };
    [J.elR, J.haR] = chain(J.shR, r, L.UA, L.FA, -1);
    const l = p.l ?? mirrorSpec(r);
    [J.elL, J.haL] = chain(J.shL, l, L.UA, L.FA, 1);
    J.legs = p.legs !== false;
    if (J.legs) {
      const k = p.legs?.k ?? [CX + 12, p.hy + 73];
      const s = p.legs?.s ?? -1;
      [J.knR, J.anR] = chain(J.hipR, { h: k, s }, L.TH, L.SH, -1);
      [J.knL, J.anL] = chain(J.hipL, { h: [2 * CX - k[0], k[1]], s: -s }, L.TH, L.SH, 1);
    }
    return J;
  }
  const solve = (fig, p) => (fig.view === 'front' ? solveFront(p) : solveSide(p));

  /** 開始(Ja)と終了(Jb)の間を補間（手足の長さは保ったまま） */
  function interp(fig, Ja, Jb, u) {
    if (u <= 0) return Ja;
    if (u >= 1) return Jb;
    const J = {};
    if (!Ja.front) {
      J.t = lerp(Ja.t, Jb.t, u);
      J.hip = lerpP(Ja.hip, Jb.hip, u);
      J.sh = add(J.hip, dir(J.t), L.T);
      J.head = add(J.sh, dir(J.t), L.N + L.HR);
      [J.el, J.ha] = chainNear(J.sh, lerpP(Ja.ha, Jb.ha, u), lerpP(Ja.el, Jb.el, u), L.UA, L.FA);
      [J.el2, J.ha2] = chainNear(J.sh, lerpP(Ja.ha2, Jb.ha2, u), lerpP(Ja.el2, Jb.el2, u), L.UA, L.FA);
      [J.kn, J.an] = chainNear(J.hip, lerpP(Ja.an, Jb.an, u), lerpP(Ja.kn, Jb.kn, u), L.TH, L.SH);
      [J.kn2, J.an2] = chainNear(J.hip, lerpP(Ja.an2, Jb.an2, u), lerpP(Ja.kn2, Jb.kn2, u), L.TH, L.SH);
      J.ft = lerp(Ja.ft, Jb.ft, u);
      J.ft2 = lerp(Ja.ft2, Jb.ft2, u);
      return J;
    }
    J.front = true;
    for (const k of ['hipR', 'hipL', 'neck', 'shR', 'shL', 'head']) J[k] = lerpP(Ja[k], Jb[k], u);
    [J.elR, J.haR] = chainNear(J.shR, lerpP(Ja.haR, Jb.haR, u), lerpP(Ja.elR, Jb.elR, u), L.UA, L.FA);
    [J.elL, J.haL] = chainNear(J.shL, lerpP(Ja.haL, Jb.haL, u), lerpP(Ja.elL, Jb.elL, u), L.UA, L.FA);
    J.legs = Ja.legs;
    if (J.legs) {
      [J.knR, J.anR] = chainNear(J.hipR, lerpP(Ja.anR, Jb.anR, u), lerpP(Ja.knR, Jb.knR, u), L.TH, L.SH);
      [J.knL, J.anL] = chainNear(J.hipL, lerpP(Ja.anL, Jb.anL, u), lerpP(Ja.knL, Jb.knL, u), L.TH, L.SH);
    }
    return J;
  }

  /* ---------- 描画 ---------- */
  const f1 = (n) => Math.round(n * 10) / 10;
  const line = (a, b, w, cls) => `<line x1="${f1(a[0])}" y1="${f1(a[1])}" x2="${f1(b[0])}" y2="${f1(b[1])}" stroke-width="${w}" class="${cls}"/>`;
  const circle = (c, r, cls) => `<circle cx="${f1(c[0])}" cy="${f1(c[1])}" r="${r}" class="${cls}"/>`;
  const rect = (x, y, w, h, rx, cls) => `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h)}" rx="${rx}" class="${cls}"/>`;

  const SEG_OF = {
    chest_upper: 'torso', chest_mid: 'torso', chest_lower: 'torso', lats: 'torso', traps: 'torso', midback: 'torso',
    erectors: 'torso', abs: 'torso', obliques: 'torso', delt_front: 'delt', delt_side: 'delt', delt_rear: 'delt',
    biceps: 'ua', triceps: 'ua', brachialis: 'ua', forearm: 'fa', quads: 'th', hamstrings: 'th', adductors: 'th',
    glutes: 'glute', calves: 'shin',
  };
  function segClasses(ex) {
    const cls = {};
    for (const m of ex.sub || []) if (SEG_OF[m]) cls[SEG_OF[m]] = 'hl2';
    if (SEG_OF[ex.muscle]) cls[SEG_OF[ex.muscle]] = 'hl';
    return cls;
  }

  function exShapes(fig) {
    return (fig.ex || []).map((s) => {
      if (s[0] === 'line') return line([s[1], s[2]], [s[3], s[4]], s[5] || 3, 'eq-l');
      if (s[0] === 'rect') return rect(s[1], s[2], s[3], s[4], s[5] || 0, 'eq');
      if (s[0] === 'circle') return circle([s[1], s[2]], s[3], 'eq');
      return '';
    }).join('');
  }
  function benchShape(fig, floorY) {
    const b = fig.bench;
    if (!b) return '';
    const pts = b.p.map((p) => p.map(f1).join(',')).join(' ');
    const legs = (b.legs || [b.p[0], b.p[b.p.length - 1]]).map((p) => line(p, [p[0], floorY], 3, 'eq-l')).join('');
    return legs + `<polyline points="${pts}" stroke-width="7" class="eq-l bench"/>`;
  }
  function plate(c, r) { return circle(c, r, 'gear') + circle(c, Math.max(1.5, r / 4), 'gear-hole'); }
  function dumbbell(c, vertical) {
    return vertical ? rect(c[0] - 3, c[1] - 8, 6, 16, 2, 'gear') : circle(c, 5.5, 'gear');
  }

  function drawSide(fig, J, ex) {
    const hl = segClasses(ex);
    const gear = fig.gear;
    const floorY = fig.floorY ?? 150;
    let s = '';
    if (fig.anchor && gear === 'cable') s += line(J.ha, fig.anchor, 1.5, 'cable') + circle(fig.anchor, 4, 'gear');
    s += exShapes(fig) + benchShape(fig, floorY);
    // 奥側の手足
    s += `<g class="far">${line(J.hip, J.kn2, 9, 'b')}${line(J.kn2, J.an2, 7, 'b')}${line(J.an2, add(J.an2, dir(J.ft2), L.FOOT), 4.5, 'b')}`;
    s += `${line(J.sh, J.el2, 7.5, 'b')}${line(J.el2, J.ha2, 6.5, 'b')}</g>`;
    if (gear === 'dumbbell' && fig.gearFar !== false) s += `<g class="far">${dumbbell(J.ha2)}</g>`;
    // 体幹・頭
    s += line(J.hip, J.sh, 13, `b ${hl.torso || ''}`);
    s += line(J.sh, add(J.sh, dir(J.t), L.N), 5, 'b');
    s += circle(J.head, L.HR, 'b-fill');
    if (hl.glute) s += circle(J.hip, 7, hl.glute);
    // 手前の脚
    s += line(J.hip, J.kn, 9, `b ${hl.th || ''}`) + line(J.kn, J.an, 7, `b ${hl.shin || ''}`);
    s += line(J.an, add(J.an, dir(J.ft), L.FOOT), 4.5, 'b');
    if (gear === 'anklepad') s += circle(J.an, 5, 'gear');
    if (gear === 'footplate') {
      const c = add(J.an, [3, -3]);
      s += line(add(c, [-10, -10]), add(c, [10, 10]), 5, 'eq-l gear-l');
    }
    if (gear === 'backbar') {
      const d = dir(J.t);
      s += plate(add(add(J.sh, [d[1], -d[0]], 4), d, -3), 12);
    }
    if (gear === 'hipbar') s += plate(add(J.hip, [0, -10]), 11);
    // 手前の腕
    s += line(J.sh, J.el, 7.5, `b ${hl.ua || ''}`) + line(J.el, J.ha, 6.5, `b ${hl.fa || ''}`);
    if (hl.delt) s += circle(J.sh, 5.5, hl.delt);
    // 手に持つ器具
    if (gear === 'barbell') s += plate(J.ha, 12);
    if (gear === 'ez') s += plate(J.ha, 10);
    if (gear === 'smallbar') s += plate(J.ha, 7);
    if (gear === 'dumbbell') s += dumbbell(J.ha);
    if (gear === 'dumbbellV') s += dumbbell(J.ha, true);
    if (gear === 'center') s += dumbbell(J.ha, true);
    if (gear === 'handle' || gear === 'cable') s += rect(J.ha[0] - 3, J.ha[1] - 4, 6, 8, 2, 'gear');
    if (gear === 'roller') s += plate(J.ha, 6);
    return s;
  }

  function drawFront(fig, J, ex) {
    const hl = segClasses(ex);
    const gear = fig.gear;
    let s = '';
    if (gear === 'cable' && fig.anchor) {
      const aR = fig.anchor, aL = [2 * CX - aR[0], aR[1]];
      s += line(J.haR, aR, 1.5, 'cable') + circle(aR, 4, 'gear');
      if (fig.cableSide !== 'r') s += line(J.haL, aL, 1.5, 'cable') + circle(aL, 4, 'gear');
    }
    if (gear === 'pulldown' && fig.anchor) {
      const m = lerpP(J.haR, J.haL, 0.5);
      s += line(m, fig.anchor, 1.5, 'cable') + circle(fig.anchor, 4, 'gear');
    }
    s += exShapes(fig);
    if (J.legs) {
      for (const [h, k, a, sgn] of [[J.hipR, J.knR, J.anR, 1], [J.hipL, J.knL, J.anL, -1]]) {
        s += line(h, k, 9, `b ${hl.th || ''}`) + line(k, a, 7, `b ${hl.shin || ''}`) + line(a, add(a, [6 * sgn, 2]), 4.5, 'b');
      }
    }
    const torso = [J.shL, J.shR, J.hipR, J.hipL].map((p) => p.map(f1).join(',')).join(' ');
    s += `<polygon points="${torso}" stroke-width="5" class="b-poly ${hl.torso || ''}"/>`;
    if (hl.glute) s += circle([CX + 6, J.hipR[1]], 6, hl.glute) + circle([CX - 6, J.hipL[1]], 6, hl.glute);
    s += line(J.neck, add(J.neck, [0, -L.N]), 5, 'b');
    s += circle(J.head, L.HR, 'b-fill');
    for (const [sh, el, ha] of [[J.shR, J.elR, J.haR], [J.shL, J.elL, J.haL]]) {
      s += line(sh, el, 7.5, `b ${hl.ua || ''}`) + line(el, ha, 6.5, `b ${hl.fa || ''}`);
      if (hl.delt) s += circle(sh, 5.5, hl.delt);
    }
    if (gear === 'barbell' || gear === 'ez') {
      const [l, r] = J.haL[0] < J.haR[0] ? [J.haL, J.haR] : [J.haR, J.haL];
      const ext = 16;
      const a = [l[0] - ext, lerp(l[1], r[1], 0) ], b = [r[0] + ext, r[1]];
      s += line(a, b, 3, 'gear-l');
      s += rect(a[0] - 3, a[1] - 13, 6, 26, 1.5, 'gear') + rect(b[0] - 3, b[1] - 13, 6, 26, 1.5, 'gear');
    }
    if (gear === 'pulldown') {
      const [l, r] = [J.haL, J.haR];
      s += line([l[0] - 10, l[1]], [r[0] + 10, r[1]], 3, 'gear-l');
    }
    if (gear === 'dumbbell') s += dumbbell(J.haR) + dumbbell(J.haL);
    if (gear === 'handle' || gear === 'cable') {
      s += rect(J.haR[0] - 3, J.haR[1] - 4, 6, 8, 2, 'gear');
      if (gear === 'handle' || fig.cableSide !== 'r') s += rect(J.haL[0] - 3, J.haL[1] - 4, 6, 8, 2, 'gear');
    }
    if (gear === 'center') s += dumbbell(lerpP(J.haR, J.haL, 0.5), true);
    return s;
  }

  /* ---------- 表示範囲 ---------- */
  function boundsOf(fig, Js) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const addPt = (p, r = 0) => {
      x0 = Math.min(x0, p[0] - r); y0 = Math.min(y0, p[1] - r);
      x1 = Math.max(x1, p[0] + r); y1 = Math.max(y1, p[1] + r);
    };
    const gearR = { barbell: 12, ez: 10, backbar: 15, hipbar: 21 }[fig.gear] ?? 8;
    for (const J of Js) {
      for (const [k, v] of Object.entries(J)) {
        if (!Array.isArray(v)) continue;
        addPt(v, k.startsWith('ha') ? gearR : k === 'head' ? L.HR + 2 : 6);
      }
      if (J.front && (fig.gear === 'barbell' || fig.gear === 'ez')) {
        addPt([Math.min(J.haL[0], J.haR[0]) - 22, J.haL[1]], 13);
        addPt([Math.max(J.haL[0], J.haR[0]) + 22, J.haR[1]], 13);
      }
    }
    if (fig.anchor) addPt(fig.anchor, 6);
    (fig.bench?.p || []).forEach((p) => addPt(p, 5));
    (fig.ex || []).forEach((s) => {
      if (s[0] === 'line') { addPt([s[1], s[2]], 3); addPt([s[3], s[4]], 3); }
      if (s[0] === 'rect') { addPt([s[1], s[2]]); addPt([s[1] + s[3], s[2] + s[4]]); }
      if (s[0] === 'circle') addPt([s[1], s[2]], s[3]);
    });
    if (fig.floor !== false) addPt([x0, fig.floorY ?? 150], 2);
    const pad = 8;
    let w = x1 - x0 + pad * 2, h = y1 - y0 + pad * 2;
    let x = x0 - pad, y = y0 - pad;
    // 縦横比を 4:3 前後に整える（小さい図が拡大されすぎないよう最小サイズも確保）
    const minW = Math.max(w, h * 1.25, 140), minH = Math.max(h, minW / 1.6, 110);
    x -= (minW - w) / 2; y -= (minH - h) / 2;
    return [x, y, minW, minH];
  }

  function render(ex, J, vb) {
    const fig = ex.fig;
    const body = fig.view === 'front' ? drawFront(fig, J, ex) : drawSide(fig, J, ex);
    const floor = fig.floor === false ? '' : line([vb[0], fig.floorY ?? 150], [vb[0] + vb[2], fig.floorY ?? 150], 2, 'floor');
    return floor + body;
  }

  function svgWrap(vb, inner, cls = '') {
    return `<svg class="fig ${cls}" viewBox="${vb.map(f1).join(' ')}" preserveAspectRatio="xMidYMid meet" role="img" aria-hidden="true">${inner}</svg>`;
  }

  /** 静止画（which: 'a'|'b'） */
  function staticSVG(ex, which = 'b', cls = '') {
    const fig = ex.fig;
    const Ja = solve(fig, fig.a), Jb = solve(fig, fig.b);
    const vb = boundsOf(fig, [Ja, Jb, interp(fig, Ja, Jb, 0.5)]);
    return svgWrap(vb, render(ex, which === 'a' ? Ja : Jb, vb), cls);
  }

  /** 開始→終了の軌跡（手の通り道）を点線で示す */
  function pathHint(fig, Ja, Jb) {
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const J = interp(fig, Ja, Jb, i / 12);
      pts.push(J.front ? J.haR : J.ha);
    }
    if (dist(pts[0], pts[pts.length - 1]) < 6) return '';
    return `<polyline points="${pts.map((p) => p.map(f1).join(',')).join(' ')}" class="path-hint"/>`;
  }

  /** アニメーション付きの図を container に描画。戻り値: { stop, toggle } */
  function animate(container, ex) {
    const fig = ex.fig;
    const Ja = solve(fig, fig.a), Jb = solve(fig, fig.b);
    const vb = boundsOf(fig, [Ja, Jb, interp(fig, Ja, Jb, 0.5)]);
    const hint = pathHint(fig, Ja, Jb);
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const still = dist(Ja.front ? Ja.haR : Ja.ha, Jb.front ? Jb.haR : Jb.ha) < 1 && dist(Ja.front ? Ja.hipR : Ja.hip, Jb.front ? Jb.hipR : Jb.hip) < 1;
    const svgEl = (inner) => svgWrap(vb, hint + inner, 'fig-anim');
    const phaseEl = container.querySelector('.fig-phase');
    const stage = container.querySelector('.fig-stage');
    const ease = (u) => u * u * (3 - 2 * u);
    const CYCLE = 4200; // 開始で静止 → 動作 → 終了で静止 → 戻る
    let raf = null, t0 = performance.now(), paused = reduce || still, pausedAt = 0;

    function frame(now) {
      if (!container.isConnected) return;
      const t = ((now - t0) % CYCLE) / CYCLE;
      let u, label;
      if (t < 0.15) { u = 0; label = 'a'; }
      else if (t < 0.5) { u = ease((t - 0.15) / 0.35); label = 'ab'; }
      else if (t < 0.65) { u = 1; label = 'b'; }
      else { u = 1 - ease((t - 0.65) / 0.35); label = 'ba'; }
      stage.innerHTML = svgEl(render(ex, interp(fig, Ja, Jb, u), vb));
      if (phaseEl) phaseEl.dataset.phase = label;
      raf = requestAnimationFrame(frame);
    }
    function showStatic() { stage.innerHTML = svgEl(render(ex, Jb, vb)); if (phaseEl) phaseEl.dataset.phase = 'b'; }

    if (paused) showStatic();
    else raf = requestAnimationFrame(frame);
    return {
      stop() { cancelAnimationFrame(raf); },
      toggle() {
        if (still) return false;
        if (paused) { t0 = performance.now() - pausedAt; paused = false; raf = requestAnimationFrame(frame); }
        else { pausedAt = (performance.now() - t0) % CYCLE; paused = true; cancelAnimationFrame(raf); }
        return !paused;
      },
      isPlaying: () => !paused,
    };
  }

  /* =========================================================
   *  筋肉マップ（前面・背面）
   * ========================================================= */
  const MAP = [
    // 前面
    ['f', null, 'circle', 50, 14, 10],
    ['f', null, 'rect', 45, 22, 10, 9, 2],
    ['f', null, 'poly', [[30, 36], [70, 36], [66, 100], [61, 110], [39, 110], [34, 100]]],
    ['f', null, 'ellipse', 40, 160, 5.5, 16, true],
    ['f', null, 'ellipse', 39, 181, 6, 3, true],
    ['f', null, 'circle', 17, 108, 4, true],
    ['f', 'delt_side', 'ellipse', 23, 46, 4.5, 8.5, true],
    ['f', 'delt_front', 'ellipse', 29, 42, 7, 7, true],
    ['f', 'chest_upper', 'ellipse', 41, 43, 9.5, 4, true],
    ['f', 'chest_mid', 'ellipse', 40.5, 50.5, 10.5, 4.5, true],
    ['f', 'chest_lower', 'ellipse', 41, 58, 9.5, 4, true],
    ['f', 'biceps', 'ellipse', 24.5, 64, 4.5, 10.5, true],
    ['f', 'brachialis', 'ellipse', 20.5, 71, 2.6, 6.5, true],
    ['f', 'forearm', 'ellipse', 19, 91, 4.5, 13, true],
    ['f', 'obliques', 'ellipse', 37, 82, 4.5, 13, true],
    ['f', 'abs', 'rect', 44, 64, 12, 36, 4],
    ['f', 'quads', 'ellipse', 39.5, 128, 8, 20, true],
    ['f', 'adductors', 'ellipse', 47.2, 122, 3, 13, true],
    // 背面
    ['b', null, 'circle', 50, 14, 10],
    ['b', null, 'rect', 45, 22, 10, 9, 2],
    ['b', null, 'poly', [[30, 36], [70, 36], [66, 100], [61, 112], [39, 112], [34, 100]]],
    ['b', null, 'ellipse', 39, 181, 6, 3, true],
    ['b', null, 'circle', 17, 108, 4, true],
    ['b', 'lats', 'poly', [[37, 52], [45, 60], [46.5, 84], [40, 92], [33, 74], [30, 57]], true],
    ['b', 'traps', 'poly', [[50, 24], [63, 36], [56, 50], [50, 62], [44, 50], [37, 36]]],
    ['b', 'midback', 'ellipse', 42.5, 50, 4.5, 7.5, true],
    ['b', 'erectors', 'rect', 45.2, 64, 4.2, 36, 2, true],
    ['b', 'delt_side', 'ellipse', 23, 46, 4.5, 8.5, true],
    ['b', 'delt_rear', 'ellipse', 29, 43, 7, 7, true],
    ['b', 'triceps', 'ellipse', 24, 64, 4.8, 11.5, true],
    ['b', 'forearm', 'ellipse', 19, 91, 4.5, 13, true],
    ['b', 'glutes', 'ellipse', 41.5, 108, 8.5, 8.5, true],
    ['b', 'hamstrings', 'ellipse', 40.5, 132, 7, 17, true],
    ['b', 'calves', 'ellipse', 40, 162, 6, 12.5, true],
  ];

  function shapeSVG(type, a, mirror, attrs) {
    const mx = (x) => (mirror ? 100 - x : x);
    if (type === 'circle') return `<circle cx="${mx(a[0])}" cy="${a[1]}" r="${a[2]}" ${attrs}/>`;
    if (type === 'ellipse') return `<ellipse cx="${mx(a[0])}" cy="${a[1]}" rx="${a[2]}" ry="${a[3]}" ${attrs}/>`;
    if (type === 'rect') {
      const x = mirror ? 100 - a[0] - a[2] : a[0];
      return `<rect x="${x}" y="${a[1]}" width="${a[2]}" height="${a[3]}" rx="${a[4] || 0}" ${attrs}/>`;
    }
    if (type === 'poly') return `<polygon points="${a[0].map(([x, y]) => `${mx(x)},${y}`).join(' ')}" ${attrs}/>`;
    return '';
  }

  /**
   * opts.primary: [muscleId], opts.secondary: [muscleId]
   * opts.heat: { muscleId: 0..1 }（統計用のヒートマップ）
   */
  function muscleMap({ primary = [], secondary = [], heat = null } = {}) {
    const fill = (m) => {
      if (!m) return 'class="mm-base"';
      if (heat) {
        const v = heat[m] || 0;
        return v > 0 ? `class="mm-hl" style="opacity:${(0.25 + 0.75 * v).toFixed(2)}"` : 'class="mm-off"';
      }
      if (primary.includes(m) || primary.includes('fullbody')) return 'class="mm-hl"';
      if (secondary.includes(m)) return 'class="mm-hl2"';
      return 'class="mm-off"';
    };
    const side = (v) => MAP.filter((s) => s[0] === v).map((s) => {
      const [, m, type, ...rest] = s;
      const mirrorable = typeof rest[rest.length - 1] === 'boolean' ? rest.pop() : false;
      const args = type === 'poly' ? [rest[0]] : rest;
      const t = m ? `<title>${MUSCLE_BY_ID[m]?.name ?? ''}</title>` : '';
      const one = (mir) => shapeSVG(type, args, mir, fill(m)).replace('/>', `>${t}</${type === 'poly' ? 'polygon' : type}>`);
      return one(false) + (mirrorable ? one(true) : '');
    }).join('');
    return `<svg class="muscle-map" viewBox="0 0 214 200" role="img" aria-label="鍛えられる部位">
      <g>${side('f')}</g><g transform="translate(114 0)">${side('b')}</g>
      <text x="50" y="198" class="mm-label">前</text><text x="164" y="198" class="mm-label">後ろ</text></svg>`;
  }

  return { staticSVG, animate, muscleMap };
})();
