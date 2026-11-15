# js-beautify (vendored)

Format for HTML, CSS and JavaScript in Static Code (`js/core/codefmt.js`).
This is **js-beautify 1.15.4**, the single-file browser build
`js/lib/beautifier.min.js`, taken unmodified from the `js-beautify` package on
npm (`npm pack js-beautify@1.15.4`). It holds all three formatters
(`beautifier.js`, `beautifier.css`, `beautifier.html`).

| file | bytes | sha-256 |
| --- | ---: | --- |
| `beautifier.min.js` | 100,072 | b65a96529bb399195df6209af009398ded3ecc1fe09d097f6a9f0056540adf54 |

It is loaded only when someone presses Format, inside a Web Worker of its own
(so it adds nothing to the page's globals), and it is not in the offline copy
(`tools/offline-files.mjs` keeps only `index.html`, `js/`, `css/` and a few
images). The source map the last line names is not shipped.

## Licence

MIT (`LICENSE`), Copyright (c) 2007-2018 Einar Lielmanis, Liam Newman, and
contributors. Source: https://github.com/beautifier/js-beautify (tag v1.15.4).
Credited in the About app (js/apps/about.js, CREDITS).
