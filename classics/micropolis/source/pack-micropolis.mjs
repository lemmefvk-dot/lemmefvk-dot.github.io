#!/usr/bin/env node
/* Turns micropolisJS's webpack output into one self-contained HTML file, because
   the game runs in a sandboxed frame with no network: it cannot load anything by
   URL, so its stylesheet, font, images and script all go inline.

     node tools/classics/pack-micropolis.mjs <dist dir> <out file>

   What changes from upstream's page, and nothing else:
   - the stylesheet, font, images and bundle are inlined
   - the Google Fonts @import and the Twitter share button go (they need the network)
   - the name field's autofocus goes (browsers block it in a frame, with a console
     error; the game focuses that field itself when it opens the form)
   - upstream's <meta name="description"> goes, here and on its About and name licence
     pages, because it uses the name EA reserves: "You may not distribute any modification
     of this program using the trademark". EA's own LICENSE.txt keeps it, as it must.
   - a notice says this copy is modified, as GPL-3 section 5(a) and EA's additional
     terms require ("modified versions ... must be marked as such")
   Upstream's own Micropolis trademark attribution in the footer is left as it is.
   Links keep working: the frame hands clicks to StaticOS, which opens them. */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';

const [dist, out] = process.argv.slice(2);
if (!dist || !out) { console.error('usage: pack-micropolis.mjs <dist dir> <out file>'); process.exit(2); }

const read = f => readFileSync(join(dist, f));
const b64 = (f, mime) => `data:${mime};base64,${read(f).toString('base64')}`;
const must = (s, pattern, what) => {
  if (!pattern.test(s)) { console.error(`pack-micropolis: upstream changed, ${what} not found`); process.exit(1); }
};

let css = read('css/style.css').toString('utf8');
must(css, /@import url\(https:\/\/fonts\.googleapis\.com[^;]*;/, 'font import');
css = css.replace(/@import url\(https:\/\/fonts\.googleapis\.com[^;]*;/, '/* Open Sans import removed: no network in the frame */');
must(css, /url\(chunk\.woff\)/, 'font url');
css = css.replace('url(chunk.woff)', `url(${b64('css/chunk.woff', 'font/woff')})`);
must(css, /url\('\.\.\/images\/dirtbg\.png'\)/, 'background url');
css = css.replace("url('../images/dirtbg.png')", `url('${b64('images/dirtbg.png', 'image/png')}')`);

let html = read('index.html').toString('utf8');
const script = read('src/micropolis.js').toString('utf8').replace(/<\/script/gi, '<\\/script');

must(html, /<link[^>]*href="css\/style\.css[^"]*"[^>]*>/, 'stylesheet link');
html = html.replace(/<link[^>]*href="css\/style\.css[^"]*"[^>]*>/, () => `<style>${css}</style>`);

for (const [file, mime] of [['images/tiles.png', 'image/png'], ['images/tilessnow.png', 'image/png'], ['images/sprites.png', 'image/png']]) {
  const re = new RegExp(`src="${file.replace('.', '\\.')}[^"]*"`);
  must(html, re, file);
  html = html.replace(re, () => `src="${b64(file, mime)}"`);
}

const scriptTag = /<script[^>]*src="src\/micropolis\.js[^"]*"[^>]*><\/script>/;
must(html, scriptTag, 'bundle script tag');
html = html.replace(scriptTag, '');
must(html, /<\/body>/, 'closing body');
html = html.replace('</body>', () => `<script>${script}</script></body>`);

/* the share button and its widget script need twitter.com */
const tweet = /<div id="tw"[^>]*>[\s\S]*?<\/div>/;
must(html, tweet, 'share button');
html = html.replace(tweet, '<div id="tw" class="z1 rightedge initialHidden"></div>');

const description = /<meta name="description"[^>]*>/;
must(html, description, 'meta description');
html = html.replace(description, '');
for (const page of ['about.html', 'name_license.html']) {
  const text = read(page).toString('utf8');
  must(text, description, `meta description in ${page}`);
  writeFileSync(join(dirname(out), page), text.replace(description, ''));
}

must(html, /<input id="nameForm" autofocus /, 'autofocus on the name field');
html = html.replace('<input id="nameForm" autofocus ', '<input id="nameForm" ');

/* the modified-version notice, in the page's title bar: always on screen, and the footer
   has no room to spare (a taller one clips the trademark line) */
const title = /(<h1 id="title"[^>]*>micropolisJS)(<\/h1>)/;
must(html, title, 'title');
html = html.replace(title, (m, open, close) => `${open} <small id="staticos-modified" style="font-size:.5em;font-weight:normal">Modified for StaticOS on 2026-10-31. Not the original release.</small>${close}`);

writeFileSync(out, gzipSync(Buffer.from(html, 'utf8'), { level: 9 }));
console.log(`pack-micropolis: ${(html.length / 1024).toFixed(0)} KB html -> ${out}`);
