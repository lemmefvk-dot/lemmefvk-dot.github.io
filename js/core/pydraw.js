/* ============================================================
   pydraw.js — `draw`, the little drawing module Python gets in Code.

   Pyodide's turtle and matplotlib can't run here (no Tk, no packages
   from a CDN), so Code has its own: lines, circles, rectangles, dots,
   polygons and text in colours, on a canvas beside the program's
   output. DRAW_PY is the module's Python source; core/pyrun.js puts
   it in the sealed worker's file system, where `import draw` finds it
   (a draw.py of your own in the project wins). Each call becomes a
   small JSON command; the worker sends them to the page in batches,
   and paint() here draws them. Nothing else crosses: the commands are
   numbers, colour strings and text, and text is drawn with fillText,
   never as HTML.

   x goes right and y goes down from the top-left corner, in pixels.
   ============================================================ */

/* every CSS colour name, so a typo is an error rather than nothing drawn */
const NAMES = `aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown
burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod
darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen
darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue
firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew
hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan
lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray
lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid
mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream
mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen
paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown
royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow
springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen transparent`;

export const DRAW_PY = `"""Draw on the canvas beside the output.

    from draw import *
    canvas(400, 300, "white")
    circle(200, 150, 50, fill="gold")
    line(0, 0, 400, 300, colour="blue", thickness=3)
    text(20, 30, "Hello!", size=20)

x goes right and y goes down from the top-left corner, in pixels.
Colours are names ("red", "skyblue"), codes ("#ff8800") or (r, g, b).
A shape with fill= is filled; give it colour= too for an outline.
"""
import json as _json
import math as _math
import re as _re
import time as _time
import js as _js

__all__ = ["canvas", "clear", "background", "colour", "color", "fill", "no_fill", "thickness",
           "line", "circle", "rect", "dot", "polygon", "text", "show", "sleep", "size"]

_NAMES = set("""${NAMES}""".split())
_s = {"w": 400, "h": 300, "pen": "black", "fill": None, "thick": 2.0, "on": False}


def _colour(c):
    if c is None:
        return None
    if isinstance(c, (tuple, list)) and len(c) in (3, 4) and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in c):
        r, g, b = (max(0, min(255, int(v))) for v in c[:3])
        if len(c) == 4:
            return "rgba(%d,%d,%d,%s)" % (r, g, b, max(0.0, min(1.0, float(c[3]))))
        return "rgb(%d,%d,%d)" % (r, g, b)
    if isinstance(c, str):
        t = c.strip().lower().replace(" ", "")
        if t in _NAMES or _re.fullmatch(r"#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})", t):
            return t
    raise ValueError("%r isn't a colour draw knows: use a name like \\"red\\", a code like \\"#ff8800\\" or (255, 136, 0)" % (c,))


def _num(v, name):
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        raise TypeError("%s should be a number, not %s" % (name, type(v).__name__))
    v = float(v)
    if not _math.isfinite(v):
        raise ValueError("%s should be a real number, not %s" % (name, v))
    return v


def _go(*cmd):
    if not _s["on"]:
        _s["on"] = True
        _js.__staticos_draw(_json.dumps(["size", _s["w"], _s["h"], "white"]))
    _js.__staticos_draw(_json.dumps(cmd))


def _pen(colour, color):
    return _colour(colour if colour is not None else color)


def canvas(width=400, height=300, background="white"):
    """Start a fresh canvas this size (in pixels), painted one colour."""
    w, h = int(_num(width, "width")), int(_num(height, "height"))
    if not (10 <= w <= 1600 and 10 <= h <= 1200):
        raise ValueError("the canvas can be 10 to 1600 pixels wide and 10 to 1200 high")
    _s.update(w=w, h=h, on=True)
    _js.__staticos_draw(_json.dumps(["size", w, h, _colour(background)]))


def clear(colour="white"):
    """Paint the whole canvas one colour."""
    _go("clear", _colour(colour))


background = clear


def colour(c):
    """The colour lines, outlines and text use from now on."""
    _s["pen"] = _colour(c)


color = colour


def fill(c):
    """The colour shapes are filled with from now on."""
    _s["fill"] = _colour(c)


def no_fill():
    """Shapes are drawn as outlines from now on."""
    _s["fill"] = None


def thickness(px):
    """How thick lines and outlines are, in pixels."""
    _s["thick"] = max(0.1, _num(px, "thickness"))


def _style(colour, color, fill_, thick):
    pen = _pen(colour, color)
    fl = _colour(fill_) if fill_ is not None else _s["fill"]
    if pen is None and fill_ is None:
        pen = _s["pen"]
    w = _s["thick"] if thick is None else max(0.0, _num(thick, "thickness"))
    return pen, fl, w


def line(x1, y1, x2, y2, colour=None, thickness=None, color=None):
    """A straight line from (x1, y1) to (x2, y2)."""
    pen = _pen(colour, color) or _s["pen"]
    w = _s["thick"] if thickness is None else max(0.1, _num(thickness, "thickness"))
    _go("line", _num(x1, "x1"), _num(y1, "y1"), _num(x2, "x2"), _num(y2, "y2"), pen, w)


def circle(x, y, radius, colour=None, fill=None, thickness=None, color=None):
    """A circle centred on (x, y)."""
    pen, fl, w = _style(colour, color, fill, thickness)
    _go("circle", _num(x, "x"), _num(y, "y"), abs(_num(radius, "radius")), pen, fl, w)


def rect(x, y, width, height, colour=None, fill=None, thickness=None, color=None):
    """A rectangle with its top-left corner at (x, y)."""
    pen, fl, w = _style(colour, color, fill, thickness)
    _go("rect", _num(x, "x"), _num(y, "y"), _num(width, "width"), _num(height, "height"), pen, fl, w)


def dot(x, y, size=4, colour=None, color=None):
    """A filled dot at (x, y)."""
    _go("dot", _num(x, "x"), _num(y, "y"), abs(_num(size, "size")), _pen(colour, color) or _s["pen"])


def polygon(points, colour=None, fill=None, thickness=None, color=None):
    """A shape through a list of points: polygon([(10, 10), (90, 10), (50, 80)])."""
    pts = []
    for i, p in enumerate(points):
        if not isinstance(p, (tuple, list)) or len(p) != 2:
            raise TypeError("point %d should be (x, y)" % (i + 1))
        pts.append([_num(p[0], "x"), _num(p[1], "y")])
    if len(pts) < 2:
        raise ValueError("a polygon needs at least two points")
    pen, fl, w = _style(colour, color, fill, thickness)
    _go("poly", pts[:2000], pen, fl, w)


def text(x, y, words, colour=None, size=16, color=None):
    """Words with their top-left corner at (x, y)."""
    _go("text", _num(x, "x"), _num(y, "y"), str(words)[:500], _pen(colour, color) or _s["pen"], max(4.0, min(200.0, _num(size, "size"))))


def show():
    """Draw everything so far now (for animations)."""
    _js.__staticos_draw_flush()


def sleep(seconds):
    """Show what is drawn, then wait: clear(), draw, sleep(0.05) makes an animation."""
    show()
    _time.sleep(max(0.0, _num(seconds, "seconds")))


def size():
    """The canvas's (width, height)."""
    return (_s["w"], _s["h"])
`;

