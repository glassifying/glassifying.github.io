/* =====================================================================
   BM CLIENT for Blueberry Playground  -  Beech Marten Council
   Build + test tools. Only shows info or works on YOUR OWN builds.
   Does not change game rules, time, ranges, or other players' stuff.
   ===================================================================== */
(function () {
  'use strict';
  var VERSION = '1.0';
  var BASE = (function () {
    try { var s = document.currentScript && document.currentScript.src; if (s) return s.replace(/[^\/]*$/, ''); } catch (e) {}
    return window.BMC_BASE || '';
  })();

  function findGame() {
    if (window.bp && window.bp.game) return window;
    var fs = document.querySelectorAll('iframe');
    for (var i = 0; i < fs.length; i++) {
      try { var w = fs[i].contentWindow; if (w && w.bp && w.bp.game) return w; } catch (e) {}
    }
    return null;
  }

  var tries = 0;
  (function wait() {
    var W = findGame();
    if (W) {
      if (W.BMC) { W.BMC.toggle(); return; }
      if (W.BMC_BUILDS || window.BMC_BUILDS) return start(W);
      // load the build library next to client.js
      var s = W.document.createElement('script');
      s.src = BASE + 'builds.js';
      s.onload = function () { start(W); };
      s.onerror = function () { start(W); };
      W.document.head.appendChild(s);
      return;
    }
    if (tries++ === 0) note('BM Client: waiting for the game... press Play first.');
    if (tries < 240) setTimeout(wait, 500); else note('BM Client: could not find Blueberry Playground on this page.');
  })();

  function note(msg) {
    try {
      var d = document.createElement('div');
      d.textContent = msg;
      d.style.cssText = 'position:fixed;z-index:2147483647;left:50%;top:12px;transform:translateX(-50%);background:#121212;color:#e0a03a;font:13px monospace;padding:8px 14px;border:2px solid #e0a03a;border-radius:6px';
      document.body.appendChild(d); setTimeout(function () { d.remove(); }, 4000);
    } catch (e) {}
  }

  /* ================================================================= */
  function start(W) {
    var D = W.document, bp = W.bp, g = bp.game, ctl = bp.controls, ui = bp.ui, C = g.connections;
    var BUILDS = W.BMC_BUILDS || window.BMC_BUILDS || [];
    var LOGO = W.BMC_LOGO || window.BMC_LOGO || '';
    var U = 32; // px per world unit

    /* ---------- settings (saved per browser) ---------- */
    var S = { dmg: true, hover: true, aim: false, wires: false, sensors: false, jiggle: true, com: false, lag: true };
    try { var saved = JSON.parse(W.localStorage.getItem('bmc.settings') || '{}'); for (var k in saved) if (k in S) S[k] = saved[k]; } catch (e) {}
    function saveS() { try { W.localStorage.setItem('bmc.settings', JSON.stringify(S)); } catch (e) {} }

    /* ---------- helpers ---------- */
    function isMP() { return !!g.net; }
    function alive(e) { return e && !e.destroyed && g.entities.indexOf(e) >= 0; }
    function conns() { return C.list || []; }
    function R() { return g.renderer; }
    function toast(m) { try { ui.toast('BM: ' + m); } catch (e) { note(m); } }
    function partHp(p) { return p.destroyed ? 0 : (typeof p.hp === 'number' && isFinite(p.hp) ? p.hp : null); }
    function itemOf(id) { try { return bp.getItem(id); } catch (e) { return null; } }

    function groupOf(seed) {
      var set = new Set(), q = [];
      seed.forEach(function (e) { if (alive(e) && !set.has(e)) { set.add(e); q.push(e); } });
      var cl = conns();
      var adj = new Map();
      cl.forEach(function (c) {
        var a = c.a && c.a.entity, b = c.b && c.b.entity;
        if (!a || !b) return;
        if (!adj.has(a)) adj.set(a, []); if (!adj.has(b)) adj.set(b, []);
        adj.get(a).push(b); adj.get(b).push(a);
      });
      while (q.length) {
        var e = q.pop(); var n = adj.get(e) || [];
        for (var i = 0; i < n.length; i++) if (!set.has(n[i]) && alive(n[i])) { set.add(n[i]); q.push(n[i]); }
        // things a character is holding count too
        try { (e.attachedEntities ? e.attachedEntities() : []).forEach(function (x) { if (!set.has(x) && alive(x)) { set.add(x); q.push(x); } }); } catch (er) {}
      }
      return set;
    }

    function snapOf(ents) {
      var ids = new Set(); ents.forEach(function (e) { ids.add(e.id); });
      var full = ctl.history.capture('bmc').snap;
      var map = {}, out = { entities: [], connections: [] };
      full.entities.forEach(function (e, i) { if (ids.has(e.uid)) { map[i] = out.entities.length; var c = JSON.parse(JSON.stringify(e)); delete c.uid; out.entities.push(c); } });
      full.connections.forEach(function (c) {
        var a = c.a, b = c.b;
        if (!a || map[a[0]] === undefined) return;
        if (b && map[b[0]] === undefined) return;
        var n = JSON.parse(JSON.stringify(c)); n.a = [map[a[0]], a[1]]; if (b) n.b = [map[b[0]], b[1]];
        out.connections.push(n);
      });
      return out;
    }

    function arm(name, snap) {
      var def = ui.contraptions.defOf({ id: 'bmc' + Date.now(), name: name, snap: JSON.parse(JSON.stringify(snap)), thumb: LOGO });
      ctl.armed = def;
      try { ctl.setTool && ctl.setTool('drag'); } catch (e) {}
      ctl.armed = def;
      toast(name + ' ready - click where you want it (Esc to cancel)');
    }

    /* ================= TRACKED BUILD + CHECKPOINTS ================= */
    var tracked = new Set(), checkpoints = [], lastSig = '', lastHp = 0, trackName = 'My build';
    function hpSum(set) { var s = 0; set.forEach(function (e) { e.parts.forEach(function (p) { var h = partHp(p); if (h !== null) s += Math.min(h, p.maxHp || h); }); }); return s; }
    function sigOf(set) {
      var ids = []; set.forEach(function (e) { ids.push(e.id); }); ids.sort();
      var n = 0; conns().forEach(function (c) { if (c.a && set.has(c.a.entity)) n++; });
      return ids.join(',') + '|' + n;
    }
    function trackFromSelection() {
      var seed = [];
      if (ctl.selection && ctl.selection.size) ctl.selection.forEach(function (e) { seed.push(e); });
      else { var p = g.pick(ctl.wx, ctl.wy, 0.3); if (p) seed.push(p.entity); }
      if (!seed.length) { toast('Select your build (or hover it) first'); return; }
      tracked = groupOf(seed);
      lastSig = ''; checkpoint(true);
      toast('Tracking ' + tracked.size + ' parts as your build');
      refresh();
    }
    function cleanTracked() {
      var live = []; tracked.forEach(function (e) { if (alive(e)) live.push(e); });
      if (!live.length) return;
      tracked = groupOf(live); // picks up anything you welded or wired on
    }
    function checkpoint(force) {
      if (!tracked.size) { if (force) toast('Track a build first'); return; }
      var sig = sigOf(tracked), hp = hpSum(tracked);
      if (!force) {
        if (sig === lastSig) { lastHp = Math.max(lastHp, hp); return; }
        if (hp < lastHp * 0.97) return; // it is getting damaged, not built: keep the last good save
      }
      checkpoints.unshift({ t: Date.now(), snap: snapOf(tracked), n: tracked.size });
      if (checkpoints.length > 8) checkpoints.length = 8;
      lastSig = sig; lastHp = hp;
      try { W.localStorage.setItem('bmc.checkpoints', JSON.stringify(checkpoints.slice(0, 3))); } catch (e) {}
      refresh();
    }
    try { checkpoints = JSON.parse(W.localStorage.getItem('bmc.checkpoints') || '[]'); } catch (e) { checkpoints = []; }
    function restore(i) {
      var c = checkpoints[i || 0]; if (!c) { toast('No checkpoint yet'); return; }
      arm(trackName + ' (checkpoint)', c.snap);
    }

    /* ================= LEGALITY CHECK (Ridit's rules) ================= */
    var OBJ_OK = { 'crate': 1, 'table': 1, 'chair': 1, 'plank': 1, 'glass': 1, 'balloon': 1, 'glass-tank': 1, 'buoyancy-tube': 1, 'big-balloon': 1 };
    var CAT_OK = { 'Characters': 1, 'Weapons': 1, 'Melee': 1, 'Machinery': 1, 'Vehicles': 1, 'Tools': 1 };
    function legality() {
      cleanTracked();
      var set = tracked.size ? tracked : null;
      if (!set) { set = new Set(); if (!isMP()) g.entities.forEach(function (e) { set.add(e); }); }
      if (!set.size) { toast('Track your build first'); return; }
      var bad = {}, ask = {}, edited = 0;
      set.forEach(function (e) {
        var it = itemOf(e.def.id) || e.def, cat = it.category, nm = it.name || e.def.id;
        if (e.def.id === 'nuke') bad[nm] = 'the Thermonuclear Bomb (nuke) is banned';
        else if (cat === 'Objects') { if (!OBJ_OK[e.def.id]) bad[nm] = 'not an approved material'; }
        else if (cat === 'Explosives') { }
        else if (cat === 'Medical') ask[nm] = 'Medical is not on the list';
        else if (cat === 'Aircraft' || cat === 'Flight') ask[nm] = cat + ' is not on the list (maybe counts as vehicles?)';
        else if (!CAT_OK[cat] && cat) ask[nm] = cat + ' is not on the list';
        e.parts.forEach(function (p) { if (typeof p.hp === 'number' && p.maxHp && p.hp > p.maxHp * 1.01) edited++; });
      });
      var lines = [];
      Object.keys(bad).forEach(function (k) { lines.push('ILLEGAL: ' + k + ' - ' + bad[k]); });
      if (edited) lines.push('ILLEGAL: ' + edited + ' part(s) have edited health above max');
      Object.keys(ask).forEach(function (k) { lines.push('ASK RIDIT: ' + k + ' - ' + ask[k]); });
      var stats = lagStats();
      if (stats.bodies > 600) lines.push('LAG: ' + stats.bodies + ' bodies on the map - might count as "too laggy"');
      if (!lines.length) lines.push('LEGAL: everything in ' + (tracked.size ? 'your build' : 'the map') + ' is on the approved list.');
      showReport('Tournament check', lines);
    }

    /* ================= LAG METER ================= */
    var fpsS = { t: performance.now(), f: 0, fps: 0 };
    function lagStats() {
      var bodies = 0; try { bodies = g.physics.world.bodies.len(); } catch (e) { g.entities.forEach(function (x) { bodies += x.parts.length; }); }
      return { fps: fpsS.fps, step: g.stepMs || 0, ents: g.entities.length, bodies: bodies };
    }

    /* ================= TEST RANGE (single player only) ================= */
    var testStuff = [];
    function needSP() { if (isMP()) { toast('Test range is off in multiplayer (it would spawn into the shared world)'); return false; } return true; }
    function spawnDummy() {
      if (!needSP()) return;
      var h = bp.kit.spawn('human', ctl.wx, ctl.wy); h.setFrozen(true); testStuff.push(h);
      toast('Frozen dummy placed at mouse');
    }
    function spawnPlane() {
      if (!needSP()) return;
      var x = ctl.wx, y = ctl.wy, k = bp.kit;
      var deck = k.spawn('crate', x, y, { config: { w: 96, h: 16 } }); var pil = k.spawn('human', x, y + 1.1);
      var foot = pil.parts.filter(function (p) { return /Foot/.test(p.name); })[0] || pil.parts[0];
      C.create('weld', foot, { x: x, y: y + 0.25 }, deck.parts[0], { x: x, y: y + 0.25 });
      var bs = [deck, pil];
      [-1.4, 1.4].forEach(function (dx) { var b = k.spawn('big-balloon', x + dx, y + 3.5); C.create('rope', b.parts[0], { x: x + dx, y: y + 3.5 }, deck.parts[0], { x: x + dx * 0.6, y: y }, 3.2); bs.push(b); });
      testStuff = testStuff.concat(bs);
      toast('Balloon plane launched at mouse');
    }
    function clearTest() {
      var n = 0; testStuff.forEach(function (e) { if (alive(e)) { try { g.remove(e); n++; } catch (er) {} } }); testStuff = [];
      toast('Removed ' + n + ' test objects (only ones the test range made)');
    }

    /* ================= RULER ================= */
    var ruler = { a: null, b: null };
    function rulerKey() {
      var p = { x: ctl.wx, y: ctl.wy };
      if (!ruler.a || ruler.b) { ruler.a = p; ruler.b = null; } else ruler.b = p;
    }

    /* ================= REPLAY (last 5 s, ghost view only) ================= */
    var rec = [], REC_S = 5, replay = null, recT = 0;
    function record(now) {
      if (replay) return;
      if (now - recT < 33) return; recT = now;
      var fr = [];
      g.entities.forEach(function (e) { e.parts.forEach(function (p) { if (!p.destroyed) fr.push(p.x, p.y, p.a, (p.w || 8) / U, (p.h || 8) / U); }); });
      rec.push({ t: now, f: fr });
      while (rec.length && now - rec[0].t > REC_S * 1000) rec.shift();
    }
    function startReplay() { if (rec.length < 5) { toast('Nothing recorded yet'); return; } replay = { frames: rec.slice(), i: 0, start: performance.now(), speed: 0.25 }; rec = []; }

    /* ================= OVERLAY CANVAS ================= */
    var cv = D.createElement('canvas');
    cv.id = 'bmc-overlay';
    cv.style.cssText = 'position:fixed;pointer-events:none;left:0;top:0';
    // sit right above the game picture but under the game's own menus
    try { var gc = R().canvas; gc.parentNode.insertBefore(cv, gc.nextSibling); } catch (e) { cv.style.zIndex = 9998; D.body.appendChild(cv); }
    var cx = cv.getContext('2d');
    function sizeCanvas() {
      var r = R().canvas.getBoundingClientRect(), dpr = W.devicePixelRatio || 1;
      cv.style.left = r.left + 'px'; cv.style.top = r.top + 'px'; cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px';
      var w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return r;
    }
    function ws(x, y) { return R().worldToScreen(x, y); }
    function zoom() { return R().zoom; }

    var hpPrev = new WeakMap(), floats = [], dmgAcc = new Map();
    function trackDamage(now) {
      g.entities.forEach(function (e) {
        e.parts.forEach(function (p) {
          var h = partHp(p); if (h === null) return;
          var prev = hpPrev.get(p);
          hpPrev.set(p, h);
          if (prev === undefined || h >= prev) return;
          var d = prev - h; var a = dmgAcc.get(p);
          if (a && now - a.t < 250) { a.v += d; a.t = now; a.x = p.x; a.y = p.y; }
          else { a = { v: d, t: now, x: p.x, y: p.y, born: now }; dmgAcc.set(p, a); floats.push(a); }
        });
      });
      floats = floats.filter(function (f) { return now - f.born < 1800; });
    }

    function guns() {
      var out = [], mine = isMP() ? tracked : null;
      g.entities.forEach(function (e) { if (e.gun && e.forward && (!mine || mine.has(e))) out.push(e); });
      return out;
    }

    function drawBoxPart(p, stroke, fill) {
      var c = ws(p.x, p.y), z = zoom(), w = (p.w || 8) / U * z, h = (p.h || 8) / U * z;
      cx.save(); cx.translate(c.x, c.y); cx.rotate(-p.a);
      if (fill) { cx.fillStyle = fill; cx.fillRect(-w / 2, -h / 2, w, h); }
      if (stroke) { cx.strokeStyle = stroke; cx.lineWidth = 2; cx.strokeRect(-w / 2, -h / 2, w, h); }
      cx.restore();
    }

    var jiggleCount = 0;
    function frame(now) {
      try {
        fpsS.f++; if (now - fpsS.t > 500) { fpsS.fps = Math.round(fpsS.f * 1000 / (now - fpsS.t)); fpsS.f = 0; fpsS.t = now; }
        if (tracked.size) cleanTracked();
        record(now);
        trackDamage(now);
        var r = sizeCanvas(); cx.clearRect(0, 0, r.width, r.height);
        cx.font = '12px monospace'; cx.textBaseline = 'middle';

        if (replay) return drawReplay(now, r);

        // wires
        if (S.wires) conns().forEach(function (c) {
          if (c.kind !== 'wire' && c.kind !== 'fuse') return;
          var A, B; try { A = C.endPoint(c, 'a'); B = C.endPoint(c, 'b'); } catch (e) { return; }
          if (!A || !B) return;
          var a = ws(A.x, A.y), b = ws(B.x, B.y);
          var on = (c.a && c.a.entity && c.a.entity.powered) || (c.b && c.b.entity && c.b.entity.powered);
          cx.strokeStyle = on ? 'rgba(255,220,60,0.95)' : 'rgba(170,170,170,0.6)'; cx.lineWidth = on ? 3 : 1.5;
          cx.beginPath(); cx.moveTo(a.x, a.y); cx.lineTo(b.x, b.y); cx.stroke();
          [['a', a], ['b', b]].forEach(function (pr) {
            var end = c[pr[0]]; if (!end || !end.entity) return; var role = 'both';
            try { role = C.roleOf(end.entity, c); } catch (e) {}
            cx.fillStyle = role === 'in' ? '#4aa8ff' : role === 'out' ? '#ff8c2a' : '#cccccc';
            cx.beginPath(); cx.arc(pr[1].x, pr[1].y, 4, 0, 7); cx.fill();
          });
        });

        // sensor beams
        if (S.sensors) g.entities.forEach(function (e) {
          if (typeof e.range !== 'number' || !/sensor|detector/.test(e.def.id)) return;
          var p = e.parts[0], f = (p.flip || 1), dx = Math.cos(p.a) * f, dy = Math.sin(p.a) * f;
          var a = ws(p.x, p.y), b = ws(p.x + dx * e.range, p.y + dy * e.range);
          cx.strokeStyle = e.def.id === 'sensor' ? 'rgba(255,80,80,0.8)' : 'rgba(80,255,160,0.8)'; cx.setLineDash([6, 4]); cx.lineWidth = 2;
          cx.beginPath(); cx.moveTo(a.x, a.y); cx.lineTo(b.x, b.y); cx.stroke(); cx.setLineDash([]);
          cx.fillStyle = cx.strokeStyle; cx.fillText(e.range + ' m', b.x + 4, b.y);
        });

        // aim lines (your guns only in multiplayer)
        if (S.aim) guns().forEach(function (e) {
          var m; try { m = e.main.pixelToWorld(e.gun.muzzle[0], e.gun.muzzle[1]); } catch (er) { m = e.parts[0]; }
          var f = e.forward(), a = ws(m.x, m.y), b = ws(m.x + f.x * 80, m.y + f.y * 80);
          var grd = cx.createLinearGradient(a.x, a.y, b.x, b.y); grd.addColorStop(0, 'rgba(255,60,60,0.9)'); grd.addColorStop(1, 'rgba(255,60,60,0)');
          cx.strokeStyle = grd; cx.lineWidth = 1.5; cx.beginPath(); cx.moveTo(a.x, a.y); cx.lineTo(b.x, b.y); cx.stroke();
          cx.fillStyle = '#ff6b6b'; cx.fillText(Math.round(Math.atan2(f.y, f.x) * 180 / Math.PI) + '°', a.x + 6, a.y - 10);
        });

        // jiggle meter + center of mass (your tracked build)
        jiggleCount = 0;
        if (tracked.size) {
          var M = 0, mx = 0, my = 0;
          tracked.forEach(function (e) {
            e.parts.forEach(function (p) {
              if (p.destroyed) return;
              var av = Math.abs(p.av || 0);
              if (S.jiggle && av > 6) { jiggleCount++; drawBoxPart(p, '#ff3b3b', 'rgba(255,40,40,0.25)'); }
              var m = 1; try { m = p.body.mass(); } catch (er) {}
              M += m; mx += p.x * m; my += p.y * m;
            });
          });
          if (S.com && M > 0) {
            var c = ws(mx / M, my / M), gr = ws(mx / M, 0);
            cx.strokeStyle = '#ffe14d'; cx.lineWidth = 2; cx.setLineDash([3, 3]); cx.beginPath(); cx.moveTo(c.x, c.y); cx.lineTo(gr.x, gr.y); cx.stroke(); cx.setLineDash([]);
            cx.beginPath(); cx.arc(c.x, c.y, 7, 0, 7); cx.stroke(); cx.beginPath(); cx.moveTo(c.x - 10, c.y); cx.lineTo(c.x + 10, c.y); cx.moveTo(c.x, c.y - 10); cx.lineTo(c.x, c.y + 10); cx.stroke();
            cx.fillStyle = '#ffe14d'; cx.fillText('center of mass', c.x + 12, c.y - 10);
          }
        }

        // ruler
        if (ruler.a) {
          var b2 = ruler.b || { x: ctl.wx, y: ctl.wy }, A1 = ws(ruler.a.x, ruler.a.y), B1 = ws(b2.x, b2.y);
          var dist = Math.hypot(b2.x - ruler.a.x, b2.y - ruler.a.y);
          cx.strokeStyle = '#7df9ff'; cx.lineWidth = 2; cx.beginPath(); cx.moveTo(A1.x, A1.y); cx.lineTo(B1.x, B1.y); cx.stroke();
          cx.fillStyle = '#7df9ff'; [A1, B1].forEach(function (q) { cx.beginPath(); cx.arc(q.x, q.y, 4, 0, 7); cx.fill(); });
          label(dist.toFixed(1) + ' m  (dx ' + (b2.x - ruler.a.x).toFixed(1) + ', dy ' + (b2.y - ruler.a.y).toFixed(1) + ')', (A1.x + B1.x) / 2, (A1.y + B1.y) / 2 - 14, '#7df9ff');
        }

        // damage numbers
        if (S.dmg) floats.forEach(function (f) {
          var age = (now - f.born) / 1800, s = ws(f.x, f.y);
          cx.globalAlpha = 1 - age; cx.font = 'bold 14px monospace';
          cx.fillStyle = f.v >= 100 ? '#ff4040' : f.v >= 20 ? '#ffb020' : '#ffffff';
          cx.strokeStyle = '#000'; cx.lineWidth = 3;
          var t = '-' + (f.v >= 10 ? Math.round(f.v) : f.v.toFixed(1));
          cx.strokeText(t, s.x + 6, s.y - 12 - age * 30); cx.fillText(t, s.x + 6, s.y - 12 - age * 30);
          cx.globalAlpha = 1; cx.font = '12px monospace';
        });

        // hover info
        if (S.hover && !ctl.armed) {
          var hp = g.pick(ctl.wx, ctl.wy, 0);
          if (hp && hp.entity) {
            var e = hp.entity, it = itemOf(e.def.id) || {}, lines = [(it.name || e.def.id) + (hp.name && e.parts.length > 1 ? ' - ' + hp.name : '')];
            var h = partHp(hp);
            if (h !== null) {
              var mxh = hp.maxHp || h; lines.push('health ' + Math.max(0, Math.round(h)) + ' / ' + Math.round(mxh));
            } else lines.push('unbreakable');
            if (e.usesPower || e.powered) lines.push(e.powered ? 'POWERED' : 'no power');
            if (typeof e.range === 'number') lines.push('range ' + e.range + ' m');
            if (e.gun) lines.push('aim ' + Math.round(Math.atan2(e.forward().y, e.forward().x) * 180 / Math.PI) + '°');
            if (tracked.has(e)) lines.push('(your build)');
            var s2 = ws(ctl.wx, ctl.wy);
            box(lines, s2.x + 18, s2.y + 14, h !== null ? Math.max(0, h) / (hp.maxHp || h || 1) : null);
          }
        }
      } catch (err) { if (!frame.err) { frame.err = 1; console.warn('BM Client overlay error', err); } }
    }
    function label(t, x, y, col) {
      var w = cx.measureText(t).width; cx.fillStyle = 'rgba(14,14,14,0.88)'; cx.fillRect(x - w / 2 - 4, y - 9, w + 8, 18);
      cx.fillStyle = col; cx.textAlign = 'center'; cx.fillText(t, x, y); cx.textAlign = 'left';
    }
    function box(lines, x, y, frac) {
      var w = 0; lines.forEach(function (l) { w = Math.max(w, cx.measureText(l).width); });
      var h = lines.length * 15 + (frac !== null ? 10 : 4);
      cx.fillStyle = 'rgba(14,14,14,0.92)'; cx.strokeStyle = '#e0a03a'; cx.lineWidth = 1;
      cx.fillRect(x, y, w + 14, h); cx.strokeRect(x, y, w + 14, h);
      cx.fillStyle = '#e6dcc4'; lines.forEach(function (l, i) { cx.fillText(l, x + 7, y + 10 + i * 15); });
      if (frac !== null) {
        var bw = w, by = y + h - 7; cx.fillStyle = '#333333'; cx.fillRect(x + 7, by, bw, 4);
        cx.fillStyle = frac > 0.6 ? '#5ad35a' : frac > 0.3 ? '#f0c030' : '#ff4040'; cx.fillRect(x + 7, by, bw * Math.max(0, Math.min(1, frac)), 4);
      }
    }
    function drawReplay(now, r) {
      var fr = replay.frames, t0 = fr[0].t, el = (now - replay.start) * replay.speed, i = replay.i;
      while (i < fr.length - 1 && fr[i + 1].t - t0 <= el) i++;
      replay.i = i;
      cx.fillStyle = 'rgba(8,8,8,0.72)'; cx.fillRect(0, 0, r.width, r.height);
      var f = fr[i].f;
      for (var j = 0; j < f.length; j += 5) drawBoxPart({ x: f[j], y: f[j + 1], a: f[j + 2], w: f[j + 3] * U, h: f[j + 4] * U }, 'rgba(125,249,255,0.9)', 'rgba(125,249,255,0.12)');
      label('REPLAY  ' + ((fr[i].t - t0) / 1000).toFixed(2) + 's / ' + ((fr[fr.length - 1].t - t0) / 1000).toFixed(1) + 's   x' + replay.speed + '   (Esc to stop)', r.width / 2, 24, '#7df9ff');
      if (i >= fr.length - 1) { if (!replay.end) replay.end = now; if (now - replay.end > 1200) replay = null; }
    }

    function loop(t) { frame(t || performance.now()); W.requestAnimationFrame(loop); }
    W.requestAnimationFrame(loop);
    var cpTimer = W.setInterval(function () { cleanTracked(); checkpoint(false); refresh(); }, 1500);

    /* ================= PANEL UI ================= */
    var css = D.createElement('style');
    css.textContent = [
      '#bmc{position:fixed;z-index:99999;right:64px;top:56px;width:250px;background:#121212;color:#dcdcdc;font:12px/1.35 monospace;border:1px solid #e0a03a;border-radius:6px;user-select:none}',
      '#bmc header{display:flex;align-items:center;gap:8px;padding:6px 8px;background:#1b1b1b;border-radius:6px 6px 0 0;cursor:move}',
      '#bmc header img{width:22px;height:22px;image-rendering:pixelated;border-radius:3px}',
      '#bmc header b{color:#e0a03a;flex:1}#bmc header span{cursor:pointer;padding:0 4px;color:#aaa}',
      '#bmc .bd{max-height:70vh;overflow:auto;padding:6px 8px 8px}',
      '#bmc h4{margin:8px 0 4px;color:#e0a03a;font-size:11px;letter-spacing:1px;border-bottom:1px solid #333333}',
      '#bmc button{background:#222222;color:#dcdcdc;border:1px solid #3a3a3a;border-radius:4px;padding:3px 6px;margin:2px 2px 2px 0;font:11px monospace;cursor:pointer}',
      '#bmc button:hover{background:#2c2c2c;border-color:#e0a03a}',
      '#bmc label{display:flex;align-items:center;gap:6px;cursor:pointer;margin:1px 0}',
      '#bmc select{width:100%;background:#222222;color:#dcdcdc;border:1px solid #3a3a3a;font:11px monospace;margin:2px 0}',
      '#bmc .mut{color:#9a9a9a;font-size:11px}#bmc .warn{color:#ff8080}#bmc .ok{color:#7dff9a}',
      '#bmc-rep{position:fixed;z-index:100000;left:50%;top:80px;transform:translateX(-50%);min-width:320px;max-width:520px;background:#121212;color:#dcdcdc;border:1px solid #e0a03a;border-radius:6px;font:12px monospace;padding:10px 12px}',
      '#bmc-rep b{color:#e0a03a}#bmc-rep div{margin:3px 0}#bmc-rep button{margin-top:8px;background:#222222;color:#dcdcdc;border:1px solid #3a3a3a;border-radius:4px;padding:3px 10px;font:11px monospace;cursor:pointer}',
      '#bmc-tag{position:fixed;z-index:99998;left:8px;bottom:8px;background:#121212cc;color:#e0a03a;border:1px solid #e0a03a;border-radius:5px;font:11px monospace;padding:2px 7px;cursor:pointer}'
    ].join('\n');
    D.head.appendChild(css);

    var P = D.createElement('div'); P.id = 'bmc';
    P.innerHTML =
      '<header><img src="' + LOGO + '" alt=""><b>BM CLIENT v' + VERSION + '</b><span id="bmc-min" title="Hide (` key)">_</span></header>' +
      '<div class="bd">' +
      '<div id="bmc-mode" class="mut"></div>' +
      '<h4>BM BUILDS</h4><select id="bmc-builds"></select><button id="bmc-spawn">Spawn selected build</button>' +
      '<h4>MY BUILD + CHECKPOINTS</h4>' +
      '<div id="bmc-track" class="mut">Not tracking anything</div>' +
      '<button id="bmc-trk">Track selected</button><button id="bmc-cp">Save checkpoint</button><br>' +
      '<select id="bmc-cps"></select><button id="bmc-rst">Respawn checkpoint</button>' +
      '<h4>TOURNAMENT</h4><button id="bmc-legal">Check if legal</button><div id="bmc-lag" class="mut"></div>' +
      '<h4>OVERLAYS</h4>' +
      tog('dmg', 'Damage numbers') + tog('hover', 'Hover info + health') + tog('aim', 'Aim lines') + tog('wires', 'Wire view (blue=in, orange=out)') +
      tog('sensors', 'Sensor beams') + tog('jiggle', 'Jiggle meter (your build)') + tog('com', 'Center of mass (your build)') + tog('lag', 'Lag meter') +
      '<h4>TOOLS</h4><div class="mut">Ruler: press <b>\\</b> twice</div><button id="bmc-rep5">Replay last 5 s</button>' +
      '<h4>TEST RANGE <span class="mut">(single player)</span></h4><button id="bmc-dum">Dummy at mouse</button><button id="bmc-pln">Balloon plane at mouse</button><button id="bmc-clr">Clear test stuff</button>' +
      '<div class="mut" style="margin-top:6px">` hide/show panel &nbsp; \\ ruler &nbsp; Esc stop replay</div>' +
      '</div>';
    function tog(k, t) { return '<label><input type="checkbox" data-k="' + k + '"' + (S[k] ? ' checked' : '') + '>' + t + '</label>'; }
    D.body.appendChild(P);
    var tag = D.createElement('div'); tag.id = 'bmc-tag'; tag.textContent = 'BM Client on'; tag.title = 'BM Client is running (click to show panel)'; D.body.appendChild(tag);
    tag.onclick = function () { toggle(true); };
    function $(id) { return D.getElementById(id); }

    var sel = $('bmc-builds');
    BUILDS.forEach(function (b, i) { var o = D.createElement('option'); o.value = i; o.textContent = b.name; sel.appendChild(o); });
    if (!BUILDS.length) { var o0 = D.createElement('option'); o0.textContent = '(library did not load)'; sel.appendChild(o0); }
    $('bmc-spawn').onclick = function () { var b = BUILDS[+sel.value]; if (b) arm('BM - ' + b.name, b.snap); };
    $('bmc-trk').onclick = trackFromSelection;
    $('bmc-cp').onclick = function () { checkpoint(true); toast('Checkpoint saved'); };
    $('bmc-rst').onclick = function () { restore(+$('bmc-cps').value || 0); };
    $('bmc-legal').onclick = legality;
    $('bmc-rep5').onclick = startReplay;
    $('bmc-dum').onclick = spawnDummy; $('bmc-pln').onclick = spawnPlane; $('bmc-clr').onclick = clearTest;
    $('bmc-min').onclick = function () { toggle(false); };
    Array.prototype.forEach.call(P.querySelectorAll('input[data-k]'), function (c) { c.onchange = function () { S[c.dataset.k] = c.checked; saveS(); refresh(); }; });
    // stop game hotkeys while clicking the panel
    ['keydown', 'pointerdown', 'mousedown', 'wheel', 'contextmenu'].forEach(function (ev) { P.addEventListener(ev, function (e) { e.stopPropagation(); }); });

    // drag panel
    (function () {
      var h = P.querySelector('header'), sx, sy, ox, oy, on = false;
      h.addEventListener('pointerdown', function (e) { on = true; sx = e.clientX; sy = e.clientY; var r = P.getBoundingClientRect(); ox = r.left; oy = r.top; h.setPointerCapture(e.pointerId); });
      h.addEventListener('pointermove', function (e) { if (!on) return; P.style.left = (ox + e.clientX - sx) + 'px'; P.style.top = (oy + e.clientY - sy) + 'px'; P.style.right = 'auto'; });
      h.addEventListener('pointerup', function () { on = false; });
    })();

    function refresh() {
      $('bmc-mode').innerHTML = isMP() ? '<span class="warn">Multiplayer:</span> overlays only show your tracked build; test range off.' : 'Single player';
      var t = $('bmc-track');
      if (tracked.size) {
        var hp = hpSum(tracked);
        t.innerHTML = 'Tracking <b>' + tracked.size + '</b> parts' + (jiggleCount ? ' &middot; <span class="warn">' + jiggleCount + ' jiggling</span>' : ' &middot; <span class="ok">steady</span>') + '<br>health ' + Math.round(hp);
      } else t.textContent = 'Not tracking anything. Select your build, then Track.';
      var cs = $('bmc-cps'), cur = cs.value; cs.innerHTML = '';
      checkpoints.forEach(function (c, i) { var o = D.createElement('option'); o.value = i; var d = new Date(c.t); o.textContent = (i === 0 ? 'latest ' : '') + d.toLocaleTimeString() + ' - ' + c.n + ' parts'; cs.appendChild(o); });
      if (!checkpoints.length) { var o = D.createElement('option'); o.textContent = '(no checkpoints yet)'; cs.appendChild(o); }
      if (cur) cs.value = cur;
      var L = $('bmc-lag');
      if (S.lag) {
        var s = lagStats(), bad = s.fps && s.fps < 30;
        L.innerHTML = 'fps <b class="' + (bad ? 'warn' : 'ok') + '">' + s.fps + '</b> &middot; physics ' + s.step.toFixed(1) + ' ms &middot; ' + s.bodies + ' bodies' + (s.bodies > 600 ? ' <span class="warn">(heavy)</span>' : '');
      } else L.textContent = '';
    }
    W.setInterval(refresh, 500);
    refresh();

    function showReport(title, lines) {
      var old = $('bmc-rep'); if (old) old.remove();
      var d = D.createElement('div'); d.id = 'bmc-rep';
      d.innerHTML = '<b>' + title + '</b>' + lines.map(function (l) {
        var cls = /^ILLEGAL/.test(l) ? 'warn' : /^LEGAL/.test(l) ? 'ok' : 'mut';
        return '<div class="' + cls + '" style="color:' + (cls === 'warn' ? '#ff8080' : cls === 'ok' ? '#7dff9a' : '#f0d080') + '">' + l.replace(/</g, '&lt;') + '</div>';
      }).join('') + '<button>OK</button>';
      d.querySelector('button').onclick = function () { d.remove(); };
      ['keydown', 'pointerdown', 'mousedown'].forEach(function (ev) { d.addEventListener(ev, function (e) { e.stopPropagation(); }); });
      D.body.appendChild(d);
    }

    function toggle(show) {
      var vis = P.style.display !== 'none';
      if (show === undefined) show = !vis;
      P.style.display = show ? '' : 'none';
    }

    W.addEventListener('keydown', function (e) {
      var tgt = e.target; if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return;
      if (e.key === '`') { toggle(); e.preventDefault(); e.stopPropagation(); }
      else if (e.key === '\\') { rulerKey(); e.preventDefault(); e.stopPropagation(); }
      else if (e.key === 'Escape' && (replay || ruler.a)) { replay = null; ruler.a = ruler.b = null; e.preventDefault(); e.stopPropagation(); }
    }, true);

    W.BMC = { version: VERSION, toggle: toggle, track: trackFromSelection, checkpoint: checkpoint, restore: restore, legality: legality, settings: S, tracked: function () { return tracked; } };
    toast('BM Client v' + VERSION + ' loaded - press ` to hide/show');
  }
})();
