/* 梨园轻量 Service Worker：缓存壳与品牌图标，弱网时 logo 不空白。
 *
 * 注意：index.html / / 必须「网络优先」。否则 rebuild 后 hashed 资源改名，
 * 旧 HTML 仍指向已删除的 /assets/index-XXXX.js → 整页白屏。
 */
const CACHE = "liyuan-shell-v3";
const PRECACHE = [
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

	const isHtml = url.pathname === "/" || url.pathname === "/index.html";
	const isAsset = url.pathname.startsWith("/assets/");
	const isBrand =
		url.pathname.endsWith(".webmanifest") ||
		url.pathname.startsWith("/logo") ||
		url.pathname === "/favicon.png";

	if (!isHtml && !isAsset && !isBrand) return;

	// HTML：网络优先，失败再回落缓存（避免 rebuild 白屏）
	if (isHtml) {
		event.respondWith(
			fetch(req)
				.then((res) => {
					if (res && res.ok) {
						const copy = res.clone();
						void caches.open(CACHE).then((c) => c.put(req, copy));
					}
					return res;
				})
				.catch(async () => {
					const hit = await caches.match(req, { ignoreSearch: true });
					if (hit) return hit;
					// 最后兜底：尝试缓存里的 index.html
					return (await caches.match("/index.html")) || Response.error();
				}),
		);
		return;
	}

	// 品牌图与 hashed assets：缓存优先，后台更新
	event.respondWith(
		caches.open(CACHE).then(async (cache) => {
			const hit = await cache.match(req, { ignoreSearch: true });
			const fetchPromise = fetch(req)
				.then((res) => {
					if (res && res.ok) cache.put(req, res.clone());
					return res;
				})
				.catch(() => hit);
			// assets 若缓存未命中必须等网络（hashed 文件旧的不能凑合）
			if (isAsset) return hit || fetchPromise;
			return hit || fetchPromise;
		}),
	);
});