const MAX_QUEUE = 60000;   /* commands waiting to be drawn; past this the oldest go (see paint) */
const PER_FRAME = 20000;

/** A canvas that draws the commands a program sends. */
export function drawBoard({ h }) {
  const canvas = h('canvas.cpy__canvas', { width: 400, height: 300, role: 'img', 'aria-label': 'What the program drew' });
  const label = h('small.cpy__drawsize');
  const el = h('div.cpy__draw', { hidden: true }, canvas, label);
  const ctx = canvas.getContext('2d');
  const S = { q: [], raf: 0, dead: false, count: 0 };

  const ok = v => typeof v === 'number' && Number.isFinite(v);
  const colourOk = c => typeof c === 'string' && c.length < 40 && /^(#[0-9a-f]{3,8}|rgba?\([\d.,]+\)|[a-z]+)$/.test(c);

  function exec(c) {
    if (!Array.isArray(c)) return;
    const [k] = c;
    if (k === 'size') {
      const w = Math.max(10, Math.min(1600, c[1] | 0)), hh = Math.max(10, Math.min(1200, c[2] | 0));
      canvas.width = w; canvas.height = hh;
      label.textContent = `${w} × ${hh}`;
      el.hidden = false;
      if (colourOk(c[3])) { ctx.fillStyle = c[3]; ctx.fillRect(0, 0, w, hh); }
      return;
    }
    el.hidden = false;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const stroke = (pen, w) => { if (colourOk(pen) && w > 0) { ctx.strokeStyle = pen; ctx.lineWidth = w; ctx.stroke(); } };
    const fill = f => { if (colourOk(f)) { ctx.fillStyle = f; ctx.fill(); } };
    if (k === 'clear' && colourOk(c[1])) { ctx.fillStyle = c[1]; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    else if (k === 'line' && [1, 2, 3, 4, 6].every(i => ok(c[i]))) { ctx.beginPath(); ctx.moveTo(c[1], c[2]); ctx.lineTo(c[3], c[4]); stroke(c[5], c[6]); }
    else if (k === 'circle' && [1, 2, 3, 6].every(i => ok(c[i]))) { ctx.beginPath(); ctx.arc(c[1], c[2], c[3], 0, Math.PI * 2); fill(c[5]); stroke(c[4], c[6]); }
    else if (k === 'rect' && [1, 2, 3, 4, 7].every(i => ok(c[i]))) { ctx.beginPath(); ctx.rect(c[1], c[2], c[3], c[4]); fill(c[6]); stroke(c[5], c[7]); }
    else if (k === 'dot' && [1, 2, 3].every(i => ok(c[i]))) { ctx.beginPath(); ctx.arc(c[1], c[2], c[3] / 2, 0, Math.PI * 2); fill(c[4]); }
    else if (k === 'poly' && Array.isArray(c[1]) && ok(c[4])) {
      ctx.beginPath();
      c[1].forEach((p, i) => { if (Array.isArray(p) && ok(p[0]) && ok(p[1])) (i ? ctx.lineTo : ctx.moveTo).call(ctx, p[0], p[1]); });
      ctx.closePath(); fill(c[3]); stroke(c[2], c[4]);
    } else if (k === 'text' && ok(c[1]) && ok(c[2]) && ok(c[5]) && colourOk(c[4])) {
      ctx.font = `${c[5]}px system-ui, sans-serif`; ctx.textBaseline = 'top'; ctx.fillStyle = c[4];
      ctx.fillText(String(c[3]).slice(0, 500), c[1], c[2]);
    }
  }

  function paint() {
    S.raf = 0;
    if (S.dead) return;
    const batch = S.q.splice(0, PER_FRAME);
    for (const s of batch) { let c; try { c = JSON.parse(s); } catch (e) { continue; } exec(c); S.count++; }
    if (S.q.length) S.raf = requestAnimationFrame(paint);
  }

  return {
    el, canvas,
    get count() { return S.count; },
    /** commands from the worker, as JSON strings */
    add(cmds) {
      for (const s of cmds) if (typeof s === 'string' && s.length < 100000) S.q.push(s);
      /* a program drawing faster than the page can paint: what a later clear or canvas() would wipe anyway goes first */
      if (S.q.length > MAX_QUEUE) {
        let cut = -1;
        for (let i = S.q.length - 1; i >= 0; i--) if (/^\["(clear|size)"/.test(S.q[i])) { cut = i; break; }
        S.q.splice(0, cut > 0 ? cut : S.q.length - MAX_QUEUE);
      }
      if (!S.raf) S.raf = requestAnimationFrame(paint);
    },
    /** a new run: the board goes away until the program draws again */
    reset() { S.q = []; S.count = 0; if (S.raf) cancelAnimationFrame(S.raf); S.raf = 0; el.hidden = true; ctx.clearRect(0, 0, canvas.width, canvas.height); },
    flush() { if (S.raf) { cancelAnimationFrame(S.raf); paint(); } while (S.q.length) paint(); },
    dispose() { S.dead = true; if (S.raf) cancelAnimationFrame(S.raf); },
  };
}

export default { DRAW_PY, drawBoard };
