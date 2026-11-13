/*global Ultraviolet*/
/* Aether layout: the bundle lives under /uv/, and only sw.js sits at the
   site root — a service worker's scope is capped by its own path, and the
   proxy prefix /service/ has to fall inside that scope. */
self.__uv$config = {
    prefix: '/service/',
    encodeUrl: Ultraviolet.codec.xor.encode,
    decodeUrl: Ultraviolet.codec.xor.decode,
    handler: '/uv/uv.handler.js',
    client: '/uv/uv.client.js',
    bundle: '/uv/uv.bundle.js',
    config: '/uv/uv.config.js',
    sw: '/uv/uv.sw.js',
};
