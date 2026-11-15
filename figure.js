'use strict';
/* =========================================================
 *  種目の図（筋肉付きの人体モデル）と筋肉マップの描画
 *  座標系: SVG（右が前方、下が床方向）。床は y=150。
 *  角度: 0=真下, 90=前, 180=真上, 270=後ろ
 *
 *  ・各種目は開始(a)と折り返し(b)の2ポーズで定義し、間は関節角度で補間する
 *    （床についた足やバーを握った手など、動かない末端はIKで固定）
 *  ・コマ送り: ①開始 → ②動作 → ③折り返し → ④戻し の4コマ
 *  ・筋肉の色: 収縮して力を出す=赤 / 伸びながら耐える=オレンジ / 補助=薄い色
 * ========================================================= */

const FigureKit = (() => {
  const L = { T: 48, N: 7, HR: 8.5, UA: 27, FA: 25, TH: 37, SH: 36, FOOT: 11, SW: 17, HW: 9 };
  const CX = 100;

  const rad = (d) => (d * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;
  const dir = (a) => [Math.sin(rad(a)), Math.cos(rad(a))];
  const angleOf = (v) => deg(Math.atan2(v[0], v[1]));
  const add = (p, v, s = 1) => [p[0] + v[0] * s, p[1] + v[1] * s];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const len = (v) => Math.hypot(v[0], v[1]);
  const unit = (v) => { const l = len(v) || 1; return [v[0] / l, v[1] / l]; };
  const neg = (v) => [-v[0], -v[1]];
  const lerp = (a, b, u) => a + (b - a) * u;
  const lerpP = (a, b, u) => [lerp(a[0], b[0], u), lerp(a[1], b[1], u)];
  const lerpAng = (a, b, u) => a + ((((b - a) % 360) + 540) % 360 - 180) * u;
  const dist = (a, b) => len(sub(a, b));
  const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1];

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
    const J = { front: true, tl };
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

  /**
   * 2関節の補間。末端がほぼ動かない（床の足・握ったバー）ならIKで固定、
   * それ以外は関節角度を補間して自然な円弧を描かせる。
   */
  function limb(R, Ra, Ma, Ea, Rb, Mb, Eb, la, lb, u) {
    const a1 = lerpAng(angleOf(sub(Ma, Ra)), angleOf(sub(Mb, Rb)), u);
    const a2 = lerpAng(angleOf(sub(Ea, Ma)), angleOf(sub(Eb, Mb)), u);
    const M = add(R, dir(a1), la);
    if (dist(Ea, Eb) < 6) {
      const target = lerpP(Ea, Eb, u);
      const m1 = ikMid(R, target, la, lb, 1), m2 = ikMid(R, target, la, lb, -1);
      const m = dist(m1, M) <= dist(m2, M) ? m1 : m2;
      return [m, add(m, unit(sub(target, m)), lb)];
    }
    return [M, add(M, dir(a2), lb)];
  }

  function interp(Ja, Jb, u) {
    if (u <= 0) return Ja;
    if (u >= 1) return Jb;
    const J = {};
    if (!Ja.front) {
      J.t = lerpAng(Ja.t, Jb.t, u);
      J.hip = lerpP(Ja.hip, Jb.hip, u);
      J.sh = add(J.hip, dir(J.t), L.T);
      J.head = add(J.sh, dir(J.t), L.N + L.HR);
      [J.el, J.ha] = limb(J.sh, Ja.sh, Ja.el, Ja.ha, Jb.sh, Jb.el, Jb.ha, L.UA, L.FA, u);
      [J.el2, J.ha2] = limb(J.sh, Ja.sh, Ja.el2, Ja.ha2, Jb.sh, Jb.el2, Jb.ha2, L.UA, L.FA, u);
      [J.kn, J.an] = limb(J.hip, Ja.hip, Ja.kn, Ja.an, Jb.hip, Jb.kn, Jb.an, L.TH, L.SH, u);
      [J.kn2, J.an2] = limb(J.hip, Ja.hip, Ja.kn2, Ja.an2, Jb.hip, Jb.kn2, Jb.an2, L.TH, L.SH, u);
      J.ft = lerpAng(Ja.ft, Jb.ft, u);
      J.ft2 = lerpAng(Ja.ft2, Jb.ft2, u);
      return J;
    }
    J.front = true;
    J.tl = lerp(Ja.tl, Jb.tl, u);
    for (const k of ['hipR', 'hipL', 'neck', 'shR', 'shL', 'head']) J[k] = lerpP(Ja[k], Jb[k], u);
    [J.elR, J.haR] = limb(J.shR, Ja.shR, Ja.elR, Ja.haR, Jb.shR, Jb.elR, Jb.haR, L.UA, L.FA, u);
    [J.elL, J.haL] = limb(J.shL, Ja.shL, Ja.elL, Ja.haL, Jb.shL, Jb.elL, Jb.haL, L.UA, L.FA, u);
    J.legs = Ja.legs;
    if (J.legs) {
      [J.knR, J.anR] = limb(J.hipR, Ja.hipR, Ja.knR, Ja.anR, Jb.hipR, Jb.knR, Jb.anR, L.TH, L.SH, u);
      [J.knL, J.anL] = limb(J.hipL, Ja.hipL, Ja.knL, Ja.anL, Jb.hipL, Jb.knL, Jb.anL, L.TH, L.SH, u);
    }
    return J;
  }

  /* ---------- 局面（コマ）と筋肉の状態 ---------- */
  const PHASES = ['a', 'ab', 'b', 'ba'];
  const PHASE_U = { a: 0, ab: 0.5, b: 1, ba: 0.5 };

  /** その局面で、メイン部位が「収縮して力を出している」か */
  function isContracting(ex, phase) {
    if (ex.static || ex.alt) return true;
    const peak = ex.peak ?? 'b';
    return peak === 'b' ? phase === 'ab' || phase === 'b' : phase === 'ba' || phase === 'a';
  }
  /** 筋肉ID → CSSクラス（on=収縮, st=伸びながら耐える, sub/subst=補助） */
  function stateFn(ex, phase) {
    const all = ex.muscle === 'fullbody';
    const c = isContracting(ex, phase);
    const subs = ex.sub || [];
    return (m) => {
      if (all || m === ex.muscle) return c ? 'on' : 'st';
      if (subs.includes(m)) return c ? 'sub' : 'subst';
      return '';
    };
  }
  /** 各コマの見出しと説明 */
  function phaseInfo(ex) {
    const P = MUSCLE_BY_ID[ex.muscle]?.name ?? 'メインの筋肉';
    const subs = (ex.sub || []).map((m) => MUSCLE_BY_ID[m]?.name).filter(Boolean);
    const help = subs.length ? `（${subs.join('・')}も補助）` : '';
    const [v1, v2] = ex.verbs || ['動かす', '戻す'];
    if (ex.static) return [{ key: 'b', u: 1, title: 'キープ', desc: `${P}が力を出し続ける${help}` }];
    if (ex.alt) {
      return [
        { key: 'a', u: 0, title: '開始', desc: `${P}に力を入れて構える` },
        { key: 'ab', u: 0.5, title: v1, desc: `${P}が縮んで体をひねる${help}` },
        { key: 'b', u: 1, title: '反対側', desc: `ひねりきって一瞬止める` },
        { key: 'ba', u: 0.5, title: v2, desc: `反対側の${P}が縮んで戻す` },
      ];
    }
    if ((ex.peak ?? 'b') === 'b') {
      return [
        { key: 'a', u: 0, title: '開始', desc: `${P}が伸びた状態から始める` },
        { key: 'ab', u: 0.5, title: v1, desc: `${P}が縮みながら力を出す${help}` },
        { key: 'b', u: 1, title: '折り返し', desc: `${P}が最も縮む。一瞬止めて効かせる` },
        { key: 'ba', u: 0.5, title: v2, desc: `ゆっくり戻す。${P}が伸びながら耐える` },
      ];
    }
    return [
      { key: 'a', u: 0, title: '開始', desc: `${P}に力を入れて構える` },
      { key: 'ab', u: 0.5, title: v1, desc: `ゆっくり。${P}が伸びながら重さに耐える` },
      { key: 'b', u: 1, title: '折り返し', desc: `${P}が最も伸びる（ストレッチ）` },
      { key: 'ba', u: 0.5, title: v2, desc: `${P}が縮みながら力を出す${help}` },
    ];
  }

  /* ---------- SVG 部品 ---------- */
  const f1 = (n) => Math.round(n * 10) / 10;
  const P = (p) => `${f1(p[0])},${f1(p[1])}`;
  const line = (a, b, w, cls) => `<line x1="${f1(a[0])}" y1="${f1(a[1])}" x2="${f1(b[0])}" y2="${f1(b[1])}" stroke-width="${w}" class="${cls}"/>`;
  const circle = (c, r, cls) => `<circle cx="${f1(c[0])}" cy="${f1(c[1])}" r="${r}" class="${cls}"/>`;
  const rect = (x, y, w, h, rx, cls) => `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h)}" rx="${rx}" class="${cls}"/>`;

  /** 先細りのカプセル（腕・脚） */
  function capsule(A, B, rA, rB, cls) {
    const u = unit(sub(B, A)), n = [-u[1], u[0]];
    return `<path d="M${P(add(A, n, rA))}L${P(add(B, n, rB))}A${rB} ${rB} 0 0 0 ${P(add(B, n, -rB))}L${P(add(A, n, -rA))}A${rA} ${rA} 0 0 0 ${P(add(A, n, rA))}Z" class="${cls}"/>`;
  }
  /** 線分A→Bの s(0..1) の位置から、法線 n 方向に off ずらした楕円（筋腹） */
  function belly(A, B, s, off, n, length, thick, cls) {
    const v = sub(B, A), c = add(add(A, v, s), n, off);
    const ang = deg(Math.atan2(v[1], v[0]));
    return `<ellipse cx="${f1(c[0])}" cy="${f1(c[1])}" rx="${f1(length / 2)}" ry="${f1(thick / 2)}" transform="rotate(${f1(ang)} ${f1(c[0])} ${f1(c[1])})" class="${cls}"/>`;
  }
  /** なめらかな閉曲線（Catmull-Rom → ベジェ） */
  function smoothClosed(pts, cls) {
    const n = pts.length;
    let d = `M${P(pts[0])}`;
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += `C${P(c1)} ${P(c2)} ${P(p2)}`;
    }
    return `<path d="${d}Z" class="${cls}"/>`;
  }
  const mu = (st, m) => `mu ${st(m)}`;

  /** 上腕・前腕の「前側（力こぶ側）」の向き */
  function anteriorArm(u, f) {
    let n = [u[1], -u[0]];
    if (cross(u, f) > 0.15) n = neg(n);
    return n;
  }
  /** 太ももの前側（大腿四頭筋側） */
  function anteriorLeg(u, f) {
    let n = [u[1], -u[0]];
    if (cross(u, f) < -0.15) n = neg(n);
    return n;
  }

  /* ---------- 横から見た人体 ---------- */
  function sideArm(sh, el, ha, st, extra = '') {
    const u = unit(sub(el, sh)), f = unit(sub(ha, el));
    const na = anteriorArm(u, f);
    let s = capsule(sh, el, 5.2, 4, 'sk') + capsule(el, ha, 4, 2.8, 'sk');
    s += belly(sh, el, 0.5, -2.2, na, 18, 5.2, mu(st, 'triceps'));
    s += belly(sh, el, 0.55, 2.2, na, 15, 5, mu(st, 'biceps'));
    s += belly(sh, el, 0.8, 1.6, na, 8, 3.6, mu(st, 'brachialis'));
    s += belly(el, ha, 0.33, 0, na, 13, 5.2, mu(st, 'forearm'));
    s += circle(ha, 3.2, 'sk');
    // 三角筋（肩の丸み）: 前部・後部・中部
    s += belly(sh, el, 0.12, 2.6, na, 12, 6.5, mu(st, 'delt_front'));
    s += belly(sh, el, 0.12, -2.6, na, 12, 6.5, mu(st, 'delt_rear'));
    s += belly(sh, el, 0.14, 0, na, 13, 6, mu(st, 'delt_side'));
    return s + extra;
  }
  function sideLeg(hip, kn, an, ft, st) {
    const u = unit(sub(kn, hip)), f = unit(sub(an, kn));
    const na = anteriorLeg(u, f);
    const foot = dir(ft);
    let nShin = [f[1], -f[0]];
    if (dot(nShin, foot) < 0) nShin = neg(nShin);
    let s = capsule(hip, kn, 8.2, 5.4, 'sk') + capsule(kn, an, 5.2, 3, 'sk') + capsule(an, add(an, foot, L.FOOT), 2.8, 2, 'sk');
    s += belly(hip, kn, 0.55, -2.8, na, 26, 6.6, mu(st, 'hamstrings'));
    if (st('adductors')) s += belly(hip, kn, 0.3, 0, na, 17, 5, mu(st, 'adductors'));
    s += belly(hip, kn, 0.5, 2.6, na, 28, 8, mu(st, 'quads'));
    s += belly(kn, an, 0.3, -2.2, nShin, 17, 6.2, mu(st, 'calves'));
    return s;
  }
  function sideTorso(J, st) {
    const d = dir(J.t), nf = [-d[1], d[0]];
    const H = J.hip;
    const at = (s, off) => add(add(H, d, L.T * s), nf, off);
    // 体の輪郭（前側 → 後ろ側）
    const front = [[-0.1, 5], [0.05, 6.5], [0.3, 7], [0.5, 6.5], [0.68, 8.5], [0.84, 8.5], [0.98, 6], [1.08, 3.5]];
    const back = [[1.08, -4], [0.97, -7], [0.8, -7.5], [0.55, -6.5], [0.3, -6.5], [0.12, -8.5], [-0.02, -9.5], [-0.12, -6]];
    let s = smoothClosed([...front, ...back].map(([a, o]) => at(a, o)), 'sk');
    s += torsoMuscles(J, st);
    // 首と頭（鼻で顔の向きを示す）
    s += capsule(J.sh, add(J.sh, d, L.N + 1), 3.4, 3.2, 'sk');
    s += circle(add(J.head, nf, 7.6), 1.9, 'sk');
    s += circle(J.head, L.HR, 'sk');
    return s;
  }
  /** 胴体の筋肉。activeOnly=true なら働いている筋肉だけ（腕の上に透かして重ねる用） */
  function torsoMuscles(J, st, activeOnly = false) {
    const d = dir(J.t), nf = [-d[1], d[0]];
    const H = J.hip, S = add(H, d, L.T);
    let s = '';
    const m = (key, sPos, off, length, thick) => {
      if (activeOnly && !st(key)) return;
      s += belly(H, S, sPos, off, nf, length, thick, mu(st, key) + (activeOnly ? ' xray' : ''));
    };
    m('glutes', 0.0, -5.5, 13, 9);
    m('erectors', 0.3, -5, 22, 3.2);
    m('lats', 0.6, -3.6, 22, 6.2);
    m('midback', 0.78, -5, 10, 3.6);
    m('traps', 0.97, -3.4, 15, 4.6);
    m('obliques', 0.38, 1, 16, 5);
    m('abs', 0.36, 4.6, 23, 4);
    m('chest_lower', 0.66, 6, 8, 5.5);
    m('chest_mid', 0.75, 6.8, 9.5, 6.5);
    m('chest_upper', 0.85, 6.2, 8, 5.5);
    return s;
  }

  /* ---------- 正面（または背面）から見た人体 ---------- */
  function frontBody(fig, J, st) {
    const back = fig.facing === 'back';
    const tl = J.tl, sy = J.shR[1], hy = J.hipR[1], ny = J.neck[1];
    const k = tl / L.T;
    const y = (r) => ny + (hy - ny) * r;
    let s = '';
    // 脚
    if (J.legs) {
      for (const [h, kn, an, sgn] of [[J.hipR, J.knR, J.anR, 1], [J.hipL, J.knL, J.anL, -1]]) {
        const v = unit(sub(kn, h)), n = [-v[1], v[0]];
        const inward = dot(n, [-sgn, 0]) >= 0 ? n : neg(n);
        s += capsule(h, kn, 8, 5.4, 'sk') + capsule(kn, an, 5, 3, 'sk') + capsule(an, add(an, [6 * sgn, 2]), 2.6, 2, 'sk');
        if (back) {
          s += belly(h, kn, 0.55, 0, n, 27, 9, mu(st, 'hamstrings'));
          s += belly(kn, an, 0.3, 0, n, 18, 7, mu(st, 'calves'));
        } else {
          s += belly(h, kn, 0.32, 2.6, inward, 17, 5, mu(st, 'adductors'));
          s += belly(h, kn, 0.52, -1, inward, 29, 9.5, mu(st, 'quads'));
        }
      }
    }
    // 胴体
    const pts = [
      [CX + 5, ny - 1], [J.shR[0] - 1, sy + 1], [J.shR[0] - 1, y(0.22)], [CX + 11, y(0.62)], [CX + 13.5, hy],
      [CX + 9, hy + 6], [CX, hy + 4], [CX - 9, hy + 6], [CX - 13.5, hy], [CX - 11, y(0.62)], [J.shL[0] + 1, y(0.22)],
      [J.shL[0] + 1, sy + 1], [CX - 5, ny - 1],
    ];
    s += smoothClosed(pts, 'sk');
    const E = (cx, cy, rx, ry, m, rot = 0) => `<ellipse cx="${f1(cx)}" cy="${f1(cy)}" rx="${f1(rx)}" ry="${f1(Math.max(1, ry))}" transform="rotate(${rot} ${f1(cx)} ${f1(cy)})" class="${mu(st, m)}"/>`;
    for (const g of [1, -1]) {
      const X = (dx) => CX + dx * g;
      if (back) {
        s += `<polygon points="${P([X(3), y(0.25)])} ${P([X(14), y(0.24)])} ${P([X(12), y(0.52)])} ${P([X(6), y(0.72)])}" class="${mu(st, 'lats')}"/>`;
        s += E(X(6.5), y(0.28), 3.6, 6 * k, 'midback');
        s += `<rect x="${f1(g > 0 ? CX + 1 : CX - 4.5)}" y="${f1(y(0.4))}" width="3.5" height="${f1(Math.max(2, (hy - y(0.4)) - 2))}" rx="1.5" class="${mu(st, 'erectors')}"/>`;
        s += E(X(6.5), hy + 1, 7, 6, 'glutes');
      } else {
        s += E(X(8), y(0.12), 7.5, 2.6 * k + 0.6, 'chest_upper');
        s += E(X(8.5), y(0.2), 8, 3 * k + 0.6, 'chest_mid');
        s += E(X(8), y(0.29), 7, 2.4 * k + 0.6, 'chest_lower');
        s += E(X(10.5), y(0.64), 2.6, 7 * k + 0.6, 'obliques');
      }
    }
    if (back) {
      s += `<polygon points="${P([CX, ny - 4])} ${P([CX + 12, sy])} ${P([CX + 4, y(0.32)])} ${P([CX, y(0.42)])} ${P([CX - 4, y(0.32)])} ${P([CX - 12, sy])}" class="${mu(st, 'traps')}"/>`;
    } else {
      s += E(CX + 7, ny + 0.5, 5, 1.8, 'traps', 18) + E(CX - 7, ny + 0.5, 5, 1.8, 'traps', -18);
      s += `<rect x="${CX - 5}" y="${f1(y(0.4))}" width="10" height="${f1(Math.max(2, hy - y(0.4) - 2))}" rx="3" class="${mu(st, 'abs')}"/>`;
    }
    // 首・頭
    s += capsule([CX, ny + 2], [CX, ny - L.N], 3.6, 3.4, 'sk');
    s += circle(J.head, L.HR, 'sk');
    // 腕
    for (const [sh, el, ha] of [[J.shR, J.elR, J.haR], [J.shL, J.elL, J.haL]]) {
      const v = unit(sub(el, sh)), n = [-v[1], v[0]];
      s += capsule(sh, el, 5.2, 4, 'sk') + capsule(el, ha, 4, 2.8, 'sk') + circle(ha, 3.2, 'sk');
      s += belly(sh, el, 0.55, 0, n, 16, 6, mu(st, back ? 'triceps' : 'biceps'));
      if (!back) s += belly(sh, el, 0.82, 1.5 * Math.sign(n[0] || 1), n, 7, 3, mu(st, 'brachialis'));
      s += belly(el, ha, 0.33, 0, n, 13, 5.4, mu(st, 'forearm'));
      // 肩: 正面なら前部+中部、背面なら後部+中部
      s += belly(sh, el, 0.08, 0, n, 12, 11, mu(st, back ? 'delt_rear' : 'delt_front'));
      s += belly(sh, el, 0.1, 0, n, 9, 6, mu(st, 'delt_side'));
    }
    return s;
  }

  /* ---------- 器具 ---------- */
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
    const pts = b.p.map(P).join(' ');
    const legs = (b.legs || [b.p[0], b.p[b.p.length - 1]]).map((p) => line(p, [p[0], floorY], 3, 'eq-l')).join('');
    return legs + `<polyline points="${pts}" stroke-width="7" class="eq-l"/>`;
  }
  const plate = (c, r) => circle(c, r, 'gear') + circle(c, Math.max(1.5, r / 4), 'gear-hole');
  const dumbbell = (c, vertical) => (vertical ? rect(c[0] - 3, c[1] - 8, 6, 16, 2, 'gear') : circle(c, 5.5, 'gear'));

  function drawSide(fig, J, ex, st) {
    const gear = fig.gear;
    const floorY = fig.floorY ?? 150;
    let s = '';
    if (fig.anchor && gear === 'cable') s += line(J.ha, fig.anchor, 1.5, 'cable') + circle(fig.anchor, 4, 'gear');
    s += exShapes(fig) + benchShape(fig, floorY);
    s += `<g class="far">${sideLeg(J.hip, J.kn2, J.an2, J.ft2, st)}${sideArm(J.sh, J.el2, J.ha2, st)}`;
    if (gear === 'dumbbell' && fig.gearFar !== false) s += dumbbell(J.ha2);
    s += '</g>';
    s += sideTorso(J, st);
    s += sideLeg(J.hip, J.kn, J.an, J.ft, st);
    if (gear === 'anklepad') s += circle(J.an, 5, 'gear');
    if (gear === 'footplate') {
      const c = add(J.an, [3, -3]);
      s += line(add(c, [-10, -10]), add(c, [10, 10]), 5, 'gear-l');
    }
    if (gear === 'backbar') {
      const d = dir(J.t);
      s += plate(add(add(J.sh, [d[1], -d[0]], 5), d, -2), 12);
    }
    if (gear === 'hipbar') s += plate(add(J.hip, [0, -11]), 11);
    s += sideArm(J.sh, J.el, J.ha, st);
    s += torsoMuscles(J, st, true);
    if (gear === 'barbell') s += plate(J.ha, 12);
    if (gear === 'ez') s += plate(J.ha, 10);
    if (gear === 'smallbar') s += plate(J.ha, 7);
    if (gear === 'dumbbell') s += dumbbell(J.ha);
    if (gear === 'dumbbellV' || gear === 'center') s += dumbbell(J.ha, true);
    if (gear === 'handle' || gear === 'cable') s += rect(J.ha[0] - 3, J.ha[1] - 4, 6, 8, 2, 'gear');
    if (gear === 'roller') s += plate(J.ha, 6);
    return s;
  }

  function drawFront(fig, J, ex, st) {
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
    s += frontBody(fig, J, st);
    if (gear === 'barbell' || gear === 'ez') {
      const [l, r] = J.haL[0] < J.haR[0] ? [J.haL, J.haR] : [J.haR, J.haL];
      const a = [l[0] - 16, l[1]], b = [r[0] + 16, r[1]];
      s += line(a, b, 3, 'gear-l');
      s += rect(a[0] - 3, a[1] - 13, 6, 26, 1.5, 'gear') + rect(b[0] - 3, b[1] - 13, 6, 26, 1.5, 'gear');
    }
    if (gear === 'pulldown') s += line([J.haL[0] - 10, J.haL[1]], [J.haR[0] + 10, J.haR[1]], 3, 'gear-l');
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
    const gearR = { barbell: 12, ez: 10, backbar: 15, hipbar: 22 }[fig.gear] ?? 8;
    for (const J of Js) {
      for (const [k, v] of Object.entries(J)) {
        if (!Array.isArray(v)) continue;
        addPt(v, k.startsWith('ha') ? gearR : k === 'head' ? L.HR + 3 : k.startsWith('hip') ? 11 : 8);
      }
      if (!J.front) { addPt(add(J.an, dir(J.ft), L.FOOT), 3); addPt(add(J.an2, dir(J.ft2), L.FOOT), 3); }
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
    const pad = 6;
    const w = x1 - x0 + pad * 2, h = y1 - y0 + pad * 2;
    const W = Math.max(w, h * 4 / 3, 130), H = Math.max(h, W * 3 / 4);
    return [x0 - pad - (W - w) / 2, y0 - pad - (H - h) / 2, W, H];
  }

  function prepare(ex) {
    if (ex._fk) return ex._fk;
    const fig = ex.fig;
    const Ja = solve(fig, fig.a), Jb = solve(fig, fig.b);
    const vb = boundsOf(fig, [Ja, Jb, interp(Ja, Jb, 0.25), interp(Ja, Jb, 0.5), interp(Ja, Jb, 0.75)]);
    ex._fk = { fig, Ja, Jb, vb };
    return ex._fk;
  }
  function render(ex, J, phase) {
    const { fig, vb } = prepare(ex);
    const st = stateFn(ex, phase);
    const fy = fig.floorY ?? 150;
    const floor = fig.floor === false ? '' : line([vb[0], fy], [vb[0] + vb[2], fy], 2, 'floor');
    return floor + (fig.view === 'front' ? drawFront(fig, J, ex, st) : drawSide(fig, J, ex, st));
  }
  const svgWrap = (vb, inner, cls = '') =>
    `<svg class="fig ${cls}" viewBox="${vb.map(f1).join(' ')}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${inner}</svg>`;

  /** 手（またはひざ）の通り道を点線で示す */
  function pathHint(ex) {
    const { Ja, Jb } = prepare(ex);
    const pick = (J) => (J.front ? J.haR : J.ha);
    const pts = [];
    for (let i = 0; i <= 16; i++) pts.push(pick(interp(Ja, Jb, i / 16)));
    if (dist(pts[0], pts[pts.length - 1]) < 8) return '';
    return `<polyline points="${pts.map(P).join(' ')}" class="path-hint"/>`;
  }

  /** コマ i の静止画 */
  function frameSVG(ex, i, cls = '') {
    const { Ja, Jb, vb } = prepare(ex);
    const info = phaseInfo(ex)[i];
    return svgWrap(vb, render(ex, interp(Ja, Jb, info.u), info.key), cls);
  }
  /** 一覧用サムネイル（メインの筋肉が最も縮んだコマ） */
  function thumbSVG(ex) {
    const peakIdx = ex.static ? 0 : (ex.peak ?? 'b') === 'a' ? 0 : 2;
    return frameSVG(ex, peakIdx, 'fig-thumb');
  }

  /**
   * アニメーション付きで描画。onPhase(index) で現在のコマ番号を通知。
   * 戻り値: { stop, toggle, goTo(i), isPlaying }
   */
  function animate(stage, ex, onPhase) {
    const { Ja, Jb, vb } = prepare(ex);
    const info = phaseInfo(ex);
    const hint = pathHint(ex);
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const draw = (u, key) => { stage.innerHTML = svgWrap(vb, hint + render(ex, interp(Ja, Jb, u), key), 'fig-anim'); };
    const ease = (x) => x * x * (3 - 2 * x);
    // 開始で静止 → 動作 → 折り返しで静止 → 戻し（各局面の時間 ms）
    const SEG = [900, 1500, 900, 1700];
    const CYCLE = SEG.reduce((a, b) => a + b, 0);
    let raf = null, t0 = performance.now(), playing = false, offset = 0, lastIdx = -1;

    function at(ms) {
      let t = ms % CYCLE;
      for (let i = 0; i < 4; i++) {
        if (t < SEG[i]) {
          const x = t / SEG[i];
          const u = i === 0 ? 0 : i === 1 ? ease(x) : i === 2 ? 1 : 1 - ease(x);
          return { u, i };
        }
        t -= SEG[i];
      }
      return { u: 0, i: 0 };
    }
    function frame(now) {
      if (!stage.isConnected) return;
      const { u, i } = at(now - t0);
      draw(u, PHASES[i]);
      if (i !== lastIdx) { lastIdx = i; onPhase?.(i); }
      raf = requestAnimationFrame(frame);
    }
    function goTo(i) {
      cancelAnimationFrame(raf);
      playing = false;
      const f = info[Math.min(i, info.length - 1)];
      draw(f.u, f.key);
      lastIdx = i;
      offset = SEG.slice(0, i).reduce((a, b) => a + b, 0) + (i === 1 || i === 3 ? SEG[i] / 2 : 0);
      onPhase?.(i);
    }
    function play() {
      if (info.length < 2) return;
      playing = true;
      t0 = performance.now() - offset;
      raf = requestAnimationFrame(frame);
    }
    if (info.length < 2 || reduce) goTo(info.length < 2 ? 0 : 0);
    else play();
    return {
      stop() { cancelAnimationFrame(raf); playing = false; },
      toggle() {
        if (playing) { offset = (performance.now() - t0) % CYCLE; cancelAnimationFrame(raf); playing = false; }
        else play();
        return playing;
      },
      goTo,
      isPlaying: () => playing,
      canPlay: info.length > 1,
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

  return { frameSVG, thumbSVG, animate, phaseInfo, muscleMap };
})();
