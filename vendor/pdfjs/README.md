pdf.js 4.10.38 (pdfjs-dist) — Mozilla's PDF reader in JavaScript.

  Source            https://github.com/mozilla/pdf.js
  Licence           Apache License 2.0 (LICENSE here is the package's, unchanged)
  Obtained from     https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-4.10.38.tgz
                    npm tarball sha1 3ee698003790dc266cc8b55c0e662ccb9ae18f53
                    (matches the registry's dist.shasum)
  Files used        build/pdf.min.mjs         sha256 27fc2a057a00f92a4334ad06e17dbd7259912954e9fb7f76400bcca5fd190a9c
                    build/pdf.worker.min.mjs  sha256 1baa1844c89c80a5b2797c916e75ab29254be46d8e9cb53cb6364d7aad84be36
                    LICENSE                   sha256 0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594
  Changes           none: byte for byte what the tarball holds
  Left out          the viewer, the cmaps and the standard fonts (about 5 MB); pages that
                    use unembedded standard fonts are drawn with the browser's fonts.

Loaded only when PDF tools opens a PDF (js/core/pdfkit.js). It runs on this
device, in a worker, and makes no network request. Size: 353 KB + 1.4 MB.
