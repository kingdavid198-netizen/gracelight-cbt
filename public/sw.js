const CACHE_NAME = "gracelight-pwa-assets-v1";
const CACHED_ASSETS = [
    "/manifest.webmanifest",
    "/icons/icon-192.png",
    "/icons/icon-512.png",
    "/icons/icon-maskable-192.png",
    "/icons/icon-maskable-512.png"
];

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(CACHED_ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("fetch", event => {
    const requestUrl = new URL(event.request.url);
    if (event.request.method !== "GET" || requestUrl.origin !== self.location.origin) {
        return;
    }

    const isCacheableAsset = requestUrl.pathname === "/manifest.webmanifest" ||
        requestUrl.pathname.startsWith("/icons/");
    if (!isCacheableAsset) {
        return;
    }

    event.respondWith(
        caches.open(CACHE_NAME).then(async cache => {
            const cachedResponse = await cache.match(event.request);
            return cachedResponse || fetch(event.request);
        })
    );
});
