/* ============================================================
   codeshader.js — the shader playground in Static Code's preview.

   shaderPane({ h, icon, clear }) -> { el, show(text, reveal), pause(), resume(), dispose(), state }

   A fragment shader (.frag, .glsl) drawn with WebGL over the whole of
   its own canvas, redrawn every frame, recompiled as you type. GLSL
   runs on the graphics card and cannot reach the page, files or
   network; the canvas is the only thing it touches.

   What a shader gets, added in front of it (the uniforms only when it
   doesn't declare them itself):
     precision highp float;       (mediump where highp is missing)
     uniform float u_time;        seconds since it started (paused: held)
     uniform vec2  u_resolution;  the canvas in pixels
     uniform vec2  u_mouse;       the pointer in pixels, from bottom left
   A shader written the Shadertoy way — mainImage(out vec4, in vec2),
   iTime, iResolution, iMouse, iFrame — gets those and a main() too.
   "#version 300 es" on the first line asks for WebGL 2 (GLSL ES 3.00);
   then it declares its own out colour, as GLSL 3.00 needs.

   A compile error lists each message with the line of your file it is
   on (the lines added in front are counted out) and a button that
   goes there. While there are errors the last shader that compiled
   keeps running. The browser can stop a shader that takes too long
   (a lost context); the pane says so and starts again on the next edit.
   The frame rate shown is counted from frames actually drawn.
   ============================================================ */

const VERT1 = 'attribute vec2 a_pos;\nvoid main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }';
const VERT3 = '#version 300 es\nin vec2 a_pos;\nvoid main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }';

