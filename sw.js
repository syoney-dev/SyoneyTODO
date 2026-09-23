const CACHE_NAME = "syoneytodo-cache-v4";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

// Firebase SDK は URL にバージョンが入っていて中身が変わらないので、キャッシュ優先でよい。
// Firestore / 認証の通信はキャッシュすると古いデータを返してしまうので素通しする。
const SDK_ORIGIN = "https://www.gstatic.com";

self.addEventListener("install", (event) => {
  // cache: "reload" でブラウザの HTTP キャッシュを通さず、必ず最新版を取得する
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: "reload" }))))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

function putInCache(request, response) {
  if (response && response.ok) {
    const clone = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const origin = new URL(request.url).origin;

  if (origin === self.location.origin) {
    // アプリ本体: オンラインなら常に最新版、オフラインのときだけキャッシュを使う
    event.respondWith(
      fetch(request, { cache: "no-cache" })
        .then((response) => putInCache(request, response))
        .catch(() => caches.match(request, { ignoreSearch: true }))
    );
  } else if (origin === SDK_ORIGIN) {
    event.respondWith(
      caches.match(request).then(
        (cached) => cached || fetch(request).then((response) => putInCache(request, response))
      )
    );
  }
});
