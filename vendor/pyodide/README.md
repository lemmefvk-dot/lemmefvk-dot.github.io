# Pyodide (vendored)

Python for the Code app (`js/core/pyrun.js`). This is Pyodide **314.0.7**:
CPython 3.14.2 compiled to WebAssembly (Emscripten 5.0.3), taken unmodified
from the `pyodide` package on npm (`npm pack pyodide@314.0.7`).

| file | bytes | sha-256 |
| --- | ---: | --- |
| `pyodide.asm.wasm` | 9,598,218 | cc36e3cab04fdfc9a63ff13eb52eae2b911bf46c025cc7b281f394bd3de1d5e6 |
| `python_stdlib.zip` | 2,545,637 | fa1957e5777068fc4f7437f96d860ae2fbe9c19732ba06c84e004ec16dd7dd7a |
| `pyodide.asm.mjs` | 1,250,344 | f7cdc8ece80678ceb712f8e65ebe6d3a83203a180c399865f49612a051693635 |
| `pyodide.mjs` | 17,931 | 6f1d60f7bf529beb300f0f47983c921d3982363640ba20af0e38efdddbc66109 |

About 13.4 MB in all; the largest file is under 10 MB. Nothing here is loaded
until someone presses Run on a `.py` file, and none of it is in the offline
copy (`tools/offline-files.mjs` keeps only `index.html`, `js/`, `css/` and a
few images).

Only the core is shipped: the interpreter and the standard library. The
`pyodide-lock.json` package list and the third-party packages (numpy and the
rest) are left out on purpose, so there is no download from a CDN, ever. If the
sizes above change, update `ASSETS` in `js/core/pyrun.js` too (it feeds the
progress bar).

## Licences

* Pyodide: Mozilla Public License 2.0 (`LICENSE-MPL-2.0.txt`). The files are
  unmodified, so the source for them is the upstream project:
  https://github.com/pyodide/pyodide (tag 314.0.7).
* CPython and its standard library: Python Software Foundation License
  (https://docs.python.org/3/license.html).
* Emscripten runtime code inside `pyodide.asm.mjs`: MIT.

They are credited in the About app (js/apps/about.js, CREDITS).
