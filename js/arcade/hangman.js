/* ============================================================
   arcade/hangman.js — Hangman for Static Arcade.

   Guess the hidden word one letter at a time. A right letter shows
   everywhere it sits; a wrong one adds a part to the little person
   on the gallows (head, body, two arms, two legs). Six wrong guesses
   and the round is lost; fill in the word first and it is won.

   · Categories with word lists written for StaticOS (./hangman-words.js):
     Animals, Food, Space, Sports & games, Around the world, Science, or
     All of them. The choice is remembered.
   · Letters: the on-screen keyboard (click or tap) or your own keyboard
     (A–Z). While the game is running P is a letter, so pause with Esc.
   · Wins and losses are counted on this device (portal.arcadeHangman),
     with the current and the best winning streak. The round's score is
     the streak after a win, so the Arcade's best is your longest streak;
     a loss ends the round with no score.
   · Reduced motion: the person appears at once and nothing bounces.
   ============================================================ */
import { h } from '../core/dom.js';
import { store } from '../core/store.js';
import { surface, ownsKey, sounder, looper, rr } from './boardkit.js';
import { CATEGORIES, CATEGORY_IDS } from './hangman-words.js';

const PREF = 'portal.arcadeHangman';
export const MAX_WRONG = 6;
const FONT = 'Inter,ui-sans-serif,system-ui,sans-serif';
const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

const readPrefs = () => {
  let p = null;
  try { p = store.get(PREF, null); } catch (err) { p = null; }
  const n = v => (Number.isInteger(v) && v >= 0 ? v : 0);
  return { cat: p?.cat === 'all' || CATEGORIES[p?.cat] ? p.cat : 'all', wins: n(p?.wins), losses: n(p?.losses), streak: n(p?.streak), bestStreak: n(p?.bestStreak) };
};
const writePrefs = p => { try { store.set(PREF, p); } catch (err) { /* a convenience */ } };

const CSS = `
.arx-hm{position:absolute;inset:0;display:flex;flex-direction:column;gap:8px;padding:12px 14px 12px;box-sizing:border-box;font-family:var(--font,system-ui);color:var(--ink-1,#ddd);container-type:size;user-select:none;-webkit-user-select:none}
.arx-hm *{box-sizing:border-box}
.arx-hm__stage{position:relative;flex:1 1 auto;min-height:120px}
.arx-hm__bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:6px 10px;flex:0 0 auto}
.arx-hm__cats{display:flex;flex-wrap:wrap;justify-content:center;gap:5px}
.arx-hm__chip,.arx-hm__btn{font:600 12px/1 var(--font,system-ui);color:var(--ink-2,#aaa);background:var(--fill-1,rgba(255,255,255,.06));border:1px solid var(--line-1,rgba(255,255,255,.08));padding:7px 10px;border-radius:999px;cursor:pointer;white-space:nowrap}
.arx-hm__chip[aria-pressed="true"]{background:var(--fill-3,rgba(255,255,255,.16));color:var(--ink-0,#fff);border-color:var(--ink-3,#888)}
.arx-hm__btn{border-radius:var(--r-md,11px);color:var(--ink-1,#ddd)}
@media (hover:hover){.arx-hm__chip:hover,.arx-hm__btn:hover{background:var(--fill-2,rgba(255,255,255,.1));color:var(--ink-0,#fff)}}
.arx-hm__chip:focus-visible,.arx-hm__btn:focus-visible,.arx-hm__k:focus-visible{outline:2px solid #8ecbff;outline-offset:2px}
.arx-hm__stats{font-size:12px;color:var(--ink-2,#aaa);font-variant-numeric:tabular-nums}
.arx-hm__stats b{color:var(--ink-0,#fff);font-weight:700}
.arx-hm__kb{display:flex;flex-direction:column;align-items:center;gap:5px;flex:0 0 auto}
.arx-hm__row{display:flex;justify-content:center;gap:5px}
.arx-hm__k{width:clamp(26px,8.4cqw,44px);height:clamp(34px,6.2cqh,46px);padding:0;font:700 clamp(13px,3.2cqw,17px)/1 var(--font,system-ui);text-transform:uppercase;color:var(--ink-0,#fff);cursor:pointer;
  background:linear-gradient(180deg,var(--fill-3,rgba(255,255,255,.16)),var(--fill-2,rgba(255,255,255,.1)));border:1px solid var(--line-1,rgba(255,255,255,.1));border-radius:9px;box-shadow:0 2px 0 rgba(0,0,0,.35)}
.arx-hm__k.is-right{background:#2f8f5b;border-color:#58d08a;color:#fff}
.arx-hm__k.is-wrong{background:#6b2b36;border-color:#c4566a;color:#f3c7cf;opacity:.8}
.arx-hm__k:disabled{cursor:default}
.arx-hm__k:disabled:not(.is-right):not(.is-wrong){opacity:.55}
.arx-hm__sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (hover:hover){.arx-hm__k:not(:disabled):hover{filter:brightness(1.2)}}
`;

