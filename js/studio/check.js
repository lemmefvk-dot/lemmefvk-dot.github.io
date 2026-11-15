/* ============================================================
   studio/check.js — "Check my game".

   Reads a scene (and the game code next to it) and lists what is
   likely to be wrong, in plain words, before anyone plays it:
   no player, nothing that can win, a coin stuck inside a wall, a
   missing picture, a spawner with nothing to copy …

   Reachability is a rough estimate, not a proof. For a platformer
   it works out how high and how far one jump goes from the
   player's settings and the gravity, then walks from platform to
   platform. For a top-down game it floods the room around the
   player, treating anything an event can remove (a door) as open.
   It only says "looks out of reach"; it never says "impossible".

     checkGame(scene, { assets, code }) -> [{ sev, text, id?, level }]
       sev: 'error' (the game can't work) · 'warn' (probably wrong) · 'tip'
   ============================================================ */

const has = (o, t) => (o.behaviours || []).some(b => b.type === t);
const beh = (o, t) => (o.behaviours || []).find(b => b.type === t) || null;
const isPlayer = o => has(o, 'platformer') || has(o, 'topdown');
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/* a tilemap object as the solid boxes the engine would make from it */
function tileRects(o) {
  const t = o.tiles, size = t?.size || 32, out = [];
  (t?.rows || []).forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      if (row[c] !== '#') continue;
      let e = c;
      while (e < row.length && row[e] === '#') e++;
      out.push({ x: o.x + c * size, y: o.y + r * size, w: (e - c) * size, h: size, tile: true });
      c = e - 1;
    }
  });
  return out;
}

function levelsOf(scene) {
  return [{ n: 1, objects: scene.objects || [], events: scene.events || [] },
    ...(scene.levels || []).map((l, i) => ({ n: i + 2, objects: l.objects || [], events: l.events || [] }))];
}

/* what an event can take away: a door that is "removed" when you touch it is not a wall */
function removable(lv) {
  const ids = new Set(), groups = new Set();
  for (const ev of lv.events) {
    const acts = (ev.actions || []).map(a => a.do);
    for (const [side, kill] of [['a', 'destroyA'], ['b', 'destroyB']]) {
      if (!acts.includes(kill)) continue;
      const ref = String(ev[side] || '');
      if (ref.startsWith('id:')) ids.add(ref.slice(3));
      else if (ref.startsWith('group:')) groups.add(ref.slice(6));
    }
  }
  return o => ids.has(o.id) || groups.has(o.group);
}

function solidsOf(lv) {
  const rem = removable(lv);
  const out = [];
  for (const o of lv.objects) {
    if (o.spawnOnly || o.text) continue;
    if (o.tiles) { for (const r of tileRects(o)) out.push({ ...r, id: o.id, open: false }); continue; }
    if (!o.solid) continue;
    const mv = beh(o, 'moving');
    let r = { x: o.x, y: o.y, w: o.w, h: o.h, id: o.id, open: rem(o) };
    if (mv) r = { ...r, x: Math.min(o.x, o.x + mv.dx), y: Math.min(o.y, o.y + mv.dy), w: o.w + Math.abs(mv.dx), h: o.h + Math.abs(mv.dy), moving: true };
    out.push(r);
  }
  return out;
}

