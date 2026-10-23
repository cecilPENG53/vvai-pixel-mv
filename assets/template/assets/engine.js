// vvai-pixel-mv render engine v2.
// Every frame is a pure function of the render clock g (seconds from the start of assets/bgm.mp3).
// Inputs (plain data files next to this one):
//   window.MV_DATA   beats / spectrum / drops on the render clock        (pixel_mv.py analyze)
//   window.MV_LYRICS aligned lyric cues on the ORIGINAL song clock       (pixel_mv.py align)
//   window.STORY     cast / segments / actors / beats / lines / events    (story.json → pixel_mv.py sync)
//   window.SCENE_LIB scene library metadata                              (scenes.json)
// v2 adds: several characters with paths and story beats, per-line lyric interactions,
// a transition library (pixel / train / whip / zoom / iris / flash / cut) and desktop-window segments.
window.__mvBuild = function () {
  const D = window.MV_DATA, S = window.STORY, LIB = window.SCENE_LIB;
  const OFF = D.offset || 0, DUR = S.dur;
  const $ = (id) => document.getElementById(id);

  /* ---------------- helpers ---------------- */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const prog = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
  const eOutCubic = (k) => 1 - Math.pow(1 - k, 3);
  const eInCubic = (k) => k * k * k;
  const eInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
  const eOutBack = (k) => { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); };
  const eOutBounce = (k) => { const n = 7.5625, d = 2.75; if (k < 1 / d) return n * k * k; if (k < 2 / d) return n * (k -= 1.5 / d) * k + 0.75; if (k < 2.5 / d) return n * (k -= 2.25 / d) * k + 0.9375; return n * (k -= 2.625 / d) * k + 0.984375; };
  const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

  /* ---------------- beat grid ---------------- */
  const BEATS = D.beats;
  const BEAT = BEATS.length > 2 ? (BEATS[BEATS.length - 1] - BEATS[0]) / (BEATS.length - 1) : 0.5;
  function lastBeat(g) { let lo = 0, hi = BEATS.length - 1, i = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (BEATS[m] <= g) { i = m; lo = m + 1; } else hi = m - 1; } return { b: i >= 0 ? BEATS[i] : -9, i, next: i + 1 < BEATS.length ? BEATS[i + 1] : (i >= 0 ? BEATS[i] + BEAT : 0) }; }
  const LEVEL = { dj: 1, standard: 0.55, soft: 0.2 }[S.intensity || "dj"];
  function kick(g, len = 0.3) { const { b, i } = lastBeat(g); const d = g - b; if (i < 0 || d > len) return 0; return Math.pow(1 - d / len, 3) * (i % 4 === 0 ? 1 : 0.55); }
  const isDown = (g) => lastBeat(g).i % 4 === 0;
  function beatPhase(g) { const { b, next } = lastBeat(g); return b < 0 ? 0 : clamp((g - b) / Math.max(0.05, next - b), 0, 1); }
  const jumpH = (g, frac, h) => { const p = beatPhase(g); return p > 1 - frac ? Math.sin(((p - (1 - frac)) / frac) * Math.PI) * h : 0; };
  const landSq = (g, amt = 0.14) => { const { b } = lastBeat(g), d = g - b; return b >= 0 && d < 0.1 ? amt * (1 - d / 0.1) * LEVEL + 0.02 : 0; };
  const beatIdx = (g) => Math.max(0, lastBeat(g).i);

  /* ---------------- story: normalise segments, cast, transitions ---------------- */
  const CAST = Object.assign({ claude: { kind: "claude" } }, S.cast || {});
  const kindOf = (id) => (CAST[id] && CAST[id].kind) || (["claude", "girl", "rival", "friend", "ghost"].includes(id) ? id : "claude");
  const SEGS = S.segments.map((s) => {
    const seg = Object.assign({ beats: [], time: "night", weather: "none", cam: "wide" }, s);
    if (seg.frame !== "desktop" && !seg.actors) seg.actors = [{ id: "claude", act: seg.act || "hop", intro: !!seg.intro }];
    (seg.windows || []).forEach((w) => { w.beats = w.beats || []; w.actors = w.actors || []; w.time = w.time || "night"; w.weather = w.weather || "none"; });
    return seg;
  });
  const segAt = (g) => SEGS.find((s) => g >= s.t0 && g < s.t1) || SEGS[SEGS.length - 1];
  const sceneMeta = (id) => LIB.scenes.find((s) => s.id === id) || LIB.scenes[0];
  const groupColor = { screen: ["#7c8cff", "#9aa6ff"], indoor: ["#e0805e", "#f09a78"], city: ["#ff7ab0", "#ff9cc4"], nature: ["#3fbf8a", "#7be0b4"], fantasy: ["#e8b84a", "#ffd34d"] };
  const TRANS = [];
  for (let k = 1; k < SEGS.length; k++) {
    const a = SEGS[k - 1], c = SEGS[k], changed = a.scene !== c.scene || (a.frame || "") !== (c.frame || "");
    const type = c.trans || (changed ? "pixel" : "cut");
    TRANS.push({ type, at: c.t0, from: a, to: c, cols: groupColor[(sceneMeta(c.scene || "desk") || {}).group] || groupColor.screen });
  }
  const WIPES = TRANS.filter((t) => t.type === "pixel").map((t, n) => ({ cover: t.at - 0.62, reveal: t.at - 0.08, cols: t.cols, line: "#1a1030", fromLeft: n % 2 === 1 }));
  const transIn = (seg) => TRANS.find((t) => t.to === seg);
  const transOut = (seg) => TRANS.find((t) => t.from === seg);

  const EVENTS = (S.events || []).slice().sort((a, b) => a.t - b.t);
  const reacts = EVENTS.filter((e) => e.type === "react");
  const drops = EVENTS.filter((e) => e.type === "drop");
  const allBeats = []; SEGS.forEach((s) => { s.beats.forEach((x) => allBeats.push(x)); (s.windows || []).forEach((w) => w.beats.forEach((x) => allBeats.push(x))); });
  const flashes = [{ t0: 0, dur: 0.35, a: 0.6 }].concat(drops.map((e) => ({ t0: e.t, dur: 0.3, a: 0.7 })), reacts.map((e) => ({ t0: e.t, dur: 0.18, a: 0.5 })));
  TRANS.forEach((t) => { if (t.type === "flash" || t.type === "train") flashes.push({ t0: t.at, dur: 0.3, a: 0.5 }); if (t.type === "zoom") flashes.push({ t0: t.at - 0.06, dur: 0.3, a: 0.95 }); if (t.type === "iris") flashes.push({ t0: t.at, dur: 0.3, a: 0.3 }); });
  allBeats.filter((x) => x.do === "heart-crack").forEach((x) => flashes.push({ t0: x.t, dur: 0.35, a: 0.6 }));
  if (S.outro) flashes.push({ t0: S.outro.t0, dur: 0.35, a: 0.8 });
  const shakes = [{ t0: 0, dur: 0.4, amp: 12 }].concat(drops.map((e) => ({ t0: e.t, dur: 0.4, amp: 20 })), reacts.map((e) => ({ t0: e.t, dur: 0.6, amp: 22, rot: 4 })));
  WIPES.forEach((w) => shakes.push({ t0: w.reveal + 0.08, dur: 0.25, amp: 10 }));
  TRANS.forEach((t) => { if (t.type !== "cut" && t.type !== "pixel") shakes.push({ t0: t.at, dur: 0.3, amp: 14 }); });
  allBeats.forEach((x) => { if (x.do === "heart-crack") shakes.push({ t0: x.t, dur: 0.45, amp: 22, rot: 3 }); if (x.do === "hands-break" || x.do === "glasses-off" || x.do === "memory-pop") shakes.push({ t0: x.t, dur: 0.25, amp: 9 }); });
  const glitches = drops.map((e) => ({ t0: e.t - 0.02, dur: 0.16 })).concat(reacts.map((e) => ({ t0: e.t, dur: 0.14 })));
  TRANS.forEach((t) => { if (t.type === "whip") glitches.push({ t0: t.at - 0.16, dur: 0.14 }); if (t.type === "iris") glitches.push({ t0: t.at - 0.62, dur: 0.12 }); });
  allBeats.forEach((x) => { if (["hands-break", "heart-crack", "glasses-off"].includes(x.do)) glitches.push({ t0: x.t, dur: 0.12 }); });

  /* ================= pixel buffers ================= */
  const W = 320, H = 180;
  const mk = () => { const c = document.createElement("canvas"); c.width = W; c.height = H; return c; };
  const bufBG = mk(), bufFG = mk(), bg = bufBG.getContext("2d"), fg = bufFG.getContext("2d");
  let b = bg;
  let CUR = { weather: "none", sprite: null, light: 1 };
  function R(x, y, w, h, c) { if (w <= 0 || h <= 0) return; b.fillStyle = c; b.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
  function disc(cx, cy, r, c) { for (let y = -r; y <= r; y++) { const w = Math.floor(Math.sqrt(Math.max(0, r * r - y * y))); R(cx - w, cy + y, 2 * w + 1, 1, c); } }
  function glow(cx, cy, r, c, a) { const o = b.globalAlpha; b.globalAlpha = o * a; disc(cx, cy, r, c); disc(cx, cy, Math.round(r * 0.6), c); disc(cx, cy, Math.round(r * 0.3), c); b.globalAlpha = o; }
  function alpha(a, fn) { const o = b.globalAlpha; b.globalAlpha = o * clamp(a, 0, 1); fn(); b.globalAlpha = o; }
  function clip(x, y, w, h, fn) { b.save(); b.beginPath(); b.rect(x, y, w, h); b.clip(); fn(); b.restore(); }
  function clipCircle(cx, cy, r, fn) { b.save(); b.beginPath(); b.arc(cx, cy, r, 0, Math.PI * 2); b.clip(); fn(); b.restore(); }
  function outline(x, y, w, h, c) { R(x, y, w, 1, c); R(x, y + h - 1, w, 1, c); R(x, y, 1, h, c); R(x + w - 1, y, 1, h, c); }
  const SKY = {
    night: ["#0d0b2a", "#141238", "#1c1848", "#252058", "#30276a"],
    dusk: ["#2a1d52", "#4f2a6e", "#8a3a72", "#cf5f62", "#f39a5b"],
    day: ["#4aa3e8", "#62b3ee", "#7cc2f2", "#98d0f5", "#b6def8"],
  };
  function sky(t, y1 = H, cols) { const c = cols || SKY[t] || SKY.night; const h = y1 / c.length; c.forEach((col, i) => R(0, i * h, W, h + 1, col)); }
  function stars(t, n, y1, seed, tm) { if (t === "day") return; for (let i = 0; i < n; i++) { const x = hash(seed * 100 + i) * W, y = hash(seed * 200 + i) * y1, a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(tm * (1.5 + hash(i) * 2) + i)) + kick(tm) * 0.3; alpha(t === "dusk" ? a * 0.5 : a, () => R(x, y, hash(i * 3) > 0.85 ? 2 : 1, 1, "#e8ecff")); } }
  function moon(x, y, r, t) {
    if (t === "day") { glow(x, y, r * 2, "#fff2b0", 0.12); disc(x, y, r, "#ffe58a"); return; }
    if (t === "dusk") { glow(x, y, r * 2.2, "#ffc27a", 0.12); disc(x, y, r, "#ffb36a"); return; }
    glow(x, y, Math.round(r * 2.2), "#fff1c0", 0.08); disc(x, y, r, "#f4e7b8"); disc(x + Math.round(r * 0.35), y - Math.round(r * 0.3), Math.max(1, Math.round(r * 0.25)), "#e2d39f");
  }
  function skyline(base, minH, maxH, col, win, seed, tm, lt) { let x = -4, i = 0; while (x < W) { const w = 10 + Math.floor(hash(seed + i * 7) * 16), h = minH + Math.floor(hash(seed + i * 13) * (maxH - minH)); R(x, base - h, w, h, col); for (let wy = base - h + 3; wy < base - 2; wy += 4) for (let wx = x + 2; wx < x + w - 2; wx += 3) { const k = hash(seed + wx * 3.1 + wy * 7.7); if (k < lt && Math.sin(tm * 0.7 + k * 40) < 0.96) R(wx, wy, 1, 2, win); } x += w + 1; i++; } }
  function mountains(base, amp, col, seed) { for (let x = 0; x < W; x++) { const h = amp * (0.55 + 0.35 * Math.sin(x * 0.03 + seed) + 0.2 * Math.sin(x * 0.11 + seed * 2)); R(x, base - h, 1, H - base + h, col); } }
  function lamp(x, gy, t) { R(x, gy - 40, 1, 40, "#3b3a55"); R(x - 2, gy - 41, 5, 2, "#55537a"); if (t === "day") return; glow(x, gy - 38, 12, "#ffd27a", 0.1); R(x - 1, gy - 39, 3, 1, "#ffe6a8"); alpha(0.07, () => { for (let k = 0; k < 36; k++) R(x - k * 0.4, gy - 38 + k, k * 0.8 + 1, 1, "#ffd27a"); }); }
  function bench(x, gy) { R(x, gy - 6, 28, 2, "#8a5a3c"); R(x, gy - 12, 28, 2, "#8a5a3c"); R(x + 2, gy - 6, 2, 6, "#5a3a28"); R(x + 24, gy - 6, 2, 6, "#5a3a28"); }
  function tree(x, gy, crown, crown2, r) { R(x - 1, gy - 16, 3, 16, "#4a3324"); disc(x, gy - 22, r, crown); disc(x - 7, gy - 17, Math.round(r * 0.7), crown); disc(x + 7, gy - 17, Math.round(r * 0.7), crown); for (let i = 0; i < 14; i++) R(x - r + hash(i + x) * r * 2, gy - 30 + hash(i * 3 + x) * 18, 1, 1, crown2); }
  function pine(x, gy, col, snow) { for (let k = 0; k < 4; k++) { const w = 3 + k * 3; R(x - w, gy - 30 + k * 6, 2 * w + 1, 5, col); if (snow) R(x - w + 1, gy - 30 + k * 6, 2 * w - 1, 1, "#eef4ff"); } R(x - 1, gy - 6, 3, 6, "#3a2a20"); }
  function water(y0, y1, c1, c2, tm) { R(0, y0, W, y1 - y0, c1); for (let y = y0 + 1; y < y1; y += 2) { const off = Math.floor((tm * 8 + y * 3) % 12); for (let x = -off; x < W; x += 12) R(x, y, 5, 1, c2); } }
  const lit = (t) => (t === "night" ? 0.42 : t === "dusk" ? 0.25 : 0.05);
  const specRow = (g) => D.spec[clamp(Math.round(g * D.fps), 0, D.spec.length - 1)];
  const HEX = "0123456789abcdef";

  /* ---------------- scenes (25 from the library + club + calllog) ---------------- */
  const SCENES = {
    desk(t, tm) {
      sky(t); stars(t, 40, 160, 2, tm);
      R(28, 14, 264, 146, "#17161d"); R(28, 14, 264, 8, "#222129");
      R(32, 17, 2, 2, "#ff5f57"); R(36, 17, 2, 2, "#febc2e"); R(40, 17, 2, 2, "#28c840");
      R(190, 22, 1, 138, kick(tm) > 0.3 ? "#d97757" : "#3a3846");
      outline(34, 27, 92, 18, "#d97757");
      for (let i = 0; i < 3; i++) R(38, 31 + i * 4, 40 + hash(i) * 40, 2, "#8a869c");
      for (let i = 0; i < 3; i++) R(36, 50 + i * 6, 50 + hash(i + 4) * 70, 2, "#5d5a72");
      const row = specRow(tm);
      for (let j = 0; j < 30; j++) { const v = HEX.indexOf(row[Math.floor(j * row.length / 30)]); const h = Math.round(4 + v * 2.4); for (let s = 0; s < h; s += 3) R(36 + j * 5, 118 - s - 2, 4, 2, s > 24 ? "#f2a6c6" : s > 14 ? "#a99cf5" : "#5a5cc0"); }
      outline(34, 124, 150, 20, "#e6e2f0");
      for (let i = 0; i < 4; i++) R(196, 30 + i * 6, 40 + hash(i + 9) * 40, 2, i ? "#8a869c" : "#f4a6bf");
      R(110, 165, 100, 11, "rgba(255,255,255,0.14)");
      for (let i = 0; i < 8; i++) R(114 + i * 12, 167, 8, 7, ["#5aa0ff", "#e8e8f0", "#3cc0ff", "#4fd16a", "#ff7ab0", "#ffd34d", "#2a2a30", "#d97757"][i]);
      return { x: 70, y: 124, typeBox: [36, 125, 146, 18] };
    },
    phone(t, tm) {
      sky(t); stars(t, 50, 180, 3, tm);
      R(100, 4, 120, 174, "#0f0e18"); R(104, 14, 112, 152, "#f3f0f8"); R(104, 14, 112, 8, "#e2deee");
      R(110, 30, 56, 10, "#e2def0"); R(150, 46, 60, 10, "#7c8cff"); R(110, 62, 70, 10, "#e2def0");
      R(160, 78, 50, 10, "#7c8cff"); R(196, 90, 14, 3, "#b9b3c9");
      R(110, 98, 26, 10, "#e2def0"); for (let i = 0; i < 3; i++) { const on = Math.floor(tm * 4) % 3 === i; R(115 + i * 6, 102, 3, 3, on ? "#5b5270" : "#b9b3c9"); }
      R(108, 146, 104, 14, "#ffffff"); outline(108, 146, 104, 14, "#c9c3dc");
      return { x: 128, y: 146, typeBox: [110, 147, 100, 12], typeDark: true };
    },
    player(t, tm) {
      sky(t); stars(t, 50, 180, 4, tm);
      R(36, 18, 248, 144, "#1d1a3a"); outline(36, 18, 248, 144, "#2f2958");
      R(50, 30, 64, 64, "#2a2f6e"); disc(82, 58, 14, "#f4e7b8"); disc(88, 54, 12, "#2a2f6e");
      R(126, 34, 80, 6, "#ece8ff"); R(126, 44, 50, 4, "#9b95c2");
      R(126, 62, 120, 4, "#ff9cc0"); R(126, 72, 100, 3, "#6f6a96"); R(126, 80, 110, 3, "#6f6a96");
      const p = clamp(tm / DUR, 0, 1), px = 50 + p * 220;
      R(50, 120, 220, 2, "#3b3766"); R(50, 120, px - 50, 2, "#ff9cc0"); disc(px, 121, 2, "#ffffff");
      return { x: px - 11, y: 120 };
    },
    bedroom(t, tm) {
      R(0, 0, W, H, t === "day" ? "#8d7f9e" : t === "dusk" ? "#4a3550" : "#2a2448"); R(0, 150, W, 30, "#3b2f3d");
      R(170, 26, 110, 82, "#1b1730");
      clip(174, 30, 102, 74, () => { sky(t, H); stars(t, 20, 80, 5, tm); moon(250, 44, 7, t); skyline(104, 10, 30, "#141130", "#ffcf7a", 9, tm, lit(t)); weatherFx(CUR.weather, tm); });
      R(224, 30, 2, 74, "#1b1730"); R(174, 66, 102, 2, "#1b1730"); R(166, 106, 118, 5, "#5a4a6a");
      R(160, 20, 10, 92, "#7a4a6a"); R(280, 20, 10, 92, "#7a4a6a");
      R(10, 122, 112, 28, "#5a6aa8"); R(14, 116, 28, 9, "#dfe3f5"); R(46, 122, 76, 6, "#6a7ac0");
      R(128, 124, 32, 4, "#6a4f3a"); R(134, 128, 3, 22, "#4a3828"); R(152, 128, 3, 22, "#4a3828");
      R(142, 110, 2, 14, "#9a8a6a"); R(136, 106, 14, 5, "#e8d28a"); if (t !== "day") glow(143, 112, 22, "#ffd27a", 0.08);
      return { x: 205, y: 106, indoorClip: true };
    },
    store(t, tm) {
      R(0, 0, W, H, "#dfe9e6"); R(0, 0, W, 6, "#c9d6d3"); R(20, 8, 280, 2, "#ffffff");
      for (let y = 140; y < H; y += 8) for (let x = 0; x < W; x += 8) R(x, y, 8, 8, ((x + y) / 8) % 2 === 0 ? "#c4cfcd" : "#b5c0be");
      R(110, 30, 100, 76, "#11102a");
      clip(110, 30, 100, 76, () => { sky("night", H); skyline(106, 12, 40, "#1d1a3a", "#ffcf7a", 11, tm, 0.4); weatherFx(CUR.weather, tm); });
      outline(110, 30, 100, 76, "#8a9a9a"); R(159, 30, 2, 76, "#8a9a9a");
      for (let s = 0; s < 3; s++) { R(8, 50 + s * 26, 90, 3, "#9aa5a8"); for (let i = 0; i < 12; i++) R(10 + i * 7, 40 + s * 26, 5, 10, ["#ff7a5c", "#ffd34d", "#5ab0ff", "#7be0b4", "#ff8fbf"][Math.floor(hash(i * 5 + s) * 5)]); }
      R(222, 34, 74, 104, "#9ad8f2"); for (let i = 0; i < 3; i++) R(226 + i * 23, 38, 20, 96, "#c8f0ff"); for (let i = 0; i < 12; i++) R(230 + (i % 3) * 23, 44 + Math.floor(i / 3) * 22, 10, 14, ["#ff7a5c", "#5ab0ff", "#ffd34d"][i % 3]);
      R(104, 120, 112, 16, "#c9d3d1"); R(104, 120, 112, 2, "#ffffff");
      return { x: 150, y: 120, indoorClip: true };
    },
    cafe(t, tm) {
      R(0, 0, W, H, "#4a3026"); R(0, 0, W, 8, "#3a241c");
      R(36, 18, 248, 104, "#2b2440");
      clip(40, 22, 240, 96, () => { sky(t === "night" ? "dusk" : t, 140); skyline(118, 10, 40, t === "day" ? "#6a7a9a" : "#2a2440", "#ffcf7a", 13, tm, lit(t)); weatherFx("rain", tm);
        alpha(0.35, () => { for (let i = 0; i < 14; i++) { const x = 44 + hash(i) * 230, len = 10 + hash(i * 2) * 30, y0 = ((tm * 12 * (0.5 + hash(i))) % 120) - 20; for (let k = 0; k < len; k++) R(x + Math.sin(k * 0.4 + i) * 1.2, 22 + y0 + k, 1, 1, "#cfe0ff"); } }); });
      R(158, 18, 4, 104, "#2b1c16"); R(36, 68, 248, 3, "#2b1c16");
      R(0, 130, W, 50, "#7a4e34"); R(0, 130, W, 3, "#a06a48");
      R(150, 118, 13, 12, "#f3efe8"); R(163, 121, 3, 6, "#f3efe8"); R(152, 119, 9, 2, "#6a3a22");
      alpha(0.6, () => { for (let w = 0; w < 3; w++) for (let k = 0; k < 10; k++) R(152 + w * 4 + Math.sin(tm * 3 + k * 0.6 + w) * 2, 114 - k * 2 - ((tm * 8) % 4), 1, 1, "#ffffff"); });
      return { x: 108, y: 130, indoorClip: true };
    },
    subway(t, tm) {
      R(0, 0, W, H, "#cfd8de"); R(0, 0, W, 10, "#e8eef1"); R(0, 38, W, 54, "#10101e");
      const sp = 260 * (BEAT > 0 ? 0.5 / BEAT : 1);
      clip(0, 38, W, 54, () => { for (let i = 0; i < 26; i++) { const x = ((hash(i) * W * 2 - tm * sp) % (W * 2) + W * 2) % (W * 2) - W * 0.4; R(x, 44 + hash(i * 3) * 44, 26 + hash(i * 5) * 30, 2, hash(i * 7) > 0.5 ? "#ffd27a" : "#7fd7ff"); } });
      for (let k = 0; k < 5; k++) R(k * 80 - 4, 38, 10, 54, "#cfd8de");
      R(0, 102, W, 18, "#5a7ac0"); R(0, 120, W, 16, "#4a6ab0"); R(0, 150, W, 30, "#8e979c"); R(0, 136, W, 14, "#a9b2b6");
      R(60, 10, 3, 140, "#e3c75a"); R(258, 10, 3, 140, "#e3c75a"); R(0, 14, W, 2, "#b9c2c8");
      for (let i = 0; i < 8; i++) { const sw = Math.sin(tm * 2 + i) * 1.5; R(20 + i * 40 + sw, 16, 1, 10, "#9aa3a8"); disc(20 + i * 40 + sw, 28, 3, "#e8eef1"); }
      return { x: 150, y: 150 };
    },
    bus(t, tm) {
      R(0, 0, W, H, "#2e3247"); R(0, 0, W, 12, "#3a3f58"); R(0, 34, W, 66, "#0d0c1c");
      clip(0, 34, W, 66, () => { sky("night", 140); skyline(100, 10, 50, "#16142c", "#ffcf7a", 17, tm, 0.35); for (let i = 0; i < 6; i++) { const x = ((i * 70 - tm * 140) % 420 + 420) % 420 - 50; R(x, 40, 2, 60, "#3b3a55"); glow(x, 42, 10, "#ffb35a", 0.18); } weatherFx(CUR.weather, tm); });
      for (let k = 0; k < 4; k++) R(k * 100 - 4, 34, 8, 66, "#2e3247");
      R(0, 108, W, 20, "#7a3a4a"); R(0, 124, W, 14, "#6a2f3e"); R(0, 150, W, 30, "#22253a"); R(0, 138, W, 12, "#2a2d44");
      return { x: 120, y: 124, indoorClip: true };
    },
    rainstreet(t, tm) {
      sky(t); stars(t, 20, 60, 6, tm); skyline(118, 30, 84, t === "day" ? "#5a6a8a" : "#1e1b3c", "#ffcf7a", 3, tm, lit(t));
      R(0, 118, W, 62, t === "day" ? "#4a4a5e" : "#1a1830"); R(0, 118, W, 12, t === "day" ? "#5a5a70" : "#24213e");
      alpha(0.35, () => { for (let i = 0; i < 46; i++) R(hash(i) * W + Math.sin(tm * 2 + i) * 0.6, 132 + hash(i * 2) * 36, 1, 4 + hash(i * 3) * 14, i % 3 ? "#ffcf7a" : "#ff7ab0"); });
      R(170, 152, 70, 5, "#2f2c55"); R(176, 153, 58, 1, "#4a4688");
      lamp(52, 130, t); lamp(262, 130, t);
      return { x: 150, y: 130 };
    },
    rooftop(t, tm) {
      sky(t); stars(t, 70, 100, 7, tm); moon(258, 34, 12, t);
      skyline(142, 18, 92, t === "day" ? "#6a7aa0" : "#1b1838", "#ffd27a", 5, tm, lit(t) + 0.08);
      R(0, 148, W, 32, "#2b2840"); R(0, 130, W, 6, "#55507a"); R(0, 136, W, 12, "#3b3758");
      R(26, 92, 34, 38, "#4a4670"); R(26, 92, 34, 3, "#5f5a8a"); R(30, 130, 3, 6, "#2b2840"); R(53, 130, 3, 6, "#2b2840");
      R(270, 112, 30, 18, "#5a5680"); R(274, 116, 22, 10, "#3b3758");
      return { x: 150, y: 130 };
    },
    crossing(t, tm) {
      sky(t, 70); stars(t, 25, 50, 8, tm); skyline(84, 20, 70, t === "day" ? "#7a86a8" : "#1f1c3e", "#ffcf7a", 21, tm, lit(t));
      R(0, 84, W, 96, t === "day" ? "#5a5a66" : "#2f2e3a"); R(0, 84, W, 4, "#8a8a98");
      for (let i = 0; i < 11; i++) R(14 + i * 28, 112, 16, 52, "#e9e6f2");
      const red = Math.floor(Math.max(0, lastBeat(tm).i) / 4) % 2 === 0;
      R(284, 34, 3, 60, "#3b3a55"); R(278, 34, 15, 26, "#1a1a24");
      disc(285, 41, 4, red ? "#ff4a4a" : "#3a1a1a"); disc(285, 53, 4, red ? "#1a3a24" : "#4cff8a"); glow(285, red ? 41 : 53, 10, red ? "#ff4a4a" : "#4cff8a", 0.12);
      return { x: 120, y: 152 };
    },
    neonalley(t, tm) {
      R(0, 0, W, H, "#0c0a1c"); sky("night", 120); R(0, 0, 90, H, "#1d1830"); R(230, 0, 90, H, "#1d1830");
      R(126, 18, 68, 100, "#2a2160"); skyline(118, 20, 70, "#1a1638", "#ff8fbf", 23, tm, 0.3);
      const f1 = kick(tm) > 0.2 || Math.sin(tm * 17) > -0.8, f2 = Math.sin(tm * 11 + 1) > -0.6;
      outline(14, 30, 52, 16, f1 ? "#ff4fa0" : "#4a1a34"); R(20, 35, 40, 6, f1 ? "#ff8fc6" : "#3a1428"); if (f1) glow(40, 38, 26, "#ff4fa0", 0.08);
      outline(246, 52, 60, 14, f2 ? "#3df0ff" : "#123a40"); R(252, 56, 48, 6, f2 ? "#b8fbff" : "#0e2a30"); if (f2) glow(276, 59, 28, "#3df0ff", 0.08);
      R(92, 0, 2, H, "#2a2440"); R(226, 0, 2, H, "#2a2440");
      alpha(0.25, () => { for (let i = 0; i < 6; i++) disc(100 + ((tm * 6 + i * 9) % 30), 120 - ((tm * 14 + i * 13) % 60), 5 + i % 3, "#c8c4e8"); });
      R(0, 150, W, 30, "#120f22"); alpha(0.4, () => { R(20, 156, 40, 2, "#ff4fa0"); R(246, 160, 50, 2, "#3df0ff"); });
      return { x: 150, y: 150 };
    },
    station(t, tm) {
      sky(t, 100); stars(t, 30, 60, 9, tm);
      R(0, 0, W, 14, "#2a2840"); for (let i = 0; i < 6; i++) R(i * 64, 14, 3, 30, "#3b3858");
      R(0, 98, W, 22, "#1d1b2c"); R(0, 106, W, 1, "#8a87a8"); R(0, 115, W, 1, "#8a87a8");
      const tx = ((tm % 6) / 6) * (W + 420) - 420;
      R(tx, 60, 420, 42, "#d8dde6"); R(tx, 92, 420, 3, "#ff7a5c"); for (let k = 0; k < 16; k++) R(tx + 10 + k * 26, 68, 18, 12, t === "day" ? "#9ab8d8" : "#7fd7ff");
      R(0, 120, W, 60, "#5a5870"); R(0, 122, W, 2, "#ffd34d");
      R(36, 34, 56, 14, "#2b5aa8"); R(42, 39, 30, 3, "#ffffff"); R(76, 39, 10, 3, "#ffffff");
      disc(262, 32, 8, "#f3efe8"); R(262, 26, 1, 6, "#222"); R(262, 32, 4, 1, "#222");
      return { x: 150, y: 120 };
    },
    bridge(t, tm) {
      sky(t); stars(t, 40, 70, 10, tm); moon(60, 30, 8, t); skyline(112, 18, 70, t === "day" ? "#6a7aa0" : "#1b1838", "#ffcf7a", 25, tm, lit(t));
      R(0, 120, W, 60, "#1a1828");
      for (let i = 0; i < 40; i++) { const dir = i % 2 ? 1 : -1, x = ((hash(i) * W * 2 + tm * 70 * dir) % W + W) % W; R(x, dir > 0 ? 134 : 150, 5, 1, dir > 0 ? "#ff4a4a" : "#fff3c4"); }
      R(0, 115, W, 7, "#3b3858"); R(0, 104, W, 2, "#8a87b8"); for (let x = 0; x < W; x += 16) R(x, 104, 2, 11, "#8a87b8");
      return { x: 150, y: 115 };
    },
    beach(t, tm) {
      sky(t, 104); stars(t, 60, 90, 11, tm); moon(232, 40, 12, t);
      const day = t === "day";
      water(100, 142, day ? "#2b78c8" : "#1b2a5e", day ? "#7cc4f4" : "#3a5aa8", tm);
      for (let y = 102; y < 140; y++) R(228 + Math.sin(y * 0.8 + tm * 4) * 3, y, 8, 1, day ? "#fff2b0" : t === "dusk" ? "#ffb36a" : "#f4e7b8");
      const sh = 140 + Math.sin(beatPhase(tm) * Math.PI * 2) * 3;
      R(0, sh, W, H - sh, day ? "#e8cf98" : t === "dusk" ? "#c8946e" : "#6b5a6e"); R(0, sh, W, 2, "#e9f2ff");
      for (let i = 0; i < 8; i++) R(60 + i * 12, 164 + (i % 2) * 3, 2, 1, day ? "#c9ad78" : "#5a4a5e");
      return { x: 140, y: 160 };
    },
    snowfield(t, tm) {
      sky(t); stars(t, 70, 90, 12, tm); moon(250, 30, 9, t);
      mountains(112, 30, t === "day" ? "#cfd8f0" : "#3a3f6a", 2);
      R(0, 128, W, 52, t === "day" ? "#eef3fc" : "#a9b6d8");
      [30, 62, 268, 298].forEach((x, i) => pine(x, 132 + (i % 2) * 4, "#1f4a3a", true));
      R(176, 100, 44, 30, "#4a3020"); for (let k = 0; k < 10; k++) R(172 + k * 2, 100 - k, 52 - k * 4, 1, "#2a1a14"); R(176, 98, 44, 2, "#eef4ff");
      R(190, 110, 10, 8, "#ffcf7a"); if (t !== "day") glow(195, 114, 18, "#ffcf7a", 0.1);
      for (let i = 0; i < 9; i++) R(20 + i * 12, 158 + (i % 2) * 3, 3, 1, "#8a98c0");
      return { x: 128, y: 154 };
    },
    hill(t, tm) {
      sky("night"); stars("night", 160, 140, 13, tm);
      alpha(0.18, () => { for (let i = 0; i < 300; i++) { const u = hash(i * 9); R(u * W, 10 + u * 70 + (hash(i * 4) - 0.5) * 30, 1, 1, "#cfd6ff"); } });
      const { i: bi } = lastBeat(tm), ph = bi >= 0 && bi % 4 === 0 ? beatPhase(tm) : 1;
      if (ph < 1) { const k = ph, x = 260 - k * 160, y = 20 + k * 50; for (let j = 0; j < 14; j++) alpha(1 - j / 14, () => R(x + j * 3, y - j, 2, 1, "#ffffff")); }
      for (let x = 0; x < W; x++) { const y = 134 + Math.pow((x - 150) / 150, 2) * 34; R(x, y, 1, H - y, "#1f3a2e"); if (hash(x) > 0.7) R(x, y - 1, 1, 1, "#2f5a44"); }
      return { x: 140, y: 134 };
    },
    park(t, tm) {
      const tt = t === "night" ? "dusk" : t;
      sky(tt); moon(260, 30, 10, tt);
      for (let i = 0; i < 3; i++) { const x = ((i * 120 + tm * 4) % 380) - 40; disc(x, 30 + i * 8, 7, "#ffffff"); disc(x + 9, 32 + i * 8, 6, "#ffffff"); }
      R(0, 134, W, 46, tt === "day" ? "#6fae66" : "#4a6a4a"); R(0, 152, W, 10, "#c9b48a");
      tree(46, 136, "#ffb3cd", "#ff7ab0", 18); tree(272, 136, "#ffc2d6", "#ff8fbf", 20);
      bench(128, 141);
      return { x: 131, y: 139, seat: true };
    },
    lakeside(t, tm) {
      sky(t); stars(t, 60, 90, 14, tm); moon(80, 30, 9, t);
      skyline(110, 6, 26, t === "day" ? "#3a6a4a" : "#121a2a", "#ffcf7a", 31, tm, lit(t) * 0.5);
      water(110, 160, t === "day" ? "#3a7ab8" : "#141a3a", t === "day" ? "#8ac4f0" : "#2a3a7a", tm);
      if (t !== "day") for (let y = 112; y < 158; y += 2) R(219 + Math.sin(y + tm * 5) * 2, y, 3, 1, "#ffcf7a");
      R(0, 104, W, 2, "#7a77a0"); for (let x = 0; x < W; x += 20) R(x, 98, 2, 8, "#7a77a0");
      R(0, 160, W, 20, "#3a3650"); lamp(220, 160, t);
      return { x: 120, y: 160 };
    },
    campus(t, tm) {
      const tt = t === "night" ? "dusk" : t;
      sky(tt); moon(280, 28, 11, tt);
      R(30, 52, 180, 70, "#e9e2d0"); R(108, 30, 24, 22, "#e9e2d0"); disc(120, 41, 7, "#ffffff");
      R(120, 37, 1, 4, "#333"); R(120, 41, 4, 1, "#333");
      for (let r = 0; r < 3; r++) for (let c = 0; c < 9; c++) R(38 + c * 19, 60 + r * 20, 12, 10, tt === "day" ? "#7fb3e0" : "#ffcf7a");
      R(0, 122, W, 58, "#c8573e"); for (let k = 0; k < 3; k++) R(0, 134 + k * 14, W, 1, "#f3efe8");
      R(282, 76, 3, 52, "#9a9a9a"); R(266, 74, 28, 16, "#f3efe8"); R(272, 88, 14, 1, "#ff6a3d");
      tree(240, 124, "#3f8a4a", "#5fb06a", 14);
      return { x: 150, y: 146 };
    },
    field(t, tm) {
      const tt = t === "night" ? "dusk" : t;
      sky(tt); disc(240, 98, 16, tt === "day" ? "#ffe58a" : "#ffb36a"); glow(240, 98, 30, "#ffb36a", 0.1);
      mountains(112, 12, tt === "day" ? "#7aa06a" : "#6a3a5a", 4);
      R(0, 110, W, 70, "#c9a24a");
      for (let x = 0; x < W; x += 3) { const h = 6 + Math.sin(x * 0.1 + tm * 3) * 2 + kick(tm) * 2; R(x, 112 - h, 1, h, "#e3c06a"); }
      R(0, 150, W, 9, "#8a6a3a");
      [60, 160, 260].forEach((x) => { R(x, 64, 2, 48, "#4a3a2a"); R(x - 6, 66, 14, 2, "#4a3a2a"); });
      for (let x = 60; x < 260; x++) { const u = ((x - 60) % 100) / 100; R(x, 66 + Math.sin(u * Math.PI) * 6, 1, 1, "#3a2a2a"); }
      return { x: 120, y: 150 };
    },
    courtyard(t, tm) {
      sky(t); stars(t, 50, 60, 15, tm);
      const wall = t === "day" ? "#ece6d6" : t === "dusk" ? "#c9b8b0" : "#8a86a0";
      R(0, 58, W, 96, wall); R(0, 50, W, 10, "#2a2a3a"); for (let x = 0; x < W; x += 6) R(x, 50, 3, 10, "#3a3a4e");
      clipCircle(160, 108, 36, () => { sky(t, H); stars(t, 30, 140, 16, tm); moon(172, 92, 10, t); });
      for (let a = 0; a < 360; a += 3) { const r = a * Math.PI / 180; R(160 + Math.cos(r) * 37, 108 + Math.sin(r) * 37, 2, 2, "#5a5468"); }
      [70, 250].forEach((x, i) => { const sw = Math.sin(tm * 2 + i) * 2, gl = 0.08 + kick(tm) * 0.1; R(x, 60, 1, 10, "#2a2a3a"); R(x - 5 + sw, 70, 11, 13, "#d8342c"); R(x - 4 + sw, 69, 9, 2, "#e8b84a"); R(x - 4 + sw, 82, 9, 2, "#e8b84a"); if (t !== "day") glow(x + sw, 76, 16, "#ff6a3a", gl); });
      for (let i = 0; i < 8; i++) { const x = 6 + i * 6; for (let y = 0; y < 50 + i * 4; y++) R(x + Math.sin(tm * 1.5 + y * 0.08 + i) * (y / 30), y, 1, 1, "#4a7a4a"); }
      R(0, 154, W, 26, "#5a5868"); R(206, 158, 90, 10, "#2a3a6a"); alpha(0.5, () => R(214 + Math.sin(tm) * 3, 161, 20, 1, "#8ab0ff"));
      return { x: 150, y: 154 };
    },
    space(t, tm) {
      R(0, 0, W, H, "#05040e"); stars("night", 220, 180, 17, tm);
      disc(254, 42, 22, "#2a6ad0"); disc(246, 36, 8, "#3fae6a"); disc(262, 50, 6, "#3fae6a"); alpha(0.25, () => disc(254, 42, 25, "#7ab8ff"));
      disc(160, 430, 296, "#6b6880"); disc(160, 432, 292, "#7a7690");
      [[90, 152, 6], [210, 148, 4], [250, 160, 7]].forEach(([x, y, r]) => { disc(x, y, r, "#5a5670"); disc(x, y - 1, r - 1, "#66627c"); });
      return { x: 150, y: 136, lowG: true };
    },
    ferris(t, tm) {
      const tt = t === "day" ? "dusk" : t;
      sky(tt); stars(tt, 60, 90, 18, tm);
      const cx = 210, cy = 78, r = 50, rot = tm * 0.25, k = kick(tm), bi = Math.max(0, lastBeat(tm).i);
      R(cx - 30, cy, 2, 72, "#4a4670"); R(cx + 28, cy, 2, 72, "#4a4670");
      for (let s = 0; s < 10; s++) { const a = rot + s * Math.PI / 5; for (let q = 0; q < r; q += 2) R(cx + Math.cos(a) * q, cy + Math.sin(a) * q, 1, 1, "#7a76a8"); }
      for (let a = 0; a < 360; a += 4) { const ra = a * Math.PI / 180; const on = ((a / 4 + bi * 3) % 6) < 3; R(cx + Math.cos(ra) * r, cy + Math.sin(ra) * r, 1, 1, on ? "#ffd34d" : "#8a76a8"); }
      for (let s = 0; s < 10; s++) { const a = rot + s * Math.PI / 5; R(cx + Math.cos(a) * r - 3, cy + Math.sin(a) * r, 7, 6, ["#ff7ab0", "#5ab0ff", "#ffd34d", "#7be0b4", "#ff7a5c"][s % 5]); }
      if (k > 0) glow(cx, cy, 60, "#ffd34d", 0.05 * k);
      R(0, 150, W, 30, "#2a2440"); for (let x = 0; x < W; x += 8) R(x, 140, 2, 10, "#4a4670"); R(0, 142, W, 2, "#4a4670");
      return { x: 70, y: 150 };
    },
    cloud(t, tm) {
      const tt = t === "night" ? "dusk" : t;
      sky(tt, H, tt === "day" ? ["#ffd6e8", "#f8c8f0", "#d8c8ff", "#c0d8ff", "#b8e8ff"] : ["#3a2a6a", "#6a3a8a", "#a85aa0", "#e88ab0", "#ffc0c8"]);
      for (let i = 0; i < 20; i++) { const a = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(tm * 2 + i)); alpha(a, () => R(hash(i) * W, hash(i * 2) * 100, 1, 1, "#ffffff")); }
      const bob = (i) => Math.sin(tm * 1.2 + i) * 2;
      [[50, 124, 0], [160, 142, 1], [262, 116, 2]].forEach(([x, y, i]) => { const yy = y + bob(i); disc(x, yy, 12, "#ffffff"); disc(x - 14, yy + 4, 9, "#ffffff"); disc(x + 14, yy + 4, 9, "#ffffff"); R(x - 22, yy + 4, 44, 9, "#ffffff"); R(x - 22, yy + 12, 44, 2, "#e8e0f8"); });
      return { x: 149, y: 134 + bob(1) };
    },
    club(t, tm) {
      const L = CUR.light, k = kick(tm), bi = beatIdx(tm);
      R(0, 0, W, H, "#0c071c"); R(0, 0, W, 60, "#140a2a"); R(0, 60, W, 70, "#120926");
      const f1 = L > 0.3 && (k > 0.2 || Math.sin(tm * 17) > -0.8), f2 = L > 0.5 && Math.sin(tm * 11 + 1) > -0.6;
      outline(26, 26, 64, 16, f1 ? "#ff4fa0" : "#3a1428"); R(32, 31, 52, 6, f1 ? "#ff8fc6" : "#2a1020"); if (f1) glow(58, 34, 30, "#ff4fa0", 0.1 * L);
      outline(230, 34, 66, 14, f2 ? "#3df0ff" : "#123a40"); R(236, 38, 54, 6, f2 ? "#b8fbff" : "#0e2a30"); if (f2) glow(263, 41, 30, "#3df0ff", 0.1 * L);
      for (let y = -7; y <= 7; y++) for (let x = -7; x <= 7; x++) if (x * x + y * y <= 49) R(160 + x, 16 + y, 1, 1, (x + y + bi) % 2 ? "#d8d8e8" : "#8a8aa8");
      if (L > 0.05) { const cols = ["#ff4fa0", "#3df0ff", "#a66bff", "#ffd34d"]; alpha(0.1 * L * (0.6 + k), () => { for (let n = 0; n < 4; n++) { const a = Math.sin(tm * 0.9 + n * 1.7) * 0.9, c = cols[(n + bi) % 4]; for (let s = 0; s < 120; s++) { const x = 160 + Math.sin(a) * s * 1.4, w = 1 + s * 0.18; R(x - w / 2, 22 + s, w, 1, c); } } }); }
      const pal = ["#ff4fa0", "#3df0ff", "#a66bff", "#ffd34d"];
      for (let j = 0; j < 5; j++) for (let i = 0; i < 16; i++) {
        const on = L > 0.05 && hash(i * 7 + j * 13 + bi * 31) > 0.45;
        R(i * 20, 130 + j * 10, 19, 9, on ? pal[(i + j + bi) % 4] : "#1a1030");
        if (on) { alpha(0.35, () => R(i * 20, 130 + j * 10, 19, 9, "#000")); alpha(1 - L, () => R(i * 20, 130 + j * 10, 19, 9, "#1a1030")); }
      }
      return { x: 138, y: 152, club: true };
    },
    calllog(t, tm) {
      sky(t); stars(t, 50, 180, 3, tm);
      R(100, 4, 120, 174, "#0f0e18"); R(104, 14, 112, 152, "#f3f0f8"); R(104, 14, 112, 10, "#e2deee");
      const sp = Math.floor(tm * 6) % 8; for (let k = 0; k < 8; k++) R(158 + Math.round(Math.cos(k * Math.PI / 4) * 4), 34 + Math.round(Math.sin(k * Math.PI / 4) * 4), 1, 1, k === sp ? "#5b5270" : "#d2cde0");
      for (let r = 0; r < 4; r++) { R(110, 50 + r * 20, 100, 14, "#ebe7f3"); R(114, 54 + r * 20, 40, 3, "#d6d1e2"); R(114, 59 + r * 20, 24, 2, "#e0dbea"); }
      R(108, 146, 104, 14, "#ffffff"); outline(108, 146, 104, 14, "#c9c3dc");
      return { x: 128, y: 146, typeBox: [110, 147, 100, 12], typeDark: true };
    },
  };

  function weatherFx(kind, tm, x0 = 0, w = W, y0 = 0, h = H) {
    if (kind === "rain") { b.fillStyle = "rgba(180,200,255,0.55)"; for (let i = 0; i < 110; i++) { const p = (tm * 1.6 * (0.8 + hash(i) * 0.4) + hash(i * 3)) % 1, x = x0 + hash(i * 5) * w * 1.25 - p * 50 * (w / W), y = y0 + p * (h + 20) - 10; if (x >= x0 && x < x0 + w) b.fillRect(Math.round(x), Math.round(y), 1, 5); } }
    else if (kind === "snow") { for (let i = 0; i < 80; i++) { const p = (tm * 0.12 * (0.6 + hash(i)) + hash(i * 5)) % 1, x = hash(i * 2) * W + Math.sin(tm + i) * 6, y = p * (H + 6) - 3, s = hash(i * 7) > 0.7 ? 2 : 1; R(x, y, s, s, "#f2f6ff"); } }
    else if (kind === "petals" || kind === "leaves") { const cols = kind === "petals" ? ["#ffb3cd", "#ff8fbf", "#ffd6e6"] : ["#e8914a", "#c9622f", "#f2b45a"]; for (let i = 0; i < 40; i++) { const p = (tm * 0.15 * (0.6 + hash(i)) + hash(i * 5)) % 1, x = hash(i * 2) * W * 1.3 - p * 70 + Math.sin(tm * 2 + i) * 5, y = p * (H + 6) - 3; R(x, y, 2, 1, cols[i % 3]); } }
    else if (kind === "fireflies") { for (let i = 0; i < 26; i++) { const x = hash(i) * W + Math.sin(tm * 0.7 + i) * 10, y = 60 + hash(i * 3) * 110 + Math.cos(tm * 0.9 + i) * 6, a = 0.5 + 0.5 * Math.sin(tm * 3 + i * 2); alpha(a, () => R(x, y, 1, 1, "#fff3a0")); alpha(a * 0.25, () => disc(x, y, 2, "#ffe65a")); } }
    else if (kind === "fog") { for (let k = 0; k < 4; k++) alpha(0.12, () => R(((tm * 6 * (k + 1)) % 60) - 60, 70 + k * 22, W + 120, 12, "#cfd0e8")); }
  }

  /* ================= characters ================= */
  const KIND = {
    claude: { body: "#d97757" },
    girl: { body: "#f4a6c0", bow: "#ff4f8f" },
    rival: { body: "#6c7fa8", hair: "#2a3048" },
    friend: { body: "#7be0b4" },
    ghost: { body: "#6f6a86", eye: "#ffffff" },
  };
  function personPx(kind, st) {
    const K = Object.assign({}, KIND[kind] || KIND.claude, (CAST[st.id] || {}).color ? { body: CAST[st.id].color } : {}), px = [], body = K.body, dark = K.eye || "#1b1420";
    for (let r = 0; r <= 5; r++) for (let c = 2; c <= 8; c++) px.push([c, r, body]);
    const armRow = st.armsUp ? 1 : 3;
    px.push([0, st.waveL ? 1 : armRow, body]); px.push([1, st.waveL ? 1 : armRow, body]); if (st.waveL || st.armsUp) px.push([0, 0, body]);
    if (st.reach) { [[9, 3], [10, 3], [11, 3], [12, 2]].forEach(([c, r]) => px.push([c, r, body])); }
    else { px.push([9, st.waveR ? 1 : armRow, body]); px.push([10, st.waveR ? 1 : armRow, body]); if (st.waveR || st.armsUp) px.push([10, 0, body]); }
    const ex = st.eyeDx || 0, ey = st.eyeDy || 0, e = st.eyes || "normal";
    if (e === "closed") { px.push([3 + ex, 2, dark]); px.push([7 + ex, 2, dark]); }
    else if (e === "happy") [[2, 2], [3, 1], [4, 2], [6, 2], [7, 1], [8, 2]].forEach(([c, r]) => px.push([c, r, dark]));
    else if (e === "scared") [[3, 0], [3, 1], [3, 2], [7, 0], [7, 1], [7, 2], [5, 4]].forEach(([c, r]) => px.push([c + ex, r, dark]));
    else { [[3, 1], [3, 2], [7, 1], [7, 2]].forEach(([c, r]) => px.push([c + ex, r + ey, dark])); if (e === "liner") [[4, 0 + ey], [8, 0 + ey], [2, 1 + ey]].forEach(([c, r]) => px.push([c + ex, r, dark])); }
    if (st.sit) [[3, 6], [4, 6], [5, 6], [7, 6], [8, 6], [9, 6]].forEach(([c, r]) => px.push([c, r, body]));
    else (st.leg ? [[2, 6], [4, 6], [4, 7], [6, 6], [8, 6], [8, 7]] : [[2, 6], [2, 7], [4, 6], [6, 6], [6, 7], [8, 6]]).forEach(([c, r]) => px.push([c, r, body]));
    if (K.bow) [[8, -2], [10, -2], [8, -1], [9, -1], [10, -1]].forEach(([c, r]) => px.push([c, r, K.bow]));
    if (K.hair) [[3, -1], [5, -1], [7, -1], [4, -1], [6, -1], [5, -2]].forEach(([c, r]) => px.push([c, r, K.hair]));
    if (st.glasses) { const u = st.glassesUp || 0; [[2, 1], [3, 1], [4, 1], [6, 1], [7, 1], [8, 1], [3, 2], [7, 2], [5, 1]].forEach(([c, r]) => px.push([c, r + u, "#0a0a12"])); px.push([3, 1 + u, "#5a5a80"]); }
    if (st.scarf) { [[2, 3], [3, 3], [4, 3], [5, 3], [6, 3], [7, 3], [8, 3]].forEach(([c, r], i) => px.push([c, r, i % 2 ? "#f3e9ff" : "#b56cff"])); [[6, 4], [6, 5], [7, 4], [7, 5]].forEach(([c, r]) => px.push([c, r, "#b56cff"])); }
    if (st.sweat) [[11, 0], [11, 1], [12, 1]].forEach(([c, r]) => px.push([c, r, "#8fd0ff"]));
    if (st.bang) { [[5, -5], [5, -4], [5, -3]].forEach(([c, r]) => px.push([c, r, "#ffd36b"])); px.push([5, -1, "#ffd36b"]); }
    if (st.cap) [[5, -1], [4, -1], [6, -1], [3, -1], [7, -1]].slice(0, st.cap).forEach(([c, r]) => px.push([c, r, "#f4f7ff"]));
    return px;
  }
  function person(kind, x, gy, cell, st) {
    const face = st.face || 1, sq = st.sq || 0, a = st.alpha == null ? 1 : st.alpha;
    b.save(); b.globalAlpha = b.globalAlpha * a; b.translate(x + 5.5 * cell, gy); if (st.rot) b.rotate(st.rot); b.scale(face * (1 + sq), 1 - sq);
    if (kind === "claude" && CUR.sprite) { const s = CUR.sprite, sw = s.width * cell * 0.7, sh = s.height * cell * 0.7; b.imageSmoothingEnabled = false; b.drawImage(s, -sw / 2, -sh, sw, sh); }
    else for (const [c, r, col] of personPx(kind, st)) { b.fillStyle = col; b.fillRect(-5.5 * cell + c * cell, -8 * cell + r * cell, cell + 0.1, cell + 0.1); }
    b.restore();
    const cx = x + 5.5 * cell;
    return { cx, head: gy - 8 * cell, handR: cx + face * 5 * cell, handL: cx - face * 5 * cell, handY: gy - 4.5 * cell, eyeY: gy - 6.5 * cell, gy, face, cell };
  }
  function shadow(x, y, lift, w = 16) { const k = Math.min(1, lift / 20); alpha(0.35 * (1 - 0.6 * k), () => { b.fillStyle = "#000"; b.beginPath(); b.ellipse(x, y, w * (1 - 0.4 * k), 3, 0, 0, Math.PI * 2); b.fill(); }); }
  function ripple(x, y, g, col = "#ffb08f") { const { b: bt } = lastBeat(g), d = g - bt, k = d / 0.45; if (bt < 0 || k > 1 || k < 0) return; alpha((1 - k) * 0.9, () => { b.strokeStyle = col; b.lineWidth = 1; b.beginPath(); b.ellipse(x, y, 4 + k * 28, (4 + k * 28) * 0.3, 0, 0, Math.PI * 2); b.stroke(); }); }
  const HEART = [".XX.XX.", "XXXXXXX", "XXXXXXX", ".XXXXX.", "..XXX..", "...X..."];
  function heart(cx, cy, s, crack, sep, fall, col = "#ff4f8f") {
    HEART.forEach((row, r) => [...row].forEach((ch, c) => { if (ch !== "X") return; const left = c < 3 || (c === 3 && r % 2 === 0), dx = crack ? (left ? -sep : sep) : 0, dy = crack ? fall * (left ? 1 : 1.2) : 0; R(cx + (c - 3.5) * s + dx, cy + (r - 3) * s + dy, s, s, col); }));
    if (crack && sep < 1) for (let r = 0; r < 6; r++) R(cx + ((r % 2) - 0.5) * s, cy + (r - 3) * s, 1, s, "#2a0a18");
  }
  function sparkle(x, y, g, i) { alpha(0.5 + 0.5 * Math.sin(g * 9 + i * 2), () => { R(x, y - 2, 1, 5, "#fff6b0"); R(x - 2, y, 5, 1, "#fff6b0"); }); }
  function umbrellaProp(ux, uy) { for (let k = 0; k < 8; k++) R(ux - 4 - k * 1.6, uy + k, 9 + k * 3.2, 1, k % 2 ? "#ff7ab0" : "#ff5f98"); R(ux, uy + 7, 1, 12, "#3a2a3a"); }
  function scarfProp(x, y) { for (let i = 0; i < 12; i++) R(x + i, y + Math.sin(i * 0.6), 1, 3, i % 3 === 0 ? "#f3e9ff" : "#b56cff"); R(x + 10, y + 3, 3, 5, "#b56cff"); }
  function crowd(g, a) {
    alpha(a, () => { for (let i = 0; i < 9; i++) { const x = 10 + i * 36 + hash(i) * 10, j = jumpH(g + hash(i) * 0.2, 0.5, 4 + hash(i * 3) * 4), col = i % 2 ? "#2a1f45" : "#33245a"; for (const [c, r] of personPx("claude", { leg: (beatIdx(g) + i) % 2, armsUp: (beatIdx(g) + i) % 3 === 0 })) { b.fillStyle = col; b.fillRect(x + c * 2.4, 152 - j - 19.2 + r * 2.4, 2.5, 2.5); } } });
  }
  function puffs(x, y, dir, k) { alpha(1 - k, () => { for (let n = 0; n < 3; n++) disc(x + dir * (12 + k * 80 + n * 6), y + Math.sin(n) * 3, 3 + n, "#e8e4f4"); }); }
  function particles(x, y, d, life, n, cols, sp, seed, rise) { if (d < 0 || d > life) return; for (let j = 0; j < n; j++) { const h1 = hash(seed * 97 + j), h2 = hash(seed * 31 + j * 7), ang = h1 * Math.PI * 2, v = sp * (0.35 + 0.65 * h2); alpha(1 - d / life, () => R(x + Math.cos(ang) * v * d, y + (rise ? -Math.abs(Math.sin(ang)) * v * d : Math.sin(ang) * v * d * 0.8 - 30 * d + 160 * d * d), 2, 2, cols[j % cols.length])); } }

  /* ================= actors & story beats ================= */
  const ANCH = {};
  let MEMPOS = null, LASTSPOT = {};
  const beatsOf = (seg, who, name) => seg.beats.filter((x) => x.do === name && (who == null || x.who === who || (x.who == null && who === "claude")));
  const live = (x, g, def) => g >= x.t && g < x.t + (x.dur != null ? x.dur : def != null ? def : 1e9);
  function pathX(a, g, x0) {
    if (!a.path || !a.path.length) return a.x != null ? a.x : x0;
    const P = a.path; if (g <= P[0][0]) return P[0][1];
    for (let k = 1; k < P.length; k++) if (g <= P[k][0]) return lerp(P[k - 1][1], P[k][1], eInOut(prog(g, P[k - 1][0], P[k][0])));
    return P[P.length - 1][1];
  }
  function pathDir(a, g) { if (!a.path) return 0; const P = a.path; for (let k = 1; k < P.length; k++) if (g > P[k - 1][0] && g < P[k][0] && P[k][1] !== P[k - 1][1]) return Math.sign(P[k][1] - P[k - 1][1]); return 0; }
  function pathSpan(a) { return a.path && a.path.length > 1 ? [a.path[0][0], a.path[a.path.length - 1][0]] : null; }

  // draws every actor of a segment (or a desktop window) into the current target and fills ANCH
  function drawActors(seg, g, spot) {
    const bi = beatIdx(g), crowdOut = beatsOf(seg, undefined, "crowd-out").concat(beatsOf(seg, "claude", "crowd-out"))[0];
    if (seg.crowd) crowd(g, 0.85 * (crowdOut ? 1 - prog(g, crowdOut.t, crowdOut.t + (crowdOut.dur || 1)) : 1));
    const acts = seg.actors || [];
    const states = acts.map((a, idx) => {
      if (a.show && (g < a.show[0] || g >= a.show[1])) return null;
      const kind = kindOf(a.id), props = new Set(a.props || []);
      const st = { id: a.id, leg: (bi + idx) % 2, sq: 0, face: a.face || 1, eyes: a.eyes || "normal", alpha: a.alpha == null ? 1 : a.alpha, rot: a.lean || 0, sit: a.act === "sit" || !!a.sit };
      let x = pathX(a, g, spot.x + idx * 40), gy = a.y != null ? a.y : spot.y, cell = a.cell || 3, lift = 0, ripples = a.ripple !== false;
      const span = pathSpan(a); if (a.cellTo && span) cell = lerp(cell, a.cellTo, prog(g, span[0], span[1]));
      const dir = pathDir(a, g); if (a.face == null && dir) st.face = dir;
      const act = a.act || "hop", p = beatPhase(g), { b: bt } = lastBeat(g), dl = g - bt, land = bt >= 0 && dl < 0.1 ? 0.14 * (1 - dl / 0.1) * LEVEL + 0.02 : 0;
      switch (act) {
        case "hop": lift = jumpH(g, 0.55, 10); st.sq = land; break;
        case "dance": lift = jumpH(g, 0.6, 16); st.sq = land; st.armsUp = bi % 2 === 0; if (a.face == null && !dir) st.face = bi % 4 < 2 ? 1 : -1; break;
        case "idle": ripples = false; break;
        case "walk": lift = dir ? jumpH(g, 0.5, 3) : 0; break;
        case "run": lift = jumpH(g, 0.5, 5); st.leg = Math.floor(g / (BEAT / 2)) % 2; break;
        case "sit": st.sq = land * 0.4; ripples = false; break;
        case "window": st.eyeDy = -1; st.eyeDx = 1; ripples = false; break;
        case "phone": st.eyeDy = 1; ripples = false; props.add("phone"); break;
        case "type": st.eyeDy = 1; lift = jumpH(g, 0.4, 3); st.sweat = Math.floor(g * 1.5) % 3 === 0; break;
        case "look": st.eyeDy = -1; st.armsUp = bi % 4 === 0; lift = jumpH(g, 0.4, 3); break;
        case "wave": st.waveR = bi % 2 === 0; st.waveL = bi % 2 === 1; lift = jumpH(g, 0.45, 4); break;
        case "shiver": x += Math.sin(g * 70); st.sweat = Math.floor(g * 3) % 2 === 0; ripples = false; break;
        case "catch": lift = jumpH(g, 0.6, spot.lowG ? 28 : 18); st.armsUp = lift > 6; st.sq = land; break;
        case "umbrella": lift = jumpH(g, 0.5, 3); props.add("umbrella"); break;
        case "lantern": lift = jumpH(g, 0.5, 3); props.add("lantern"); break;
        case "hug": lift = jumpH(g, 0.55, 6); st.sq = land; break;
      }
      if (a.intro && g - seg.t0 < (seg.t1 - seg.t0) * 0.6) { st.cap = clamp(Math.floor((g - seg.t0) / 0.4), 0, 5); x += Math.sin(g * 60) * 0.8; lift = Math.min(lift, 4); }
      // story beats addressed to this actor
      const B = (name) => beatsOf(seg, a.id, name);
      B("turn").forEach((x_) => { if (g >= x_.t) st.face *= -1; });
      B("eyes").forEach((x_) => { if (live(x_, g, 1)) st.eyes = x_.value; });
      B("wave").forEach((x_) => { if (live(x_, g, 1)) { st.waveR = bi % 2 === 0; st.waveL = !st.waveR; } });
      B("armsUp").forEach((x_) => { if (live(x_, g, 0.6)) st.armsUp = true; });
      B("reach").forEach((x_) => { if (g >= x_.t) st.reach = true; });
      B("glance").forEach((x_) => { if (live(x_, g, 0.8)) st.eyeDx = x_.value || -2; });
      B("fade").forEach((x_) => { st.alpha *= 1 - prog(g, x_.t, x_.t + (x_.dur || 0.6)); });
      B("fade-in").forEach((x_) => { st.alpha *= prog(g, x_.t, x_.t + (x_.dur || 0.6)); });
      B("dissolve").forEach((x_) => { st.alpha *= 1 - prog(g, x_.t, x_.t + 0.7); });
      B("glasses-off").forEach((x_) => { if (g >= x_.t) { const k = prog(g, x_.t, x_.t + 0.5); st.glassesUp = -Math.round(k * 4); if (k >= 1) props.delete("glasses"); } });
      B("scarf-out").forEach((x_) => { if (g >= x_.t) { props.add("scarfHeld"); if (g < x_.t + 0.6) st.armsUp = true; } });
      B("drop-umbrella").forEach((x_) => { if (g >= x_.t) props.delete("umbrella"); });
      B("cry").forEach((x_) => { if (live(x_, g)) { st.eyes = "closed"; x += Math.sin(g * 40) * 0.6; } });
      B("scared").forEach((x_) => { const d = g - x_.t; if (d >= 0 && d < 1.6) { st.eyes = "scared"; st.bang = d < 1.0; st.armsUp = d < 0.5; lift = d < 0.5 ? 60 * (d / 0.5) * (1 - d / 0.5) : 0; if (d >= 0.5) { st.sq = 0.22 * (1 - prog(d, 0.5, 0.64)); x += Math.sin(g * 80) * 1.2; st.rot = Math.sin(g * 70) * 0.03; st.sweat = true; } } });
      reacts.forEach((e) => { if ((e.who || "claude") === a.id) { const d = g - e.t; if (d >= 0 && d < 1.6) { st.eyes = "scared"; st.bang = d < 1.0; st.armsUp = d < 0.5; lift = d < 0.5 ? 60 * (d / 0.5) * (1 - d / 0.5) : lift; if (d >= 0.5) { st.sq = 0.22 * (1 - prog(d, 0.5, 0.64)); st.sweat = true; } } } });
      if (props.has("glasses")) st.glasses = true; if (props.has("scarf")) st.scarf = true;
      return { a, idx, kind, st, x, gy, cell, lift, ripples, props };
    }).filter(Boolean);
    // spotlights first, so the light sits behind the characters
    seg.beats.filter((x_) => x_.do === "spotlight").forEach((x_) => {
      const tgt = states.find((s) => s.a.id === (x_.who || "claude")); if (!tgt || !live(x_, g)) return;
      const k = prog(g, x_.t, x_.t + 0.2) * (x_.dur ? 1 - prog(g, x_.t + x_.dur - 0.4, x_.t + x_.dur) : 1), sx = tgt.x + 5.5 * tgt.cell;
      alpha(0.22 * k, () => { for (let s = 0; s < tgt.gy; s++) { const w = 6 + s * 0.22; R(sx - w / 2, s, w, 1, "#fff4c8"); } b.fillStyle = "#fff4c8"; b.beginPath(); b.ellipse(sx, tgt.gy, 24, 5, 0, 0, Math.PI * 2); b.fill(); });
    });
    for (const s of states) {
      const cx = s.x + 5.5 * s.cell;
      if (!s.st.sit) shadow(cx, s.gy, s.lift, 5.3 * s.cell);
      if (s.ripples && !s.st.sit && LEVEL > 0.1 && s.lift < 0.5) alpha(s.st.alpha, () => ripple(cx, s.gy, g, s.kind === "claude" ? "#ffb08f" : "#ff9cc4"));
      const A = person(s.kind, s.x, s.gy - s.lift, s.cell, s.st);
      ANCH[s.a.id] = A; s.A = A;
    }
    // held hands, until a hands-break beat
    for (const s of states) if (s.a.hold) {
      const other = states.find((o) => o.a.id === s.a.hold), brk = beatsOf(seg, s.a.id, "hands-break")[0];
      if (other && (!brk || g < brk.t)) { const x0 = Math.min(s.A.handR, other.A.handR, s.A.handL, other.A.handL), hx0 = s.A.face > 0 ? s.A.handR : s.A.handL, hx1 = other.A.face > 0 ? other.A.handR : other.A.handL; R(Math.min(hx0, hx1), s.A.handY - s.lift, Math.abs(hx1 - hx0) + 1, 2, "#e9a17f"); void x0; }
      if (brk) particles((s.A.cx + (other ? other.A.cx : s.A.cx)) / 2, s.A.handY, g - brk.t, 0.9, 18, ["#e9a17f", "#ffd34d", "#ffffff"], 70, 3);
    }
    // props and emotes
    for (const s of states) {
      const A = s.A, al = s.st.alpha;
      alpha(al, () => {
        if (s.props.has("umbrella")) umbrellaProp(A.cx, A.head - 10);
        if (s.props.has("phone")) { R(A.cx + 2 * s.cell, A.handY - 2, 4, 6, "#1b1420"); R(A.cx + 2 * s.cell + 1, A.handY - 1, 2, 4, "#bfe3ff"); glow(A.cx + 2 * s.cell + 2, A.handY + 1, 8, "#bfe3ff", 0.15); }
        if (s.props.has("lantern")) { R(A.cx + 12, A.head + 6, 1, 5, "#3a2a2a"); R(A.cx + 9, A.head + 11, 7, 8, "#d8342c"); glow(A.cx + 12, A.head + 15, 14, "#ff6a3a", 0.12 + kick(g) * 0.2); }
        if (s.props.has("scarfHeld")) { const x_ = beatsOf(seg, s.a.id, "scarf-out")[0], k = x_ ? eOutBack(prog(g, x_.t, x_.t + 0.3)) : 1; alpha(Math.min(1, k), () => scarfProp(A.cx - 6, A.handY - 2 - k * 6)); }
      });
      beatsOf(seg, s.a.id, "cry").forEach((x_) => { if (!live(x_, g)) return; const hx = A.cx, hy = A.head - 10; alpha(0.95, () => { disc(hx - 6, hy, 6, "#4a4a66"); disc(hx + 3, hy - 2, 7, "#55557a"); disc(hx + 10, hy + 1, 5, "#4a4a66"); }); weatherFx("rain", g, hx - 14, 30, hy + 4, 40); for (let q = 0; q < 2; q++) for (let k = 0; k < 4; k++) { const pp = ((g - x_.t) * 1.4 + k * 0.25 + q * 0.12) % 1; R(A.cx + (q ? -2 : 2) * s.cell, A.eyeY + pp * 24, 1, 2, "#8fd0ff"); } });
      beatsOf(seg, s.a.id, "sparkle").forEach((x_) => { if (live(x_, g, 3)) for (let i = 0; i < 4; i++) sparkle(A.cx - 18 + hash(i) * 36, A.head - 4 + hash(i * 3) * 20, g, i); });
      beatsOf(seg, s.a.id, "heart").forEach((x_) => {
        if (!live(x_, g)) return; const crack = beatsOf(seg, s.a.id, "heart-crack")[0], cr = crack && g >= crack.t;
        const sep = cr ? prog(g, crack.t, crack.t + 0.3) * 6 : 0, fall = cr ? 60 * Math.pow(prog(g, crack.t + 0.3, crack.t + 1.3), 2) : 0, s2 = 2 * (1 + kick(g) * 0.35);
        alpha(cr ? 1 - prog(g, crack.t + 1.1, crack.t + 2.1) : 1, () => heart(A.cx, A.head - 14, s2, cr, sep, fall));
        if (cr) particles(A.cx, A.head - 14, g - crack.t, 0.9, 26, ["#ff4f8f", "#ff9cc4", "#ffffff"], 80, 11);
      });
      beatsOf(seg, s.a.id, "puff").forEach((x_) => { const d = g - x_.t; if (d >= 0 && d < 0.6) { const tgt = states.find((o) => o.a.id === x_.target), dir = tgt ? Math.sign(tgt.A.cx - A.cx) || -1 : -1; puffs(A.cx, A.eyeY + 6, dir, d / 0.6); } });
      beatsOf(seg, s.a.id, "drop-umbrella").forEach((x_) => { if (g < x_.t) return; const k = eOutBounce(prog(g, x_.t, x_.t + 0.5)); b.save(); b.translate(A.cx + 10, lerp(A.gy - 30, A.gy - 3, k)); b.rotate(lerp(0, 1.3, k)); umbrellaProp(0, -8); b.restore(); });
      beatsOf(seg, s.a.id, "dissolve").forEach((x_) => { const dk = prog(g, x_.t, x_.t + 0.9); if (dk > 0 && dk < 1) for (let i = 0; i < 40; i++) alpha(1 - dk, () => R(A.cx - 11 + hash(i * 7) * 22 + Math.sin(g * 3 + i) * 3, A.head + 8 - dk * (40 + hash(i * 13) * 50), 2, 2, i % 2 ? "#f4a6c0" : "#ff4f8f")); });
    }
    // memory bubble: someone from the past floats in, holding something; it pops
    MEMPOS = null;
    seg.beats.filter((x_) => x_.do === "memory").forEach((x_) => {
      if (g < x_.t || g >= (x_.until || x_.t + 3)) return;
      const at = x_.at || [82, 62], k = prog(g, x_.t, x_.t + 0.8), bx = lerp(-40, at[0], eOutCubic(k)), by = at[1] + Math.sin(g * 2) * 3;
      alpha(0.9, () => disc(bx, by, 26, "#3a2a5a")); alpha(0.5, () => disc(bx, by, 25, "#fbf8ff"));
      for (let q = 0; q < 360; q += 4) { const r = (q * Math.PI) / 180; R(bx + Math.cos(r) * 26, by + Math.sin(r) * 26, 1, 1, "#ffffff"); }
      person(x_.show || "girl", bx - 12, by + 14, 1.8, { face: 1, eyes: "happy", reach: true, leg: 0 });
      if ((x_.prop || "scarf") === "scarf") scarfProp(bx + 4, by - 2);
      MEMPOS = [bx, by + 26];
    });
    seg.beats.filter((x_) => x_.do === "memory").forEach((x_) => { const u = x_.until || x_.t + 3, at = x_.at || [82, 62]; particles(at[0], at[1], g - u, 0.9, 30, ["#ffffff", "#ffb3cd", "#b56cff"], 90, 7); });
    return states;
  }

  /* ================= camera & two-layer output ================= */
  const W2 = 1920, H2 = 1080, BASE = 6;
  const oS = $("stage").getContext("2d"), oF = $("front").getContext("2d");
  let CAM = { cx: 160, cy: 90, z: 1, sx: 0, sy: 0 };
  const toScreen = (bx, by) => ({ x: (bx - CAM.cx) * BASE * CAM.z + W2 / 2 + CAM.sx, y: (by - CAM.cy) * BASE * CAM.z + H2 / 2 + CAM.sy });
  function cameraFor(seg, g) {
    const local = g - seg.t0, len = seg.t1 - seg.t0, F = ANCH[seg.focus || "claude"] || ANCH[(seg.actors && seg.actors[0] && seg.actors[0].id) || "claude"] || { cx: 160, head: 70 };
    const fx = F.cx, fy = F.head + 12;
    let z = 1, cx = 160, cy = 90;
    if (seg.camKeys && seg.camKeys.length) {
      const K = seg.camKeys.map(([t, v]) => [t, Object.assign({ cx: 160, cy: 90, z: 1 }, v.focus ? { cx: fx, cy: fy } : {}, v)]);
      let v = K[0][1]; if (g >= K[K.length - 1][0]) v = K[K.length - 1][1]; else for (let k = 1; k < K.length; k++) if (g < K[k][0]) { const q = eInOut(prog(g, K[k - 1][0], K[k][0])); v = { cx: lerp(K[k - 1][1].cx, K[k][1].cx, q), cy: lerp(K[k - 1][1].cy, K[k][1].cy, q), z: lerp(K[k - 1][1].z, K[k][1].z, q) }; break; }
      ({ cx, cy, z } = v);
    } else if (seg.cam === "close") { z = 2.3 + local * 0.02; cx = fx; cy = fy; }
    else if (seg.cam === "pullout") { const k = eInOut(prog(local, len * 0.55, len)); z = lerp(2.3, 1, k); cx = lerp(fx, 160, k); cy = lerp(fy, 90, k); }
    else if (seg.cam === "push") { const k = eInOut(prog(local, 0, len)); z = lerp(1, 1.18, k); cx = lerp(160, fx, k * 0.6); cy = lerp(90, fy, k * 0.4); }
    else if (seg.cam === "follow") { z = 1.3; cx = fx; cy = fy - 10; }
    if (local < 0.5 && seg.cam !== "close" && !seg.camKeys) z *= 1 + 0.12 * (1 - eOutCubic(local / 0.5));
    for (const e of reacts) { const R_ = ANCH[e.who || "claude"]; if (!R_) continue; const d = g - e.t; if (d > -2.2 && d < 0) { const k = eInOut(prog(d, -2.2, 0)); z = lerp(z, 1.45, k); cx = lerp(cx, R_.cx, k); cy = lerp(cy, R_.head + 12, k); } else if (d >= 0 && d < 0.6) { z = lerp(1.45, 0.96, eOutCubic(prog(d, 0, 0.25))) * (d > 0.25 ? lerp(1, 1.04, prog(d, 0.25, 0.6)) : 1); } }
    const out = transOut(seg);
    if (out && out.type === "zoom" && g > out.at - 0.46) { const k = eInCubic(prog(g, out.at - 0.46, out.at)), za = seg.zoomAt || [fx, fy]; z = lerp(z, 6, k); cx = lerp(cx, za[0], k); cy = lerp(cy, za[1], k); }
    z *= 1 + 0.045 * kick(g) * LEVEL;
    const hw = 160 / z, hh = 90 / z;
    return { z, cx: clamp(cx, hw, 320 - hw), cy: clamp(cy, hh, 180 - hh) };
  }
  function present(cam, g, xOff) {
    const sh = shakeAt(g), gx = glitchX(g);
    CAM = { cx: cam.cx, cy: cam.cy, z: cam.z, sx: sh.x + gx + xOff, sy: sh.y };
    const rot = (sh.r + (isDown(g) ? (Math.floor(lastBeat(g).i / 4) % 2 ? 1 : -1) * 1.2 * kick(g) * LEVEL : 0)) * Math.PI / 180;
    for (const [o, src] of [[oS, bufBG], [oF, bufFG]]) {
      o.setTransform(1, 0, 0, 1, 0, 0); o.imageSmoothingEnabled = false;
      if (o === oS) { o.fillStyle = "#000"; o.fillRect(0, 0, W2, H2); } else o.clearRect(0, 0, W2, H2);
      o.translate(W2 / 2 + CAM.sx, H2 / 2 + CAM.sy); o.rotate(rot); o.scale(BASE * cam.z, BASE * cam.z); o.translate(-cam.cx, -cam.cy); o.drawImage(src, 0, 0);
    }
  }

  /* ================= desktop frame (scenes inside windows) ================= */
  const desk = $("desk"), WINS = {}, WINRECT = {};
  const DOCKR = [870, 990, 70, 44];
  SEGS.filter((s) => s.frame === "desktop").forEach((s) => (s.windows || []).forEach((w) => {
    if (WINS[w.id]) return;
    const el = document.createElement("div"); el.className = "win5";
    el.innerHTML = `<div class="tb"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i><span></span></div><canvas width="960" height="540"></canvas>`;
    desk.appendChild(el); WINS[w.id] = { el, ctx: el.querySelector("canvas").getContext("2d"), title: el.querySelector("span") };
  }));
  const lerpR = (a, c, k) => [lerp(a[0], c[0], k), lerp(a[1], c[1], k), lerp(a[2], c[2], k), lerp(a[3], c[3], k)];
  function renderDesktop(seg, g) {
    const sh = shakeAt(g); glitchX(g);
    desk.style.transform = `translate(${sh.x.toFixed(1)}px, ${sh.y.toFixed(1)}px) scale(${(1 + 0.02 * kick(g) * LEVEL).toFixed(4)})`;
    Object.values(WINS).forEach((w) => (w.el.style.opacity = 0));
    for (const w of seg.windows || []) {
      const W_ = WINS[w.id], show = w.show || [seg.t0, seg.t1];
      if (g < show[0] || g >= show[1] + 0.3) continue;
      let r = w.rect;
      if (w.rectTo && w.move) r = lerpR(w.rect, w.rectTo, eInOut(prog(g, w.move[0], w.move[1])));
      const open = eOutBack(prog(g, show[0], show[0] + 0.4)), sc = lerp(0.8, 1, open);
      r = [r[0] + r[2] * (1 - sc) / 2, r[1] + r[3] * (1 - sc) / 2, r[2] * sc, r[3] * sc];
      let op = Math.min(1, prog(g, show[0], show[0] + 0.25)) * (1 - prog(g, show[1], show[1] + 0.3));
      if (w.toDock != null) { const k = eInOut(prog(g, w.toDock, w.toDock + 0.5)); r = lerpR(r, DOCKR, k); op *= 1 - k; }
      WINRECT[w.id] = r;
      Object.assign(W_.el.style, { left: r[0] + "px", top: r[1] + "px", width: r[2] + "px", height: r[3] + "px", opacity: op.toFixed(3) });
      W_.title.textContent = w.title || "";
      if (op <= 0.01) continue;
      b = bg; bg.clearRect(0, 0, W, H); CUR.weather = w.weather; CUR.light = w.light == null ? 1 : w.light;
      const spot = (SCENES[w.scene] || SCENES.desk)(w.time, g); if (!spot.indoorClip && w.weather !== "none") weatherFx(w.weather, g);
      drawActors(w, g, spot);
      W_.ctx.imageSmoothingEnabled = false; W_.ctx.clearRect(0, 0, 960, 540); W_.ctx.drawImage(bufBG, 0, 0, 960, 540);
    }
  }

  /* ================= lyrics with interactions ================= */
  const LCFG = S.lines || {};
  const LINES = (window.MV_LYRICS || []).map((c) => ({ id: c.id, chars: Array.from(c.text), on: c.chars.map((x) => x - OFF) }))
    .filter((c) => c.on[c.on.length - 1] > 0 && c.on[0] < DUR).sort((a, c) => a.on[0] - c.on[0]);
  LINES.forEach((L, k) => {
    const cfg = Object.assign({}, LCFG[L.id] || {}), seg = segAt(L.on[0] + 0.01), next = LINES[k + 1];
    if (S.lineModes && S.lineModes[L.id]) cfg.mode = S.lineModes[L.id];
    L.mode = cfg.mode || (seg.frame === "desktop" ? "band" : seg.lyric) || "band";
    L.enter = cfg.enter || (L.mode === "band" && LEVEL >= 1 ? "pop" : "pop"); L.exit = cfg.exit || "smash"; L.cfg = cfg;
    L.out = cfg.out || Math.min(next ? next.on[0] - 0.08 : L.on[L.on.length - 1] + 0.9, L.on[L.on.length - 1] + 1.6, S.outro ? S.outro.t0 - 0.1 : DUR);
    const parent = L.mode === "behind" ? $("lyrBehind") : $("lyr");
    const make = (chars, cls) => { const w = document.createElement("div"); w.className = cls; const spans = chars.map((ch) => { const s = document.createElement("span"); s.className = "c"; s.textContent = ch; w.appendChild(s); return s; }); parent.appendChild(w); return { w, spans }; };
    if (L.mode === "say" || L.mode === "memory") { const m = make(L.chars, "bubble"); L.wrap = m.w; L.spans = m.spans; if (L.mode === "memory") L.wrap.style.fontSize = "38px"; }
    else if (L.mode === "split") { const h = Math.ceil(L.chars.length / 2); const a = make(L.chars.slice(0, h), "kline"), c = make(L.chars.slice(h), "kline"); L.parts = [a, c]; L.wrap = a.w; L.spans = a.spans.concat(c.spans); }
    else { const m = make(L.chars, "kline" + (L.mode === "type" ? " type" : "")); L.wrap = m.w; L.spans = m.spans; if (L.mode === "type") { const cur = document.createElement("i"); cur.className = "cur"; L.wrap.appendChild(cur); L.cur = cur; } }
  });
  const EXD = { smash: 0.16, shatter: 0.6, drift: 0.7, drip: 0.9, recede: 0.6, wash: 0.5, scatter: 0.45, blown: 0.7, dissolve: 0.8 };
  function place(el, x, y, fs, color) { el.style.left = x + "px"; el.style.top = y + "px"; if (fs) el.style.fontSize = fs + "px"; if (color) el.style.color = color; }
  function renderLyrics(g, desktopOn) {
    for (const L of LINES) {
      const t0 = L.enter === "spot" ? L.on[0] - 0.4 : L.on[0] - 0.05, exd = EXD[L.exit] || 0.16, on = g >= t0 && g < L.out + exd + 0.05;
      const els = L.parts ? L.parts.map((p) => p.w) : [L.wrap];
      if (!on) { els.forEach((e) => (e.style.opacity = 0)); continue; }
      const xk = prog(g, L.out, L.out + exd), kk = kick(g) * LEVEL, n = L.spans.length, mid = (n - 1) / 2, cfg = L.cfg;
      els.forEach((e) => (e.style.opacity = L.exit === "smash" ? 1 - xk : 1));
      let mode = L.mode;
      if (mode === "type" && !(LASTSPOT.typeBox)) mode = "band";
      if (mode === "type") {
        const [bx, by, bw, bh] = LASTSPOT.typeBox, p0 = toScreen(bx, by), p1 = toScreen(bx + bw, by + bh), hpx = p1.y - p0.y;
        place(L.wrap, p0.x + hpx * 0.3, p0.y, Math.round(hpx * 0.62), LASTSPOT.typeDark ? "#2a2235" : "#fbf8ff"); L.wrap.style.height = hpx + "px"; L.wrap.style.maxWidth = (p1.x - p0.x - hpx * 0.5) + "px"; L.wrap.style.transform = "none"; L.wrap.style.filter = "none";
        if (L.cur) L.cur.style.opacity = Math.floor(g / 0.3) % 2 === 0 || g < L.on[n - 1] + 0.2 ? 1 : 0;
      } else if (mode === "split") {
        const pos = cfg.pos || [[520, 690], [1400, 690]];
        place(L.parts[0].w, pos[0][0], pos[0][1], cfg.size || 72); place(L.parts[1].w, pos[1][0], pos[1][1], cfg.size || 72);
        L.parts.forEach((p) => (p.w.style.transform = `translate(-50%, -50%) scale(${(1 + kk * 0.05).toFixed(3)})`));
      } else if (mode === "say" || mode === "memory") {
        let ax = 960, ay = 400;
        if (mode === "say") { const A = ANCH[cfg.who || "claude"]; if (A) { const p = toScreen(A.cx, A.head - 4); ax = p.x; ay = p.y - 50; } }
        else if (MEMPOS) { const p = toScreen(MEMPOS[0], MEMPOS[1]); ax = p.x; ay = p.y; }
        place(L.wrap, ax, ay); const k = eOutBack(prog(g, L.on[0] - 0.05, L.on[0] + 0.2));
        L.wrap.style.transform = `translate(-50%, ${mode === "memory" ? "10%" : "-100%"}) scale(${((L.exit === "scatter" ? 1 + xk * 0.5 : 1) * k).toFixed(3)})`;
        L.wrap.style.opacity = (L.exit === "scatter" ? 1 - xk : Math.min(1, k * 1.2) * (1 - prog(g, L.out, L.out + 0.2))).toFixed(3);
        L.wrap.style.background = L.exit === "scatter" && xk > 0 ? "transparent" : "";
      } else {
        const big = mode === "behind", glass = mode === "glass";
        let ax = 960, ay = cfg.y || (desktopOn ? 905 : 955);
        if (big) ay = cfg.y || 760;
        if (glass) { const r = WINRECT[cfg.win] || [200, 70, 1520, 890], at = cfg.at || [225, 64]; ax = r[0] + at[0] * (r[2] / 320); ay = r[1] + 40 + at[1] * ((r[3] - 40) / 180); }
        place(L.wrap, ax, ay, big ? Math.min(200, Math.floor(1760 / n)) : glass ? (cfg.size || 66) : (cfg.size || 84), glass ? "rgba(255,255,255,0.78)" : big ? "rgba(255,240,248,0.92)" : "#fbf8ff");
        let tr = `translate(-50%, -50%) scale(${(1 + (L.exit === "smash" ? xk * 0.45 : 0) + kk * 0.06).toFixed(3)}) skewX(${((isDown(g) ? -1 : 1) * kk * 4).toFixed(2)}deg)`;
        if (L.exit === "recede") tr = `translate(-50%, -50%) translateY(${(-160 * xk).toFixed(1)}px) scale(${(1 - 0.7 * xk).toFixed(3)})`;
        L.wrap.style.transform = tr;
        L.wrap.style.filter = L.exit === "smash" && xk > 0 ? `blur(${(xk * 14).toFixed(1)}px)` : glass ? "blur(0.6px)" : "none";
        if (L.exit === "recede" || L.exit === "wash" || L.exit === "dissolve") L.wrap.style.opacity = (1 - xk).toFixed(3);
      }
      L.spans.forEach((sp, i) => {
        const t = L.on[i], k = prog(g, t, t + 0.12);
        let x = 0, y = 0, s = 1, r = 0, op = k, blur = 0, sh = 12 * (1 - prog(g, t, t + 0.3)) * Math.max(0.3, LEVEL), extra = "";
        switch (L.enter) {
          case "pop": y = (1 - eOutCubic(k)) * -30; s = lerp(2.2, 1, eOutCubic(k)); r = (1 - k) * (i % 2 ? 12 : -12); break;
          case "bounce": { const kb = prog(g, t, t + 0.45); y = -300 * (1 - eOutBounce(kb)); op = g >= t ? 1 : 0; r = (1 - kb) * (i % 2 ? 20 : -20); break; }
          case "spot": op = g >= t ? 1 : 0.18; s = g >= t ? 1 + 0.25 * (1 - prog(g, t, t + 0.3)) : 1; if (g >= t) extra = ", 0 0 30px rgba(255,240,180,0.95)"; break;
          case "sparkle": y = (1 - eOutCubic(k)) * -30; s = lerp(2, 1, eOutCubic(k)); if (g >= t && hash(Math.floor(g * 12) + i * 3) > 0.45) extra = ", 0 0 18px #ff8fc6, 0 0 36px #ffd6e8"; break;
          case "swipe": { const ks = prog(g, t, t + 0.25); x = (1 - eOutCubic(ks)) * 260; y = (1 - eOutCubic(ks)) * -80; r = (1 - ks) * 30; op = ks; break; }
          case "lift": { const kl = prog(g, t, t + 0.35); y = (1 - eOutBack(kl)) * 90 - Math.sin(g * 3 + i) * 4 * kl; op = kl; break; }
        }
        if (mode === "glass") { op = 0.85 * prog(g, t, t + 0.45); blur = 6 * (1 - prog(g, t, t + 0.5)); sh = 0; y = Math.sin(g * 1.5 + i) * 2; }
        if (mode === "type" || mode === "say" || mode === "memory") { s = lerp(1.6, 1, eOutBack(k)); y = 0; r = 0; sh = 0; x = 0; }
        if (xk > 0) switch (L.exit) {
          case "shatter": x += (i - mid) * 70 * xk; y += 320 * xk * xk - 60 * xk; r += (i % 2 ? 1 : -1) * 140 * xk; op *= 1 - xk; break;
          case "drift": x += (cfg.dir || -1) * (260 + i * 40) * eInCubic(xk); op *= 1 - xk; break;
          case "drip": { const kd = prog(g, L.out + i * 0.06, L.out + i * 0.06 + 0.45); y += 360 * kd * kd; op *= 1 - kd; if (kd > 0) extra += ", 0 0 12px #8fd0ff"; break; }
          case "wash": y += 140 * xk + i * 6 * xk; blur = 6 * xk; break;
          case "scatter": { const ang = (i / n) * Math.PI * 2; x += Math.cos(ang) * 220 * xk; y += Math.sin(ang) * 220 * xk; s *= 1 + xk; op *= 1 - xk; break; }
          case "blown": { const kb = prog(g, L.out + (n - 1 - i) * 0.05, L.out + (n - 1 - i) * 0.05 + 0.4); x += (cfg.dir || -1) * 700 * eInCubic(kb); y += -50 * Math.sin(kb * 3); r += -120 * kb; op *= 1 - kb; break; }
          case "dissolve": y += -50 * xk - i * 4 * xk; blur = 10 * xk; s *= 1 + 0.4 * xk; break;
        }
        sp.style.opacity = op.toFixed(3);
        sp.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${s.toFixed(3)}) rotate(${r.toFixed(1)}deg)`;
        sp.style.filter = blur > 0.2 ? `blur(${blur.toFixed(1)}px)` : "none";
        sp.style.textShadow = (mode === "say" || mode === "memory" || mode === "type") ? "none" : mode === "glass" ? "0 0 12px rgba(255,255,255,0.6)"
          : `${(-sh).toFixed(1)}px 0 rgba(255,50,110,0.85), ${sh.toFixed(1)}px 0 rgba(50,215,255,0.85), 0 6px 28px rgba(8,6,25,0.9)${extra}`;
      });
    }
  }

  /* ================= screen-space effects ================= */
  function envMax(list, g) { let v = 0; for (const e of list) { const d = g - e.t0; if (d >= 0 && d < e.dur) v = Math.max(v, (e.a == null ? 1 : e.a) * Math.pow(1 - d / e.dur, 2)); } return v; }
  function shakeAt(g) { let x = 0, y = 0, r = 0; for (const s of shakes) { const d = g - s.t0; if (d < 0 || d > s.dur) continue; const a = s.amp * Math.pow(1 - d / s.dur, 2) * Math.max(0.4, LEVEL); x += a * Math.sin(d * 90 + s.t0); y += a * Math.cos(d * 77 + s.t0 * 3); if (s.rot) r += s.rot * Math.exp(-5 * d) * Math.sin(d * 60); } return { x, y, r }; }
  const GB = []; for (let i = 0; i < 6; i++) { const d = document.createElement("div"); d.className = "gbar"; $("gbars").appendChild(d); GB.push(d); }
  function glitchX(g) {
    const on = glitches.some((e) => g >= e.t0 && g < e.t0 + e.dur), step = Math.floor(g * 30);
    $("scan").style.opacity = on ? 0.55 : (0.08 * kick(g) * LEVEL).toFixed(3);
    GB.forEach((bar, k) => { if (!on) { bar.style.opacity = 0; return; } bar.style.opacity = 1; bar.style.top = Math.floor(hash(step * 13 + k) * 1040) + "px"; bar.style.height = Math.floor(8 + hash(step * 7 + k) * 70) + "px"; bar.style.background = k % 2 ? "rgba(255,40,120,0.5)" : "rgba(40,220,255,0.5)"; bar.style.transform = `translateX(${(hash(step * 5 + k) - 0.5) * 240}px)`; });
    return on ? (hash(step * 3) - 0.5) * 60 : 0;
  }
  function renderTint(g, clubby) {
    const { i } = lastBeat(g), kk = kick(g, 0.28);
    let a = kk * (i % 4 === 0 ? 0.17 : 0.09) * LEVEL * (clubby ? 1.5 : 1), col = i % 2 ? "#3dd8ff" : "#ff3d8b";
    for (const e of reacts) { const d = g - e.t; if (d >= 0 && d < 0.45) { const v = 0.35 * Math.pow(1 - d / 0.45, 2); if (v > a) { a = v; col = "#ff3d8b"; } } }
    for (const x of allBeats) if (x.do === "heart-crack") { const d = g - x.t; if (d >= 0 && d < 0.5) { const v = 0.4 * Math.pow(1 - d / 0.5, 2); if (v > a) { a = v; col = "#ff2a4a"; } } }
    $("tint").style.background = col; $("tint").style.opacity = a.toFixed(3);
  }
  const sp2d = $("speed").getContext("2d");
  const QM = [[-170, -150], [120, -210], [-40, -280], [210, -80], [-250, -40]].map(([dx, dy]) => { const q = document.createElement("div"); q.className = "qm"; q.textContent = "?"; $("qms").appendChild(q); return { el: q, dx, dy }; });
  function renderReaction(g) {
    sp2d.clearRect(0, 0, W2, H2); QM.forEach((q) => (q.el.style.opacity = 0));
    for (const e of reacts) {
      const d = g - e.t, A = ANCH[e.who || "claude"]; if (d < 0 || d > 1.6 || !A) continue;
      const hs = toScreen(A.cx, A.head + 10);
      if (d < 0.9) { const a = d < 0.65 ? 1 : 1 - (d - 0.65) / 0.25, step = Math.floor(g * 10); sp2d.fillStyle = `rgba(255,255,255,${(0.85 * a).toFixed(3)})`;
        for (let j = 0; j < 80; j++) { const ang = ((j + hash(step * 100 + j) * 0.8) / 80) * Math.PI * 2, r0 = 230 + hash(step * 37 + j * 3) * 220, w = 3 + hash(step * 11 + j) * 12, ca = Math.cos(ang), sa = Math.sin(ang);
          sp2d.beginPath(); sp2d.moveTo(hs.x + ca * r0, hs.y + sa * r0); sp2d.lineTo(hs.x + ca * 2400 - sa * w, hs.y + sa * 2400 + ca * w); sp2d.lineTo(hs.x + ca * 2400 + sa * w, hs.y + sa * 2400 - ca * w); sp2d.closePath(); sp2d.fill(); } }
      const fade = 1 - prog(d, 1.2, 1.55);
      QM.forEach((q, i) => { const s0 = 0.05 + 0.1 * i, k = prog(d, s0, s0 + 0.2); q.el.style.opacity = (d < s0 ? 0 : fade).toFixed(3); q.el.style.transform = `translate(${hs.x + q.dx - 24}px, ${hs.y + q.dy - 50}px) scale(${eOutBack(k).toFixed(3)}) rotate(${(9 * Math.sin(g * 6 + i * 1.7)).toFixed(1)}deg)`; });
    }
  }
  const fx = $("fx").getContext("2d");
  let IRIS_AT = { x: 960, y: 540 };
  function renderFx(g) {
    fx.setTransform(1, 0, 0, 1, 0, 0); fx.clearRect(0, 0, W2, H2);
    const C = 60;
    for (const w of WIPES) {
      if (g < w.cover - 0.1 || g > w.reveal + 0.9) continue;
      for (let j = 0; j < 18; j++) for (let i = 0; i < 32; i++) {
        const cx = i * C + C / 2, cy = j * C + C / 2, dist = (w.fromLeft ? cx + cy : W2 - cx + cy) / 3000;
        const s0 = w.cover + dist * 0.4 + hash(i * 31 + j * 7) * 0.1, r0 = w.reveal + dist * 0.4 + hash(i * 17 + j * 13 + 5) * 0.1;
        const pc = prog(g, s0, s0 + 0.16), pr = prog(g, r0, r0 + 0.16);
        const size = g >= s0 ? C * (pr > 0 ? 1.05 * (1 - eInOut(pr)) : lerp(0.25, 1.05, eOutBack(pc))) : 0;
        if (size > 0.5) { fx.fillStyle = w.cols[(i + j) % 2]; fx.fillRect(cx - size / 2, cy - size / 2, size, size); }
        if ((g > s0 - 0.08 && pc < 1) || (pr >= 1 && g < r0 + 0.3)) { fx.strokeStyle = w.line; fx.lineWidth = 3; fx.strokeRect(i * C + 4, j * C + 4, C - 8, C - 8); }
      }
    }
    for (const t of TRANS) {
      if (t.type === "train" && g > t.at - 0.42 && g < t.at + 0.33) {
        const k = prog(g, t.at - 0.42, t.at + 0.33), x = lerp(W2 + 50, -4200, eInOut(k));
        fx.fillStyle = "#d8dde6"; fx.fillRect(x, 120, 4000, 860); fx.fillStyle = "#ff7a5c"; fx.fillRect(x, 820, 4000, 40);
        fx.fillStyle = "#ffcf9a"; for (let n = 0; n < 24; n++) fx.fillRect(x + 80 + n * 165, 260, 120, 160);
        fx.fillStyle = "rgba(255,255,255,0.35)"; for (let n = 0; n < 14; n++) fx.fillRect(x + 4000 + n * 60, 140 + n * 55, 500 - n * 30, 6);
      }
      if (t.type === "iris" && g > t.at - 0.6 && g < t.at + 0.35) {
        const closing = g < t.at, r = closing ? lerp(1300, 0, eInCubic(prog(g, t.at - 0.6, t.at - 0.04))) : lerp(0, 1400, eOutCubic(prog(g, t.at, t.at + 0.35)));
        const c = closing ? IRIS_AT : { x: 960, y: 540 };
        fx.fillStyle = "#000"; fx.beginPath(); fx.rect(0, 0, W2, H2); fx.arc(c.x, c.y, Math.max(0.1, r), 0, Math.PI * 2, true); fx.fill("evenodd");
        if (r > 1) { fx.strokeStyle = "#ff9cc4"; fx.lineWidth = 6; fx.beginPath(); fx.arc(c.x, c.y, r, 0, Math.PI * 2); fx.stroke(); }
      }
    }
  }
  // free-text labels pinned to scene coordinates (e.g. a call log heading)
  const LABELS = []; for (let i = 0; i < 6; i++) { const d = document.createElement("div"); d.className = "label"; $("labels").appendChild(d); LABELS.push(d); }
  function renderLabels(seg, g) {
    LABELS.forEach((l) => (l.style.opacity = 0));
    (seg.labels || []).forEach((lb, i) => { if (!LABELS[i] || (lb.show && (g < lb.show[0] || g >= lb.show[1]))) return; const p = toScreen(lb.at[0], lb.at[1]), l = LABELS[i]; l.textContent = lb.text; l.style.opacity = 1; l.style.color = lb.color || "#5b5270"; l.style.fontSize = Math.round((lb.size || 5.5) * BASE * CAM.z) + "px"; l.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`; });
  }

  /* ---------------- looks, character sprite, title ---------------- */
  const look = S.look || "base";
  const LOOKF = look === "neon" ? "saturate(1.6) contrast(1.15) hue-rotate(-8deg)" : look === "classic" ? "sepia(0.45) saturate(0.7) contrast(1.05) brightness(1.06)" : look === "retro" ? "sepia(0.55) saturate(0.85) contrast(0.95) brightness(1.03)" : "";
  $("lookfx").className = "lookfx " + look;
  const spriteReady = new Promise((res) => {
    if (!S.character) return res();
    const im = new Image(); im.onload = () => { const c = document.createElement("canvas"); c.width = im.width; c.height = im.height; c.getContext("2d").drawImage(im, 0, 0); CUR.sprite = c; res(); }; im.onerror = () => res(); im.src = S.character;
  });
  $("ttl").textContent = S.title || "";
  function renderTitle(g) {
    if (!S.outro) return;
    const t0 = S.outro.t0, k = prog(g, t0, t0 + 0.14);
    $("title").style.opacity = g < t0 ? 0 : 1;
    $("ttl").style.transform = `scale(${(lerp(2.2, 1, eOutCubic(k)) * (1 + kick(g) * 0.05 * LEVEL)).toFixed(3)})`;
    $("ttl").style.filter = k < 1 ? `blur(${((1 - k) * 14).toFixed(1)}px)` : "none";
    const rk = eOutCubic(prog(g, t0, t0 + 0.5));
    $("ring").style.transform = `scale(${lerp(0.4, 1, rk).toFixed(3)}, ${(0.26 * lerp(0.4, 1, rk)).toFixed(3)}) rotate(${(g * 40).toFixed(1)}deg)`;
    $("sub").style.opacity = prog(g, t0 + 0.4, t0 + 0.7).toFixed(3);
  }

  /* ================= frame ================= */
  function render(g) {
    const seg = segAt(g), desktopOn = seg.frame === "desktop";
    $("stage").style.opacity = desktopOn ? 0 : 1; $("front").style.opacity = desktopOn ? 0 : 1; desk.style.opacity = desktopOn ? 1 : 0;
    if (desktopOn) { renderDesktop(seg, g); LABELS.forEach((l) => (l.style.opacity = 0)); sp2d.clearRect(0, 0, W2, H2); QM.forEach((q) => (q.el.style.opacity = 0)); }
    else {
      CUR.weather = seg.weather || "none";
      const lo = beatsOf(seg, undefined, "lights-off").concat(beatsOf(seg, "claude", "lights-off"))[0];
      CUR.light = (seg.light == null ? 1 : seg.light) * (lo ? 1 - 0.85 * prog(g, lo.t, lo.t + (lo.dur || 1.5)) : 1);
      b = bg; bg.clearRect(0, 0, W, H);
      const spot = (SCENES[seg.scene] || SCENES.desk)(seg.time || "night", g); LASTSPOT = spot;
      if (!spot.indoorClip) weatherFx(CUR.weather, g);
      b = fg; fg.clearRect(0, 0, W, H);
      drawActors(seg, g, spot);
      const cam = cameraFor(seg, g);
      let xOff = 0, whipBlur = 0;
      const ti = transIn(seg), to = transOut(seg);
      if (to && to.type === "whip" && g > to.at - 0.26) { xOff = -1920 * eInCubic(prog(g, to.at - 0.26, to.at)); whipBlur = 24 * prog(g, to.at - 0.26, to.at); }
      if (ti && ti.type === "whip" && g < ti.at + 0.21) { xOff = 1920 * (1 - eOutCubic(prog(g, ti.at, ti.at + 0.21))); whipBlur = 24 * (1 - prog(g, ti.at, ti.at + 0.21)); }
      present(cam, g, xOff);
      const F = ANCH[seg.focus || "claude"]; if (F) IRIS_AT = toScreen(F.cx, F.head + 12);
      const kk = kick(g) * LEVEL, ab = (isDown(g) ? 12 : 5) * kk, f = [];
      if (LOOKF) f.push(LOOKF);
      const blur = Math.max(envMax([{ t0: 0, dur: 0.5, a: 12 }].concat(WIPES.map((w) => ({ t0: w.reveal, dur: 0.35, a: 8 }))), g), whipBlur);
      if (blur > 0.3) f.push(`blur(${blur.toFixed(2)}px)`);
      if (ab > 0.6) f.push(`drop-shadow(${ab.toFixed(1)}px 0 0 rgba(255,40,110,0.6)) drop-shadow(${(-ab).toFixed(1)}px 0 0 rgba(40,220,255,0.6))`);
      $("stage").style.filter = f.join(" ") || "none";
      $("front").style.filter = [LOOKF, whipBlur > 0.5 ? `blur(${whipBlur.toFixed(1)}px)` : ""].join(" ").trim() || "none";
      renderLabels(seg, g);
      renderReaction(g);
    }
    renderTint(g, !!(LASTSPOT && LASTSPOT.club) && !desktopOn);
    renderLyrics(g, desktopOn);
    renderFx(g);
    renderTitle(g);
    $("flash").style.opacity = envMax(flashes, g).toFixed(3);
    $("fade").style.opacity = prog(g, DUR - 0.6, DUR).toFixed(3);
  }

  const proxy = { t: 0 };
  const tl = gsap.timeline({ paused: true });
  tl.to(proxy, { t: DUR, duration: DUR, ease: "none", onUpdate: () => render(proxy.t) }, 0);
  render(0);
  window.__mvReady = spriteReady.then(() => render(proxy.t));
  return tl;
};
