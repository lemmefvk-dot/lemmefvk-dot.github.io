jsQR 1.4.0 — a QR code decoder in plain JavaScript.

  Author / source   Cosmo Wolfe, https://github.com/cozmo/jsQR
  Licence           Apache License 2.0 (LICENSE here is the repository's, unchanged)
  Obtained from     https://registry.npmjs.org/jsqr/-/jsqr-1.4.0.tgz
                    npm's published tarball sha1  8efb8d0a7cc6863cb6d95116b9069123ce9eb2d1
                    (matches the registry's `dist.shasum` for jsqr@1.4.0)
  Files used        dist/jsQR.js   sha256 bc40c8a15196236b2314db0856f72ca0b49980cd5413b8c852a7349f5fee0859
                    LICENSE        sha256 c6596eb7be8581c18be736c846fb9173b69eccf6ef94c5135893ec56bd92ba08
                                   (identical to LICENSE on the repository's master branch)
  Changes           none: both files are byte for byte what the tarball holds

It is loaded only when the QR scanner needs it and the browser has no
BarcodeDetector (js/core/scancam.js). It runs on this device and makes no
network request.