/** The source the GPU gets, and how many lines were put before line 1 of yours. */
export function buildShader(src) {
  const text = String(src || '');
  const lines = text.split('\n');
  const vi = lines.findIndex(l => l.trim());
  const v3 = vi >= 0 && /^\s*#version\s+300\s+es\b/.test(lines[vi]);
  const has = re => re.test(text);
  const toy = has(/\bvoid\s+mainImage\s*\(/) && !has(/\bvoid\s+main\s*\(\s*(void)?\s*\)/);
  const pre = [];
  /* always first: the uniforms below need it, and a shader's own precision line later still wins */
  pre.push('#ifdef GL_FRAGMENT_PRECISION_HIGH', 'precision highp float;', '#else', 'precision mediump float;', '#endif');
  const uni = (type, name) => { if (!has(new RegExp(`\\buniform\\s+\\w+\\s+${name}\\b`))) pre.push(`uniform ${type} ${name};`); };
  uni('float', 'u_time'); uni('vec2', 'u_resolution'); uni('vec2', 'u_mouse');
  if (toy || has(/\biTime\b|\biResolution\b|\biMouse\b/)) { uni('float', 'iTime'); uni('vec3', 'iResolution'); uni('vec4', 'iMouse'); uni('int', 'iFrame'); }
  if (toy && v3) pre.push('out vec4 staticos_FragColor;');
  const post = toy ? (v3 ? ['void main(){ mainImage(staticos_FragColor, gl_FragCoord.xy); }'] : ['void main(){ mainImage(gl_FragColor, gl_FragCoord.xy); }']) : [];
  let out, shift;
  if (v3) {
    out = [...lines.slice(0, vi + 1), ...pre, ...lines.slice(vi + 1), ...post].join('\n');
    shift = { after: vi + 1, by: pre.length };
  } else {
    out = [...pre, ...lines, ...post].join('\n');
    shift = { after: 0, by: pre.length };
  }
  return { source: out, v3, shift, userLines: lines.length };
}

/** "ERROR: 0:14: 'x' : undeclared identifier" lines → [{ line (in your file), text }] */
export function parseLog(log, shift, userLines) {
  const out = [];
  for (const raw of String(log || '').split('\n')) {
    const l = raw.trim();
    if (!l) continue;
    const m = /^(?:ERROR|WARNING):\s*\d+:(\d+):\s*(.*)$/.exec(l);
    if (!m) { out.push({ line: null, text: l.replace(/^ERROR:\s*/, '') }); continue; }
    let n = Number(m[1]);
    if (n > shift.after) n -= shift.by;
    if (n > userLines) out.push({ line: null, text: `In the main() Code adds for mainImage: ${m[2]}` });
    else out.push({ line: Math.max(1, n), text: m[2] });
  }
  return out;
}

export function shaderPane({ h, icon, clear }) {
  const status = h('span.cpy__status', { role: 'status', 'aria-live': 'polite', text: '' });
  const fps = h('span.csd__fps', { 'aria-hidden': 'true' });
  const playBtn = h('button.ibtn.tip', { type: 'button', 'data-tip': 'Pause', 'aria-label': 'Pause the shader', onclick: () => (S.paused ? resume() : pause(true)) }, icon('pause'));
  const restartBtn = h('button.ibtn.tip', { type: 'button', 'data-tip': 'Start the clock again', 'aria-label': 'Start the clock again', onclick: () => { S.t0 = performance.now(); S.held = 0; S.frame = 0; if (S.paused) draw(); } }, icon('rotate-ccw'));
  const stage = h('div.csd__stage');
  const errs = h('div.csd__errs', { role: 'alert', hidden: true });
  const note = h('p.cpy__note', { text: 'Your shader runs on the graphics card, in this canvas only. u_time is seconds, u_resolution the canvas size in pixels, u_mouse the pointer. Shadertoy-style mainImage() works too.' });
  const el = h('div.cpy.csd', h('div.cpy__head', icon('sparkles'), h('b', { text: 'Shader' }), status, h('div.grow'), fps, restartBtn, playBtn), stage, errs, note);

  const S = {
    canvas: null, gl: null, v3: null, prog: null, loc: null, buf: null,
    src: null, raf: 0, t0: performance.now(), held: 0, frame: 0, paused: false, hidden: true, dead: false, lost: false,
    mouse: [0, 0], click: [0, 0, 0, 0], frames: [], reveal: null, errors: 0,
  };

  const setStatus = t => { status.textContent = t; };

  function makeCanvas(v3) {
    S.canvas?.remove();
    const c = h('canvas.csd__canvas', { 'aria-label': 'Shader output' });
    stage.appendChild(c);
    const opts = { antialias: false, preserveDrawingBuffer: true, premultipliedAlpha: false };
    const gl = v3 ? c.getContext('webgl2', opts) : (c.getContext('webgl', opts) || c.getContext('experimental-webgl', opts));
    S.canvas = c; S.gl = gl; S.v3 = v3; S.prog = null; S.buf = null;
    if (!gl) return false;
    c.addEventListener('webglcontextlost', e => { e.preventDefault(); S.lost = true; stopLoop(); setStatus('Stopped'); showErrors([{ line: null, text: 'The browser stopped this shader: it took too long to draw a frame (or the graphics card was needed elsewhere). Edit it to start again.' }]); });
    c.addEventListener('webglcontextrestored', () => { S.lost = false; S.prog = null; S.buf = null; compile(S.src, true); });
    const pos = e => { const r = c.getBoundingClientRect(); const k = c.width / Math.max(1, r.width); return [(e.clientX - r.left) * k, (r.bottom - e.clientY) * k]; };
    c.addEventListener('pointermove', e => { S.mouse = pos(e); if (e.buttons & 1) { S.click[0] = S.mouse[0]; S.click[1] = S.mouse[1]; } if (S.paused) draw(); });
    c.addEventListener('pointerdown', e => { const p = pos(e); S.mouse = p; S.click = [p[0], p[1], p[0], p[1]]; });
    c.addEventListener('pointerup', () => { S.click[2] = -Math.abs(S.click[2]); S.click[3] = -Math.abs(S.click[3]); });
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    S.buf = buf;
    fit();
    return true;
  }

  function fit() {
    const c = S.canvas;
    if (!c) return;
    const r = stage.getBoundingClientRect();
    const k = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * k)), hh = Math.max(1, Math.round(r.height * k));
    if (c.width !== w || c.height !== hh) { c.width = w; c.height = hh; if (S.paused) draw(); }
  }
  const ro = new ResizeObserver(() => fit());
  ro.observe(stage);
  /* out of sight (a minimised window, another pane): no drawing until it is back */
  let seen = true;
  const io = new IntersectionObserver(es => {
    seen = es.some(e => e.isIntersecting);
    if (!seen) stopLoop(); else loop();
  });
  io.observe(stage);

  function shaderOf(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(sh) || 'It didn’t compile.'; gl.deleteShader(sh); return { log }; }
    return { sh };
  }

  function showErrors(list) {
    errs.hidden = !list.length;
    clear(errs);
    for (const e of list) {
      errs.append(h('div.cpv__row.cpv__row--error', icon('x-circle'), h('span.cpv__x', { text: e.line ? `Line ${e.line}: ${e.text}` : e.text }),
        e.line && S.reveal ? h('button.cpv__go', { type: 'button', title: `Show line ${e.line} in the editor`, 'aria-label': `Go to line ${e.line}`, onclick: () => S.reveal(e.line) }, h('span', { text: `line ${e.line}` })) : null));
    }
  }

  /** Compile src; on success it replaces the running program. */
  function compile(src, force = false) {
    if (S.dead) return;
    if (!force && src === S.src && S.prog) return;
    S.src = src;
    const b = buildShader(src);
    if (!S.gl || S.v3 !== b.v3 || S.gl.isContextLost?.()) {
      if (!makeCanvas(b.v3)) {
        setStatus('WebGL is off');
        showErrors([{ line: null, text: b.v3 ? 'This browser has no WebGL 2, which "#version 300 es" needs. Take that line out to use WebGL 1.' : 'This browser has WebGL turned off or doesn’t have it, so shaders can’t be drawn here.' }]);
        return;
      }
    }
    const gl = S.gl;
    const vs = shaderOf(gl, gl.VERTEX_SHADER, b.v3 ? VERT3 : VERT1);
    const fs = shaderOf(gl, gl.FRAGMENT_SHADER, b.source);
    if (fs.log || vs.log) {
      const list = parseLog(fs.log || vs.log, b.shift, b.userLines);
      S.errors = list.length;
      showErrors(list);
      setStatus(`${list.length} error${list.length === 1 ? '' : 's'}${S.prog ? ' · showing the last version that worked' : ''}`);
      if (vs.sh) gl.deleteShader(vs.sh);
      if (fs.sh) gl.deleteShader(fs.sh);
      return;
    }
    const p = gl.createProgram();
    gl.attachShader(p, vs.sh); gl.attachShader(p, fs.sh);
    gl.bindAttribLocation(p, 0, 'a_pos');
    gl.linkProgram(p);
    gl.deleteShader(vs.sh); gl.deleteShader(fs.sh);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const list = [{ line: null, text: gl.getProgramInfoLog(p) || 'It compiled but didn’t link.' }];
      gl.deleteProgram(p);
      S.errors = 1;
      showErrors(list);
      setStatus(`1 error${S.prog ? ' · showing the last version that worked' : ''}`);
      return;
    }
    if (S.prog) gl.deleteProgram(S.prog);
    S.prog = p;
    const u = n => gl.getUniformLocation(p, n);
    S.loc = { time: u('u_time'), res: u('u_resolution'), mouse: u('u_mouse'), iTime: u('iTime'), iRes: u('iResolution'), iMouse: u('iMouse'), iFrame: u('iFrame') };
    S.errors = 0;
    showErrors([]);
    setStatus(S.paused ? 'Paused' : 'Running');
    if (S.paused) draw(); else loop();
  }

  const now = () => (S.paused ? S.held : (performance.now() - S.t0) / 1000);

  function draw() {
    const gl = S.gl;
    if (!gl || !S.prog || S.lost) return;
    fit();
    gl.viewport(0, 0, S.canvas.width, S.canvas.height);
    gl.useProgram(S.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, S.buf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const t = now(), L = S.loc;
    if (L.time) gl.uniform1f(L.time, t);
    if (L.res) gl.uniform2f(L.res, S.canvas.width, S.canvas.height);
    if (L.mouse) gl.uniform2f(L.mouse, S.mouse[0], S.mouse[1]);
    if (L.iTime) gl.uniform1f(L.iTime, t);
    if (L.iRes) gl.uniform3f(L.iRes, S.canvas.width, S.canvas.height, 1);
    if (L.iMouse) gl.uniform4f(L.iMouse, S.click[0], S.click[1], S.click[2], S.click[3]);
    if (L.iFrame) gl.uniform1i(L.iFrame, S.frame);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    S.frame++;
  }

  function tick() {
    S.raf = 0;
    if (S.dead || S.paused || S.hidden || !seen) return;
    draw();
    const t = performance.now();
    S.frames.push(t);
    while (S.frames.length && t - S.frames[0] > 1000) S.frames.shift();
    if (S.frames.length > 5) fps.textContent = `${S.frames.length} fps`;
    S.raf = requestAnimationFrame(tick);
  }
  function loop() { if (!S.raf && !S.paused && !S.hidden && !S.dead && seen && S.prog) S.raf = requestAnimationFrame(tick); }
  function stopLoop() { if (S.raf) cancelAnimationFrame(S.raf); S.raf = 0; S.frames = []; fps.textContent = ''; }

  function pause(byHand = false) {
    if (byHand) {
      S.held = now();
      S.paused = true;
      playBtn.dataset.tip = 'Play'; playBtn.setAttribute('aria-label', 'Play the shader');
      clear(playBtn); playBtn.append(icon('play'));
      if (S.prog && !S.errors) setStatus('Paused');
    }
    stopLoop();
  }
  function resume() {
    if (S.paused) {
      S.paused = false;
      S.t0 = performance.now() - S.held * 1000;
      playBtn.dataset.tip = 'Pause'; playBtn.setAttribute('aria-label', 'Pause the shader');
      clear(playBtn); playBtn.append(icon('pause'));
      if (S.prog && !S.errors) setStatus('Running');
    }
    loop();
  }

  return {
    el,
    /** The shader file is in view (or changed): compile it and draw. */
    show(text, reveal) { S.reveal = reveal || null; S.hidden = false; if (S.lost) { S.lost = false; S.gl = null; } compile(text); loop(); },
    /** Out of view: stop drawing (the GPU rests), keep the program. */
    hide() { S.hidden = true; stopLoop(); },
    pause, resume,
    get state() { return { paused: S.paused, errors: S.errors, running: !!S.raf, frame: S.frame, webgl: S.v3 ? 2 : S.gl ? 1 : 0 }; },
    dispose() {
      S.dead = true;
      stopLoop();
      ro.disconnect();
      io.disconnect();
      try { S.gl?.getExtension('WEBGL_lose_context')?.loseContext(); } catch (e) { /* already gone */ }
      S.canvas?.remove();
    },
  };
}

export default { shaderPane, buildShader, parseLog };
