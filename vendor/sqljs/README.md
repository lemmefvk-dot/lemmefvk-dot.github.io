# sql.js (vendored)

SQLite for Static Code's SQL playground (`js/core/codesql.js`). This is
**sql.js 1.13.0**: SQLite compiled to WebAssembly, the `dist/sql-wasm.js` and
`dist/sql-wasm.wasm` files taken unmodified from the `sql.js` package on npm
(`npm pack sql.js@1.13.0`).

| file | bytes | sha-256 |
| --- | ---: | --- |
| `sql-wasm.js` | 48,788 | 694ca5b36aa3e6e71f417819d7df390b65343665fcfa5c69015ca33d93d291b3 |
| `sql-wasm.wasm` | 659,806 | 0734155c83e493983d1f2ff5b09a4fab6e35a32e9449c7e4e545756439f62d73 |

About 0.7 MB. Nothing here is loaded until someone presses Run on a `.sql`
file; then both files are fetched once, inside a Web Worker (so Stop can end a
query that never finishes), and none of it is in the offline copy
(`tools/offline-files.mjs` keeps only `index.html`, `js/`, `css/` and a few
images). The sample databases are SQL scripts written for StaticOS, in
`js/core/codesqldata.js`.

## Licences

* sql.js: MIT (`LICENSE`), Copyright (c) 2017 sql.js authors. Source:
  https://github.com/sql-js/sql.js (tag v1.13.0).
* SQLite itself: public domain (https://sqlite.org/copyright.html).
* The Emscripten runtime inside `sql-wasm.js`: MIT.

They are credited in the About app (js/apps/about.js, CREDITS).
