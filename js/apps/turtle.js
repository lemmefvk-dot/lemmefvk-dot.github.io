/* ============================================================
   turtle.js — Turtle: learn to code by drawing.

   Type a few words, press Run, and a turtle walks the picture: forward 100,
   right 90, repeat 4 […]. The words are a small Logo-style language that
   this app reads itself (js/core/turtlelang.js): it is an interpreter, not
   eval, so a program can draw and do sums and nothing else, and a loop that
   never ends is stopped with a message that names the line.

   Six lessons walk from "move" to "make your own word". Each has a
   starter you can load, a challenge, and a tick that is earned: the lesson
   is checked against what your program really drew (a closed shape, a
   repeat, a colour, a procedure called twice…), not against a button.
   Progress and your program are kept (store key 'portal.turtle').

   Run: Ctrl+Enter (or Cmd+Enter) from the editor.  Save picture writes a PNG
   to ~/Pictures/Turtle; Save program writes a .logo text file to
   ~/Documents/Turtle. Drawing speed is Instant, Fast or Slow; with Reduce
   motion on it is always Instant.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { runTurtle, COLOURS } from '../core/turtlelang.js';
import { saveBlob } from '../photos/pt-common.js';
import { makerCss, blobOf, stemName } from '../core/makerkit.js';

makerCss();
const KEY = 'portal.turtle';
const SIZE = 600;

export const LESSONS = [
  { id: 'move', title: '1. Walk and turn',
    intro: 'The turtle starts in the middle, facing up. forward 100 walks 100 steps. right 90 turns it a quarter turn clockwise. Put them together and the turtle leaves a line behind it.',
    task: 'Draw a square: four times forward 100, each followed by right 90.',
    code: 'forward 100\nright 90\nforward 100\nright 90\n',
    check: r => r.stats.closed && r.stats.lines >= 4 && r.stats.repeats === 0, hint: 'Four lines that come back to where you began. Write each one out, without repeat for now.' },
  { id: 'repeat', title: '2. Say it once: repeat',
    intro: 'Writing the same two words four times is tiring. repeat 4 [ … ] does whatever is inside the brackets four times.',
    task: 'Draw the same square with repeat 4 [forward 100 right 90]. Then try repeat 3 with right 120. What do you get?',
    code: 'repeat 4 [forward 100 right 90]\n',
    check: r => r.stats.closed && r.stats.repeats >= 1 && r.stats.lines >= 3, hint: 'The shape has to close: after the repeat the turtle should be back where it started.' },
  { id: 'colour', title: '3. Colour and width',
    intro: 'color red changes the pen. width 6 makes it thicker. hue 200 picks a colour by its place on the colour wheel (0 to 360). Colours stay until you change them.',
    task: 'Draw a triangle in one colour, then a square in another.',
    code: 'color red\nwidth 5\nrepeat 3 [forward 100 right 120]\ncolor blue\nrepeat 4 [forward 60 right 90]\n',
    check: r => r.stats.colours >= 3 && r.stats.lines >= 7, hint: 'Use color at least twice, so the picture has two colours besides the black you started with.' },
  { id: 'vars', title: '4. Numbers with names',
    intro: 'make "size 80 gives the number 80 the name size. Then :size means 80 wherever you write it. Change that one line and the whole picture changes.',
    task: 'Make a square whose side is :size. Run it at 40, then at 120.',
    code: 'make "size 80\nrepeat 4 [forward :size right 90]\n',
    check: r => r.stats.vars >= 1 && r.stats.closed && r.stats.repeats >= 1, hint: 'You need make "size …, a repeat, and :size inside it.' },
  { id: 'proc', title: '5. Teach the turtle a word',
    intro: 'to square :side … end teaches the turtle a new word. After that, square 50 does everything inside. The :side is a blank the word takes when you use it.',
    task: 'Define your own word and use it at least twice, with different numbers.',
    code: 'to square :side\n  repeat 4 [forward :side right 90]\nend\n\nsquare 40\nsquare 80\nsquare 120\n',
    check: r => r.stats.procs >= 1 && r.stats.calls >= 2 && r.stats.lines >= 8, hint: 'Start with `to name :input`, finish with `end`, then call it twice below.' },
  { id: 'spiral', title: '6. Patterns',
    intro: 'Turn a little after each shape and the shapes fan out into a flower. Make a word, repeat it, and let the numbers change as it goes: make "n :n + 5 adds 5 each time.',
    task: 'Make a pattern of at least 30 shapes or lines. Change the numbers and see what appears.',
    code: 'to petal\n  repeat 2 [forward 60 right 60 forward 60 right 120]\nend\n\nhue 300\nrepeat 18 [petal right 20]\n',
    check: r => r.stats.lines >= 36 && r.stats.procs >= 1 && r.stats.repeats >= 2, hint: 'A word, a repeat that uses it, and at least 36 lines drawn in all.' },
];

const START = 'color teal\nwidth 3\nrepeat 36 [\n  forward 120\n  right 100\n]\n';

defineApp({
  id: 'turtle',
  name: 'Turtle',
  icon: 'code',
  g1: '#5fd6a4', g2: '#1f8a70',
  category: 'Create',
  keywords: ['turtle', 'logo', 'learn to code', 'coding', 'programming', 'lessons', 'draw with code', 'repeat', 'kids', 'procedures', 'beginner'],
  desc: 'Learn to code by steering a turtle, with lessons',
  singleton: true,
  win: { w: 980, h: 700, minW: 640, minH: 480 },
  shortcuts: [['Ctrl+Enter', 'Run the program'], ['Esc', 'Stop the drawing']],

  mount(ctx) {
    const { root, win, api } = ctx;
    const { h, icon, store, vfs } = api;

    const saved = store.get(KEY) || {};
    const done = new Set(Array.isArray(saved.done) ? saved.done.filter(id => LESSONS.some(l => l.id === id)) : []);
    let lesson = LESSONS.some(l => l.id === saved.lesson) ? saved.lesson : null;
    let result = null, anim = 0, timer = 0, dead = false, shown = 0;
    const persist = () => { if (!dead) store.set(KEY, { v: 1, code: ed.value.slice(0, 20000), lesson, done: [...done] }); };
    const later = () => { clearTimeout(timer); timer = setTimeout(persist, 500); };

    const ed = h('textarea.mk-code', { spellcheck: 'false', 'aria-label': 'Turtle program', wrap: 'off', value: typeof saved.code === 'string' ? saved.code : START, oninput: () => { later(); } });
    ed.value = typeof saved.code === 'string' ? saved.code : START;
    const cv = h('canvas.mk-turtle__cv', { width: SIZE, height: SIZE, role: 'img', 'aria-label': 'What the turtle drew' });
    const out = h('div.mk-out-log', { role: 'status', 'aria-live': 'polite' });
    const msg = h('small.mk-msg', { role: 'status', 'aria-live': 'polite' });
    const say = t => { msg.textContent = t; };

    /* ---------- drawing the result ---------- */
    function draw(count) {
      const g = cv.getContext('2d'), r = result;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = r && r.bg ? r.bg : '#ffffff'; g.fillRect(0, 0, SIZE, SIZE);
      g.strokeStyle = 'rgba(0,0,0,.06)'; g.lineWidth = 1;
      g.beginPath(); for (let i = 0; i <= SIZE; i += 50) { g.moveTo(i, 0); g.lineTo(i, SIZE); g.moveTo(0, i); g.lineTo(SIZE, i); } g.stroke();
      if (!r) return;
      g.translate(SIZE / 2, SIZE / 2); g.lineCap = g.lineJoin = 'round';
      const upTo = count == null ? r.segments.length : r.trail[Math.min(count, r.trail.length - 1)].n;
      for (let i = 0; i < upTo; i++) {
        const s = r.segments[i];
        g.strokeStyle = s.color; g.lineWidth = s.width;
        g.beginPath(); g.moveTo(s.x1, -s.y1); g.lineTo(s.x2, -s.y2); g.stroke();
      }
      const t = count == null ? r.turtle : r.trail[Math.min(count, r.trail.length - 1)];
      if (r.turtle.visible) {
        g.save(); g.translate(t.x, -t.y); g.rotate(t.heading * Math.PI / 180);
        g.fillStyle = '#30a46c'; g.strokeStyle = '#0f5132'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(0, -12); g.lineTo(8, 9); g.lineTo(0, 5); g.lineTo(-8, 9); g.closePath(); g.fill(); g.stroke();
        g.restore();
      }
    }
    const reduced = () => { try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !!store.get('prefs')?.reduceMotion; } catch (e) { return false; } };
    function stopAnim() { if (anim) { cancelAnimationFrame(anim); anim = 0; } stopBtn.hidden = true; runBtn.hidden = false; }
    function play() {
      const r = result, speed = speedSel.value;
      stopAnim();
      if (speed === 'instant' || reduced() || r.trail.length < 3) return draw();
      const per = speed === 'fast' ? Math.max(1, Math.ceil(r.trail.length / 90)) : Math.max(1, Math.ceil(r.trail.length / 360));
      shown = 0; stopBtn.hidden = false; runBtn.hidden = true;
      const step = () => {
        shown = Math.min(r.trail.length - 1, shown + per);
        draw(shown);
        if (shown >= r.trail.length - 1) { stopAnim(); draw(); return; }
        anim = requestAnimationFrame(step);
      };
      anim = requestAnimationFrame(step);
    }

    /* ---------- running ---------- */
    function run() {
      stopAnim();
      result = runTurtle(ed.value);
      persist();
      out.replaceChildren();
      for (const t of result.output.slice(0, 200)) out.appendChild(h('div', { text: t }));
      if (result.error) {
        out.appendChild(h('div.mk-err', { text: `Line ${result.error.line}: ${result.error.message}` }));
        ed.dataset.errorLine = String(result.error.line);
        say(`Something to fix on line ${result.error.line}.` + (result.segments.length ? ' The drawing shows what ran before it.' : ''));
      } else {
        delete ed.dataset.errorLine;
        say(`Drew ${result.stats.lines} line${result.stats.lines === 1 ? '' : 's'}.`);
      }
      play();
      lessonCheck();
    }
    function lessonCheck() {
      const l = LESSONS.find(x => x.id === lesson);
      if (!l || !result || result.error) return;
      if (l.check(result) && !done.has(l.id)) {
        done.add(l.id); persist(); paintLessons();
        say(`Lesson ${l.title.split('.')[0]} done. ${done.size === LESSONS.length ? 'That was all six. Now make anything you like.' : 'Pick the next one when you are ready.'}`);
      } else if (!l.check(result) && !done.has(l.id)) say(`Not there yet. ${l.hint}`);
    }

    /* ---------- lessons ---------- */
    const lessonBox = h('div.mk-lesson');
    const picker = h('div.mk-lessons', { role: 'tablist', 'aria-label': 'Lessons' });
    function paintLessons() {
      picker.replaceChildren(h('button.mk-lt', { type: 'button', role: 'tab', 'aria-selected': String(lesson === null), class: lesson === null ? 'is-on' : null, onclick: () => pickLesson(null) }, h('span', { text: 'Free draw' })),
        ...LESSONS.map(l => h('button.mk-lt', { type: 'button', role: 'tab', 'aria-selected': String(l.id === lesson), class: l.id === lesson ? 'is-on' : null, dataset: { lesson: l.id },
          'aria-label': `${l.title}${done.has(l.id) ? ', done' : ''}`, onclick: () => pickLesson(l.id) }, h('span', { text: l.title }), done.has(l.id) ? icon('check') : null)));
      const l = LESSONS.find(x => x.id === lesson);
      lessonBox.hidden = !l;
      if (l) lessonBox.replaceChildren(h('b', { text: l.title }), h('p', { text: l.intro }), h('p.mk-task', { text: 'Your turn: ' + l.task }),
        h('div.mk-row', h('button.btn.btn--sm', { type: 'button', onclick: () => { ed.value = l.code; persist(); say('Starter loaded. Press Run.'); ed.focus(); } }, icon('download'), h('span', { text: 'Load the starter' })),
          done.has(l.id) ? h('small.mk-ok', { text: 'Done' }) : null));
    }
    function pickLesson(id) { lesson = id; paintLessons(); persist(); }

    /* ---------- saving ---------- */
    async function savePicture() {
      try {
        if (!result) run();
        const blob = await blobOf(cv);
        const path = await saveBlob(api, 'Turtle', `${vfs.HOME}/Pictures/Turtle`, 'Turtle drawing.png', blob, { title: 'Picture saved', icon: 'code' });
        say(`Saved ${path.split('/').pop()}.`);
      } catch (err) { say('Couldn’t save the picture: ' + err.message); }
    }
    function saveProgram() {
      const dir = `${vfs.HOME}/Documents/Turtle`;
      if (!vfs.mkdir(`${vfs.HOME}/Documents`) || !vfs.mkdir(dir)) return say('Couldn’t make the Turtle folder in Documents.');
      const base = stemName(nameIn.value, 'My drawing');
      let name = `${base}.logo`, n = 2;
      while (vfs.node(`${dir}/${name}`)) name = `${base} ${n++}.logo`;
      vfs.write(`${dir}/${name}`, ed.value);
      api.notify({ app: 'Turtle', icon: 'code', title: 'Program saved', message: name, actions: [{ label: 'Show in Files', onClick: () => api.openApp('files', { path: `${dir}/${name}` }) }] });
      say(`Saved ${name} in Documents/Turtle.`);
    }

    const btn = (label, ic, fn, extra = {}) => h('button.btn.btn--sm', { type: 'button', onclick: fn, ...extra }, ic ? icon(ic) : null, h('span', { text: label }));
    const runBtn = btn('Run', 'play', run, { class: 'btn--primary', title: 'Run (Ctrl+Enter)' });
    const stopBtn = btn('Skip ahead', 'skip-forward', () => { stopAnim(); draw(); }, { hidden: true, title: 'Finish the drawing now (Esc)' });
    const speedSel = h('select', { 'aria-label': 'Drawing speed' }, h('option', { value: 'fast', text: 'Fast' }), h('option', { value: 'slow', text: 'Slow' }), h('option', { value: 'instant', text: 'Instant' }));
    const nameIn = h('input', { type: 'text', value: 'My drawing', maxlength: '40', 'aria-label': 'Program name' });
    const ref = h('details.mk-ref', h('summary', { text: 'All the words' }), h('pre', { text: [
      'forward n    back n    left n    right n',
      'penup   pendown   home   setxy x y   setheading n',
      'color name   (' + Object.keys(COLOURS).filter(c => c !== 'gray').join(' ') + ')',
      'color #ff8800     hue 0-360     width n',
      'circle r    dot size    hideturtle   showturtle',
      'clear    background name',
      'repeat n [ … ]    if test [ … ]    ifelse test [ … ] [ … ]',
      'make "name value      :name      print value',
      'to word :a :b … end',
      'sums:  + - * / %   ( )   < > = <= >=',
      'random n   sqrt n   sin n   cos n   abs n   round n',
      '; starts a comment'].join('\n') }));

    root.classList.add('mk');
    root.replaceChildren(
      picker, lessonBox,
      h('div.mk-main.mk-main--turtle',
        h('div.mk-side.mk-side--code',
          ed,
          h('div.mk-row', runBtn, stopBtn, h('label.mk-lbl', 'Speed', speedSel), btn('Clear', 'x', () => { ed.value = ''; result = null; draw(); out.replaceChildren(); persist(); ed.focus(); })),
          out, ref),
        h('div.mk-stage', h('div.mk-paper.mk-paper--sq', cv),
          h('div.mk-row', btn('Save picture', 'image', savePicture), h('label.mk-lbl', 'Name', nameIn), btn('Save program', 'save', saveProgram)), msg)));

    const onKey = e => {
      if (!win.el.classList.contains('is-active')) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); }
      else if (e.key === 'Escape' && anim) { e.preventDefault(); stopAnim(); draw(); }
    };
    window.addEventListener('keydown', onKey);

    paintLessons(); draw();
    return () => { dead = true; stopAnim(); clearTimeout(timer); store.set(KEY, { v: 1, code: ed.value.slice(0, 20000), lesson, done: [...done] }); window.removeEventListener('keydown', onKey); };
  },
});