export default {
  mount(el, ctx) {
    const reduced = !!ctx.reduced;
    const snd = sounder(ctx);
    const P = readPrefs();
    let dead = false, recent = [];
    const S = { word: '', cat: P.cat, right: [], wrong: [], over: null, paused: false, t0: 0, pop: 0, endT: 0, ended: false, geo: { x: 0, y: 0, w: 0, h: 0 } };

    /* ------------------------------ the page ------------------------------ */
    const stage = h('div.arx-hm__stage');
    const sr = h('div.arx-hm__sr', { 'aria-live': 'polite' });
    const statsEl = h('div.arx-hm__stats');
    const catBtns = [['all', 'All'], ...CATEGORY_IDS.map(id => [id, CATEGORIES[id].name])].map(([id, label]) =>
      h('button.arx-hm__chip', { type: 'button', dataset: { cat: id }, 'aria-pressed': String(id === S.cat), onclick: () => { setCat(id); refocus(); } }, label));
    const newBtn = h('button.arx-hm__btn', { type: 'button', title: 'A different word (counts as nothing)', onclick: () => { newWord(); refocus(); } }, 'New word');
    const keys = new Map();
    const kb = h('div.arx-hm__kb', { role: 'group', 'aria-label': 'Letters' }, ROWS.map(row => h('div.arx-hm__row', [...row].map(ch => {
      const b = h('button.arx-hm__k', { type: 'button', dataset: { k: ch }, 'aria-label': ch.toUpperCase(), onclick: () => { guess(ch); refocus(); } }, ch);
      keys.set(ch, b);
      return b;
    }))));
    const root = h('div.arx-hm', h('style', { text: CSS }), stage,
      h('div.arx-hm__bar', h('div.arx-hm__cats', { role: 'group', 'aria-label': 'Category' }, catBtns), newBtn),
      kb, h('div.arx-hm__bar', statsEl), sr);
    el.appendChild(root);
    const sf = surface(stage, 'Hangman gallows and the hidden word', () => draw());
    const loop = looper(() => draw());
    const refocus = () => el.closest('[tabindex]')?.focus({ preventScroll: true });
    const say = t => { sr.textContent = t; };

    /* ------------------------------ rules ------------------------------ */
    const pool = () => (S.cat === 'all' ? CATEGORY_IDS.flatMap(id => CATEGORIES[id].words) : CATEGORIES[S.cat].words);
    const masked = () => [...S.word].map(c => (S.right.includes(c) ? c : '_')).join('');
    const won = () => [...S.word].every(c => S.right.includes(c));

    function setWord(w) {
      clearTimeout(S.endT);
      Object.assign(S, { word: w, right: [], wrong: [], over: null, ended: false, pop: 0 });
      for (const b of keys.values()) { b.disabled = false; b.classList.remove('is-right', 'is-wrong'); }
      ctx.onScore(P.streak);
      paint();
    }
    function newWord() {
      const list = pool();
      let w = list[Math.floor(Math.random() * list.length)];
      for (let i = 0; i < 8 && recent.includes(w); i++) w = list[Math.floor(Math.random() * list.length)];
      recent = [w, ...recent].slice(0, 12);
      setWord(w);
      say(`New word, ${w.length} letters. ${MAX_WRONG} wrong guesses allowed.`);
    }
    function setCat(id) {
      S.cat = id;
      P.cat = id;
      writePrefs(P);
      catBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.cat === id)));
      newWord();
    }

    function guess(ch) {
      if (dead || S.over || S.paused || !/^[a-z]$/.test(ch)) return false;
      if (S.right.includes(ch) || S.wrong.includes(ch)) return false;
      snd.wake();
      const b = keys.get(ch);
      if (b) b.disabled = true;
      if (S.word.includes(ch)) {
        S.right.push(ch);
        b?.classList.add('is-right');
        snd.blip(520 + S.right.length * 30, 0.08, 'triangle', 0.8);
        say(`${ch.toUpperCase()} is in the word. ${masked().split('').join(' ')}`);
      } else {
        S.wrong.push(ch);
        b?.classList.add('is-wrong');
        S.pop = performance.now();
        snd.blip(190, 0.14, 'sawtooth', 0.5, 120);
        say(`No ${ch.toUpperCase()}. ${S.wrong.length} of ${MAX_WRONG} wrong.`);
      }
      if (won()) S.over = 'win';
      else if (S.wrong.length >= MAX_WRONG) S.over = 'lose';
      if (S.over) {
        for (const k of keys.values()) k.disabled = true;
        S.t0 = performance.now();
        record(S.over === 'win');
        say(S.over === 'win' ? `You got it: ${S.word}!` : `Out of guesses. The word was ${S.word}.`);
        S.endT = setTimeout(finish, reduced ? 350 : 1400);
      }
      loop.kick(1.6);
      paint();
      return true;
    }
    function record(win) {
      if (win) { P.wins++; P.streak++; P.bestStreak = Math.max(P.bestStreak, P.streak); } else { P.losses++; P.streak = 0; }
      writePrefs(P);
    }
    function finish() {
      if (dead || S.ended || !S.over) return;
      S.ended = true;
      const win = S.over === 'win';
      ctx.onEnd(win
        ? { score: P.streak, won: true, detail: `${S.word} with ${S.wrong.length} wrong ${S.wrong.length === 1 ? 'guess' : 'guesses'}. Streak: ${P.streak}.` }
        : { score: null, won: false, detail: `The word was “${S.word}”. Streak reset.` });
    }

    function paint() {
      if (dead) return;
      const cat = S.cat === 'all' ? 'All categories' : CATEGORIES[S.cat].name;
      statsEl.replaceChildren(h('span', {}, 'Wins ', h('b', { text: String(P.wins) })), ' · ', h('span', {}, 'Losses ', h('b', { text: String(P.losses) })),
        ' · ', h('span', {}, 'Streak ', h('b', { text: String(P.streak) })), ' · ', h('span', {}, 'Best streak ', h('b', { text: String(P.bestStreak) })), ' · ', cat);
      ctx.onScore(P.streak);
      sf.cv.setAttribute('aria-label', `Hangman. ${S.wrong.length} of ${MAX_WRONG} wrong. Word: ${S.paused ? 'hidden while paused' : masked().split('').join(' ')}`);
      draw();
    }

    /* ------------------------------ drawing ------------------------------ */
    const cat = () => (S.cat === 'all' ? 200 : CATEGORIES[S.cat].hue);
    function draw() {
      if (dead) return;
      const g = sf.g;
      sf.begin();
      const W = sf.w, H = sf.h, now = performance.now();
      const hue = cat();
      const bg = g.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, `hsl(${hue} 40% 14%)`);
      bg.addColorStop(1, '#07080f');
      g.fillStyle = bg;
      g.fillRect(0, 0, W, H);
      /* the scene: gallows on the left, word along the bottom */
      const wordH = Math.min(H * 0.3, 90);
      const sceneH = H - wordH, u = Math.max(20, Math.min(sceneH / 10, W / 16));
      const gx = W / 2 - u * 2.6, gy = sceneH - u * 0.9;
      S.geo = { x: gx, y: gy, w: u, h: sceneH };
      g.lineCap = 'round'; g.lineJoin = 'round';
      /* the ground */
      g.fillStyle = `hsl(${hue} 35% 22%)`;
      rr(g, gx - u * 2.6, gy, u * 7.6, u * 0.5, u * 0.25); g.fill();
      /* wood */
      g.strokeStyle = '#b98a58'; g.lineWidth = u * 0.34;
      g.beginPath(); g.moveTo(gx, gy); g.lineTo(gx, gy - u * 8); g.lineTo(gx + u * 3.6, gy - u * 8); g.stroke();
      g.lineWidth = u * 0.2;
      g.beginPath(); g.moveTo(gx, gy - u * 6.4); g.lineTo(gx + u * 1.6, gy - u * 8); g.stroke();
      g.strokeStyle = '#e8d3a6'; g.lineWidth = u * 0.1;
      g.beginPath(); g.moveTo(gx + u * 3.6, gy - u * 8); g.lineTo(gx + u * 3.6, gy - u * 7.2); g.stroke();
      figure(g, gx + u * 3.6, gy - u * 7.2, u, now);
      /* the word */
      const n = S.word.length;
      const slot = Math.max(16, Math.min(46, (W - 24) / Math.max(n, 6) - 6));
      const total = n * (slot + 6) - 6;
      let x = (W - total) / 2;
      const y = sceneH + wordH * 0.55;
      g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      g.font = `800 ${Math.round(slot * 0.95)}px ${FONT}`;
      for (const ch of S.word) {
        const shown = !S.paused && (S.right.includes(ch) || S.over === 'lose');
        g.fillStyle = S.right.includes(ch) ? '#8cf0b0' : '#ff9aa8';
        if (shown) g.fillText(ch.toUpperCase(), x + slot / 2, y);
        g.fillStyle = 'rgba(255,255,255,.55)';
        g.fillRect(x, y + 6, slot, 3);
        x += slot + 6;
      }
      /* misses */
      g.font = `600 ${Math.max(11, Math.round(u * 0.6))}px ${FONT}`;
      g.fillStyle = 'rgba(255,170,185,.9)';
      g.textAlign = 'right';
      g.fillText(S.wrong.length ? S.wrong.map(c => c.toUpperCase()).join(' ') : '', W - 14, 24);
      g.textAlign = 'left';
      g.fillStyle = 'rgba(255,255,255,.65)';
      g.fillText(`${MAX_WRONG - S.wrong.length} ${MAX_WRONG - S.wrong.length === 1 ? 'life' : 'lives'} left`, 14, 24);
      if (S.paused) {
        g.fillStyle = 'rgba(5,6,12,.72)'; g.fillRect(0, 0, W, H);
        g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = `700 ${Math.round(u)}px ${FONT}`; g.fillText('Paused', W / 2, H / 2);
      }
    }
    /* the little person: friendly, round-ended, one part per wrong guess */
    function figure(g, hx, hy, u, now) {
      const n = S.wrong.length, lose = S.over === 'lose', win = S.over === 'win';
      const grow = k => {
        if (k !== n - 1 || reduced) return 1;
        const t = Math.min(1, (now - S.pop) / 260);
        return 0.4 + 0.6 * (1 - (1 - t) ** 3);
      };
      let dy = 0, sway = 0;
      if (win && !reduced) dy = -Math.abs(Math.sin((now - S.t0) / 170)) * u * 0.5 * Math.max(0, 1 - (now - S.t0) / 1500);
      if (lose && !reduced) sway = Math.sin((now - S.t0) / 260) * 0.05 * Math.max(0, 1 - (now - S.t0) / 2200);
      if (!win && !lose && n === 0) {
        /* an empty noose */
        g.strokeStyle = '#e8d3a6'; g.lineWidth = u * 0.1;
        g.beginPath(); g.arc(hx, hy + u * 0.4, u * 0.4, 0, Math.PI * 2); g.stroke();
        return;
      }
      g.save();
      g.translate(hx, hy + dy);
      g.rotate(sway);
      const col = '#ffcf6b', line = '#fff1c9';
      g.strokeStyle = line; g.fillStyle = col; g.lineWidth = u * 0.3;
      const R = u * 0.85, cy = R + u * 0.1;
      if (n >= 1) {
        g.save(); g.translate(0, cy); g.scale(grow(0), grow(0));
        g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#3a2a14'; g.strokeStyle = '#3a2a14'; g.lineWidth = u * 0.1;
        if (lose) {
          for (const s of [-1, 1]) { g.beginPath(); g.moveTo(s * R * 0.5 - R * 0.17, -R * 0.35); g.lineTo(s * R * 0.5 + R * 0.17, -R * 0.05); g.moveTo(s * R * 0.5 + R * 0.17, -R * 0.35); g.lineTo(s * R * 0.5 - R * 0.17, -R * 0.05); g.stroke(); }
          g.beginPath(); g.arc(0, R * 0.55, R * 0.28, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
        } else {
          g.beginPath(); g.arc(-R * 0.4, -R * 0.2, R * 0.12, 0, Math.PI * 2); g.arc(R * 0.4, -R * 0.2, R * 0.12, 0, Math.PI * 2); g.fill();
          g.beginPath();
          if (n >= 4 && !win) g.arc(0, R * 0.62, R * 0.3, Math.PI * 1.15, Math.PI * 1.85);       /* worried */
          else g.arc(0, R * 0.12, R * 0.5, Math.PI * 0.15, Math.PI * 0.85);                       /* smiling */
          g.stroke();
          g.fillStyle = 'rgba(255,120,120,.45)';
          g.beginPath(); g.arc(-R * 0.68, R * 0.2, R * 0.16, 0, Math.PI * 2); g.arc(R * 0.68, R * 0.2, R * 0.16, 0, Math.PI * 2); g.fill();
        }
        g.restore();
      }
      g.lineWidth = u * 0.3; g.strokeStyle = col;
      const top = cy + R, hip = top + u * 2.1;
      const limb = (k, x0, y0, x1, y1) => {
        if (n <= k) return;
        const s = grow(k);
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + (x1 - x0) * s, y0 + (y1 - y0) * s); g.stroke();
      };
      limb(1, 0, top, 0, hip);
      const armY = top + u * 0.5, armUp = win ? -u * 1.1 : u * 0.9;
      limb(2, 0, armY, -u * 1.3, armY + armUp);
      limb(3, 0, armY, u * 1.3, armY + armUp);
      limb(4, 0, hip, -u * 1.0, hip + u * 1.7);
      limb(5, 0, hip, u * 1.0, hip + u * 1.7);
      g.restore();
    }

    /* ------------------------------ input ------------------------------ */
    const onKey = e => {
      if (!ownsKey(el, e) || dead || S.paused) return;
      if (e.key.length === 1 && /[a-zA-Z]/.test(e.key)) {
        if (e.target?.closest?.('button') && el.contains(e.target) === false) return;
        if (guess(e.key.toLowerCase())) e.preventDefault();
        else if (!S.over) e.preventDefault();      /* a letter already tried: P still must not pause */
      }
    };
    window.addEventListener('keydown', onKey);

    newWord();

    const api = {
      stop() {
        dead = true;
        clearTimeout(S.endT);
        loop.stop();
        window.removeEventListener('keydown', onKey);
        snd.close();
        sf.destroy();
        root.remove();
      },
      pause() { if (S.paused) return; S.paused = true; paint(); },
      resume() { if (!S.paused) return; S.paused = false; paint(); },
      /* a read-only snapshot for automated play-tests (it includes the answer) */
      peek: () => ({
        word: S.word, masked: masked(), right: S.right.slice(), wrong: S.wrong.slice(), parts: S.wrong.length, over: S.over, paused: S.paused,
        category: S.cat, wins: P.wins, losses: P.losses, streak: P.streak, bestStreak: P.bestStreak, ended: S.ended, words: pool().length,
        keys: [...keys.entries()].filter(([, b]) => b.disabled).map(([k]) => k).join(''),
      }),
      /* test hook — nothing in the game calls it: word(w) plays that word next */
      hook(cmd, arg) {
        if (cmd === 'word' && /^[a-z]{3,16}$/.test(arg)) { setWord(arg); return true; }
        return false;
      },
    };
    return api;
  },
};