/* ---- platformer: which platforms can the player get to? ---- */
function platformReach(lv, st, pl, wants) {
  const g = st.gravity > 0 ? st.gravity : 1500;
  const b = beh(pl, 'platformer');
  const jump = b.jump, speed = b.speed, extra = b.airJumps || 0;
  const H = (jump * jump) / (2 * g) * (1 + 0.75 * extra);
  const tUp = jump / g * (1 + 0.75 * extra);
  const reachX = dy => {
    const down = Math.max(0, H - Math.min(H, dy));
    return speed * 0.9 * (tUp + Math.sqrt(2 * down / g));
  };
  const solids = solidsOf(lv).filter(s => !s.open);
  /* a surface is the top of a solid box */
  const surfaces = solids.map(s => ({ x0: s.x, x1: s.x + s.w, y: s.y }));
  const world = { w: Math.max(st.width, st.worldWidth || 0), h: Math.max(st.height, st.worldHeight || 0) };
  const start = surfaces.filter(s => pl.x + pl.w > s.x0 && pl.x < s.x1 && s.y >= pl.y + pl.h - 2).sort((a, b) => a.y - b.y)[0] || null;
  if (!start) return { start: null, can: () => true };
  const seen = new Set([start]), queue = [start];
  while (queue.length) {
    const a = queue.shift();
    for (const s of surfaces) {
      if (seen.has(s)) continue;
      const dy = a.y - s.y;
      if (dy > H + 2) continue;
      const gx = Math.max(0, s.x0 - a.x1, a.x0 - s.x1);
      if (gx <= reachX(Math.max(0, dy))) { seen.add(s); queue.push(s); }
    }
  }
  const can = it => {
    for (const s of seen) {
      const dyHead = s.y - H - pl.h;
      if (it.y + it.h < dyHead) continue;
      const gx = Math.max(0, it.x - s.x1, s.x0 - (it.x + it.w));
      const rise = Math.max(0, s.y - (it.y + it.h));
      if (gx <= reachX(Math.min(H, rise)) + pl.w) return true;
    }
    return false;
  };
  void world; void wants;
  return { start, can };
}

/* ---- top-down: flood the room from the player ---- */
function roomReach(lv, st, pl) {
  const solids = solidsOf(lv).filter(s => !s.open);
  const W = Math.max(st.width, st.worldWidth || 0), Hh = Math.max(st.height, st.worldHeight || 0);
  const cell = 8, cols = Math.ceil(W / cell), rows = Math.ceil(Hh / cell);
  if (cols * rows > 160000) return null;
  const free = (x, y) => {
    const box = { x, y, w: pl.w, h: pl.h };
    if (x < 0 || y < 0 || x + pl.w > W || y + pl.h > Hh) return false;
    for (const s of solids) if (overlap(box, s)) return false;
    return true;
  };
  const seen = new Uint8Array(cols * rows);
  const sx = Math.round(pl.x / cell), sy = Math.round(pl.y / cell);
  if (sx < 0 || sy < 0 || sx >= cols || sy >= rows) return null;
  const stack = [[sx, sy]];
  seen[sy * cols + sx] = 1;
  while (stack.length) {
    const [cx, cy] = stack.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || seen[ny * cols + nx]) continue;
      if (!free(nx * cell, ny * cell)) continue;
      seen[ny * cols + nx] = 1;
      stack.push([nx, ny]);
    }
  }
  return it => {
    const x0 = Math.max(0, Math.floor((it.x - pl.w) / cell)), x1 = Math.min(cols - 1, Math.ceil((it.x + it.w) / cell));
    const y0 = Math.max(0, Math.floor((it.y - pl.h) / cell)), y1 = Math.min(rows - 1, Math.ceil((it.y + it.h) / cell));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (seen[y * cols + x] && overlap({ x: x * cell, y: y * cell, w: pl.w, h: pl.h }, it)) return true;
    }
    return false;
  };
}

/* game code without its comments (Studio's own help comment mentions game.win()) */
const stripComments = code => String(code || '').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');

