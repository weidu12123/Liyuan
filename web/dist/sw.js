/* 梨园轻量 Service Worker：缓存壳与品牌图标，弱网时 logo 不空白 */
const CACHE = "liyuan-shell-v2";
const PRECACHE = [
	"/",
	"/index.html",
	"/favicon.png",
	"/logo-32.png",
	"/logo-64.png",
	"/logo-128.png",
	"/logo-180.png",
	"/logo-192.png",
	"/logo-256.png",
	"/logo-512.png",
	"/logo.png",
	"/logo-maskable-192.png",
	"/logo-maskable-512.png",
	"/site.webmanifest",
];

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((c) => c.addAll(PRECACHE.map((u) => new Request(u, { cache: "reload" }))))
			.then(() => self.skipWaiting())
			.catch(() => self.skipWaiting()),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
			.then(() => self.clients.claim()),
	);
});

self.addEventListener("fetch", (event) => {
	const req = event.request;
	if (req.method !== "GET") return;
	const url = new URL(req.url);
	if (url.origin !== self.location.origin) return;
	// API / WS / 媒体：不拦截
	if (
		url.pathname.startsWith("/api/") ||
		url.pathname.startsWith("/ws") ||
		url.pathname.startsWith("/media/") ||
		url.pathname.startsWith("/audio/") ||
		url.pathname.startsWith("/uploads/") ||
		url.pathname.startsWith("/cards/")
	) {
		return;
	}

	// 品牌图与静态壳：缓存优先，后台更新
	const isShell =
		url.pathname === "/" ||
		url.pathname === "/index.html" ||
		url.pathname.endsWith(".webmanifest") ||
		url.pathname.startsWith("/logo") ||
		url.pathname === "/favicon.png" ||
		url.pathname.startsWith("/assets/");

	if (!isShell) return;

	event.respondWith(
		caches.open(CACHE).then(async (cache) => {
			const hit = await cache.match(req, { ignoreSearch: true });
			const fetchPromise = fetch(req)
				.then((res) => {
					if (res && res.ok) cache.put(req, res.clone());
					return res;
				})
				.catch(() => hit);
			return hit || fetchPromise;
		}),
	);
});