export function checkGame(scene, { assets = [], code: rawCode = '' } = {}) {
  const code = stripComments(rawCode);
  const out = [];
  if (!scene) return out;
  const st = scene.settings || {};
  const lvs = levelsOf(scene);
  const add = (sev, text, id = null, level = 1) => out.push({ sev, text, id, level });
  const tag = n => (lvs.length > 1 ? `Level ${n}: ` : '');
  const assetIds = new Set(assets.map(a => a.id));
  const assetOf = id => assets.find(a => a.id === id);

  if (!lvs.some(l => l.objects.length)) add('error', 'The scene is empty. Add a player and something to do.');

  let anyGoal = false, anyWinEvent = false;
  for (const lv of lvs) {
    if (!lv.objects.length) { if (lvs.length > 1) add('warn', `${tag(lv.n)}there is nothing in this level yet.`, null, lv.n); continue; }
    const players = lv.objects.filter(o => isPlayer(o) && !o.spawnOnly);
    /* a clicker, or a game steered only by blocks or code that reads keys and clicks, needs no player object */
    const noPlayerOk = lv.objects.some(o => has(o, 'clickable')) || /game\.on\(\s*['"](key|click)['"]/.test(code || '');
    if (!players.length && !noPlayerOk) add('error', `${tag(lv.n)}there is no player. Add “Player: platformer” or “Player: top-down” from the Add menu.`, null, lv.n);
    const goals = lv.objects.filter(o => has(o, 'goal'));
    if (goals.length) anyGoal = true;
    if (lv.events.some(e => (e.actions || []).some(a => a.do === 'win'))) anyWinEvent = true;
    if (lv.events.some(e => (e.actions || []).some(a => a.do === 'nextLevel'))) anyGoal = true;

    const solids = solidsOf(lv);
    const world = { w: Math.max(st.width || 800, st.worldWidth || 0), h: Math.max(st.height || 450, st.worldHeight || 0) };
    const pl = players[0];

    for (const g of goals) {
      const b = beh(g, 'goal');
      if (b.needAll && !lv.objects.some(o => has(o, 'collectible') && !has(o, 'faller'))) add('warn', `${tag(lv.n)}“${g.name}” waits for every collectible, but there are none, so it opens straight away.`, g.id, lv.n);
    }
    for (const o of lv.objects) {
      if (o.spawnOnly) continue;
      if (has(o, 'platformer') && !(st.gravity > 0)) add('warn', `${tag(lv.n)}“${o.name}” is a platformer player but gravity is 0 in the Game tab, so it will float.`, o.id, lv.n);
      const important = has(o, 'collectible') || has(o, 'goal');
      if (important) {
        if (solids.some(s => !s.open && overlap(o, s))) add('error', `${tag(lv.n)}“${o.name}” is inside something solid, so nobody can reach it.`, o.id, lv.n);
        else if (o.x + o.w < 0 || o.y + o.h < 0 || o.x > world.w || o.y > world.h) add('error', `${tag(lv.n)}“${o.name}” is outside the game area, so nobody can reach it.`, o.id, lv.n);
      } else if (!o.tiles && (o.x + o.w < 0 || o.y + o.h < 0 || o.x > world.w + 50 || o.y > world.h + 50) && !has(o, 'faller') && !has(o, 'spawner')) {
        add('tip', `${tag(lv.n)}“${o.name}” is outside the game area.`, o.id, lv.n);
      }
      if (has(o, 'shooter') && !isPlayer(o)) add('warn', `${tag(lv.n)}“${o.name}” has a Shooter but no way to move. Give it a player behaviour too.`, o.id, lv.n);
      const sp = beh(o, 'spawner');
      if (sp) {
        const tpl = lv.objects.find(x => x.id === sp.what);
        if (!sp.what || !tpl) add('warn', `${tag(lv.n)}the spawner “${o.name}” has nothing to copy. Pick an object in its settings.`, o.id, lv.n);
        else if (!tpl.spawnOnly) add('tip', `${tag(lv.n)}“${tpl.name}” is copied by “${o.name}” but is also in the level from the start. Tick “Only appears when spawned” on it if that is not what you want.`, tpl.id, lv.n);
      }
      if (o.sprite && !assetIds.has(o.sprite)) add('warn', `${tag(lv.n)}“${o.name}” uses a picture that is not in Assets any more.`, o.id, lv.n);
      for (const b of o.behaviours || []) {
        for (const k of ['sound']) if (b[k] && !assetIds.has(b[k])) add('warn', `${tag(lv.n)}“${o.name}” uses a sound that is not in Assets any more.`, o.id, lv.n);
      }
    }
    lv.events.forEach((ev, i) => {
      for (const side of ['a', 'b']) {
        const ref = String(ev[side] || '');
        if (ref.startsWith('group:') && !lv.objects.some(o => o.group === ref.slice(6))) add('warn', `${tag(lv.n)}event ${i + 1} waits for “${ref.slice(6)}” but no object is in that group.`, null, lv.n);
        if (ref === 'player' && !players.length) add('warn', `${tag(lv.n)}event ${i + 1} is about the player, but there is no player.`, null, lv.n);
      }
      for (const a of ev.actions || []) {
        if (a.do === 'spawn' && !lv.objects.some(o => o.id === a.obj)) add('warn', `${tag(lv.n)}event ${i + 1} spawns an object that is not in this level.`, null, lv.n);
        if (a.do === 'teleport' && !lv.objects.some(o => o.id === a.obj)) add('warn', `${tag(lv.n)}event ${i + 1} moves the player to an object that is not in this level.`, null, lv.n);
        if ((a.do === 'setVar' || a.do === 'addVar') && !a.name) add('warn', `${tag(lv.n)}event ${i + 1} changes a variable, but no name is set.`, null, lv.n);
      }
    });

    /* can the player get there? */
    if (pl) {
      const wants = lv.objects.filter(o => (has(o, 'collectible') && !has(o, 'faller')) || has(o, 'goal'));
      if (has(pl, 'platformer') && st.gravity > 0 && wants.length) {
        const r = platformReach(lv, st, pl, wants);
        if (!r.start) add('warn', `${tag(lv.n)}“${pl.name}” starts in mid-air with nothing solid under it, so it will fall straight out of the game.`, pl.id, lv.n);
        else for (const it of wants) {
          if (solids.some(s => !s.open && overlap(it, s))) continue;
          if (!r.can(it)) add('warn', `${tag(lv.n)}“${it.name}” looks out of reach: it is higher or further than a jump can manage from anywhere the player can get to. (This is an estimate. Try it, and raise the jump or move the platforms if so.)`, it.id, lv.n);
        }
      } else if (has(pl, 'topdown') && wants.length) {
        const can = roomReach(lv, st, pl);
        if (can) for (const it of wants) {
          if (solids.some(s => !s.open && overlap(it, s))) continue;
          if (!can(it)) add('warn', `${tag(lv.n)}“${it.name}” looks walled off: the player cannot find a way to it. (Doors that an event removes count as open.)`, it.id, lv.n);
        }
      }
      if (solids.some(s => !s.open && overlap(pl, s))) add('error', `${tag(lv.n)}“${pl.name}” starts inside something solid and may be stuck.`, pl.id, lv.n);
      const bad = lv.objects.find(o => has(o, 'hazard') && !has(o, 'faller') && overlap(pl, o));
      if (bad) add('warn', `${tag(lv.n)}“${pl.name}” starts on top of “${bad.name}” and will lose a life at once.`, pl.id, lv.n);
    }
  }

  const winByTimer = st.timer > 0 && st.timerEnds === 'win';
  const winByCode = /game\.win\s*\(/.test(code || '') || /game\.nextLevel\s*\(/.test(code || '');
  if (!anyGoal && !anyWinEvent && !(st.winScore > 0) && !winByTimer && !winByCode && lvs.some(l => l.objects.length)) {
    add('warn', 'Nothing can win this game: no goal, no winning score, no timer that wins and no “Win the game” event. It can only be lost, or played forever.');
  }
  if (st.winScore > 0) {
    const pts = [];
    for (const lv of lvs) for (const o of lv.objects) { const c = beh(o, 'collectible'); if (c && c.points > 0 && !has(o, 'faller')) pts.push(c.points); }
    const total = pts.reduce((a, b) => a + b, 0);
    const scores = o => has(o, 'collectible') || has(o, 'clickable');
    const hasOther = lvs.some(l => l.objects.some(o => has(o, 'faller') || has(o, 'clickable') || has(o, 'shooter') || has(o, 'patrol') || has(o, 'chase') || (o.spawnOnly && scores(o)))) || lvs.some(l => l.events.some(e => (e.actions || []).some(a => a.do === 'score'))) || /addScore/.test(code || '');
    if (!hasOther && total + (st.score || 0) < st.winScore) add('warn', `The winning score is ${st.winScore}, but the collectibles only add up to ${total}. It can never be reached.`);
  }
  if (st.music && !assetIds.has(st.music)) add('warn', 'The game music is not in Assets any more.');
  for (const k of ['winImage', 'loseImage']) if (st[k] && !assetIds.has(st[k])) add('warn', `The ${k === 'winImage' ? 'win' : 'game-over'} screen picture is not in Assets any more.`);
  if (st.music && assetOf(st.music) && assetOf(st.music).dataUrl && assetOf(st.music).dataUrl.length > 1.5e6) add('tip', 'The music is big (over 1 MB), so a share link will not fit it. Export a file instead, or use a shorter loop.');
  const order = { error: 0, warn: 1, tip: 2 };
  return out.sort((a, b) => order[a.sev] - order[b.sev]);
}

export default { checkGame };
