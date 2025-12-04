const STATIC_CACHE = "static-12042025";
const CHAPTERS_CACHE = "chapters-cache";

const STATIC_ASSETS = [
  "/",
  "/assets/css/style.css",
  "/assets/js/main.js",
  "/assets/js/router.js",
  "/assets/js/theme-init.js",
  "/assets/js/components/reader-header.js",
  "/favicon.ico",
  "/404.html",
  "/robots.txt",
  "/assets/img/cover.webp",
];

const FONT_ASSETS = [
  "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&family=Lora:ital,wght@0,400..700;1,400..700&family=Merriweather:ital,opsz,wght@0,18..144,300..900;1,18..144,300..900&family=Roboto:ital,wght@0,100..900;1,100..900&display=swap",
];

let cachingQueue = [];
let isCaching = false;

async function broadcastMessage(message) {
  const clients = await self.clients.matchAll({
    includeUncontrolled: true,
    type: "window",
  });
  clients.forEach((client) => {
    client.postMessage(message);
  });
}

async function safeCacheAdd(cache, request) {
  try {
    const response = await fetch(request, { redirect: "follow" });
    if (response.ok) {
      await cache.put(request, response);
      return true;
    }
    console.warn(
      `Service Worker: Request for ${request.url || request} failed with status ${response.status}`,
    );
  } catch (error) {
    console.error(
      `Service Worker: Caching failed for ${request.url || request}`,
      error,
    );
  }
  return false;
}

async function processCachingQueue() {
  if (isCaching || cachingQueue.length === 0) {
    return;
  }
  isCaching = true;

  const cache = await caches.open(CHAPTERS_CACHE);
  const initialTotal = (await cache.keys()).length + cachingQueue.length;

  const concurrency = 32;
  let completed = 0;

  while (cachingQueue.length > 0) {
    const batch = cachingQueue.splice(0, concurrency);
    await Promise.all(
      batch.map((urlToCache) =>
        safeCacheAdd(cache, new Request(urlToCache)).then(() => {
          completed++;
          const currentCachedCount =
            initialTotal -
            cachingQueue.length -
            (batch.length - (completed % batch.length));
          if (completed % 20 === 0 || cachingQueue.length === 0) {
            broadcastMessage({
              type: "caching-progress",
              count: currentCachedCount,
              total: initialTotal,
            });
          }
        }),
      ),
    );
  }

  isCaching = false;
  console.log("Service Worker: Caching queue processed.");
  broadcastMessage({ type: "caching-finished" });
}

async function cacheAll() {
  const cache = await caches.open(CHAPTERS_CACHE);
  try {
    const response = await fetch("/assets/index/chapters.json");
    const chapters = await response.json();
    const chapterUrls = chapters.map(
      (ch) => new URL(ch.url, self.location.origin).href,
    );

    const cachedRequests = await cache.keys();
    const urlsInCache = cachedRequests.map((r) => r.url);

    cachingQueue = chapterUrls.filter((u) => !urlsInCache.includes(u));

    if (cachingQueue.length === 0) {
      broadcastMessage({ type: "caching-finished" });
      return;
    }
    const totalToCache = urlsInCache.length + cachingQueue.length;
    broadcastMessage({ type: "caching-started", total: totalToCache });
    await processCachingQueue();
  } catch (err) {
    console.error("Service Worker: cacheAll failed", err);
    broadcastMessage({ type: "caching-error", error: err.message });
    throw err;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(STATIC_CACHE).then((cache) => {
        return cache.addAll([...STATIC_ASSETS, ...FONT_ASSETS]);
      }),
      caches.open(CHAPTERS_CACHE).then((cache) => {
        return fetch("/assets/index/chapters.json")
          .then((response) => {
            if (response.ok) {
              return cache.put("/assets/index/chapters.json", response);
            }
          })
          .catch((err) => {
            console.warn(
              "Service Worker: Could not cache chapters.json during install",
              err,
            );
          });
      }),
    ]),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => {
        return Promise.all(
          keys
            .filter((key) => key.startsWith("static-") && key !== STATIC_CACHE)
            .map((oldKey) => caches.delete(oldKey)),
        );
      })
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const { url } = event.request;

  if (url.includes("/assets/index/chapters.json")) {
    event.respondWith(
      fetch(event.request)
        .then(async (response) => {
          if (response.ok) {
            const cache = await caches.open(CHAPTERS_CACHE);
            cache.put(event.request, response.clone());
            console.log("Service Worker: chapters.json updated from network");
            return response;
          }
          throw new Error(`Network response not ok: ${response.status}`);
        })
        .catch(async (error) => {
          console.log(
            "Service Worker: chapters.json network failed, trying cache",
            error.message,
          );
          const cache = await caches.open(CHAPTERS_CACHE);
          const cached = await cache.match(event.request);
          if (cached) {
            console.log("Service Worker: chapters.json served from cache");
            return cached;
          }
          console.warn("Service Worker: chapters.json not found in cache");
          return new Response("[]", {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }),
    );
    return;
  }

  if (url.includes("/chapters/")) {
    event.respondWith(
      caches.open(CHAPTERS_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);

        const networkFetch = fetch(event.request)
          .then((response) => {
            if (response.ok) {
              cache.put(event.request, response.clone());
            }
            return response;
          })
          .catch((_) => cached);

        return cached || networkFetch;
      }),
    );
    return;
  }

  event.respondWith(
    caches.open(STATIC_CACHE).then(async (cache) => {
      const cached = await cache.match(event.request);
      const fetchPromise = fetch(event.request)
        .then((res) => {
          cache.put(event.request, res.clone());
          return res;
        })
        .catch((_) => cached);
      return cached || fetchPromise.catch(() => cache.match("/404.html"));
    }),
  );
});

self.addEventListener("message", (event) => {
  if (!(event.data && event.data.action)) return;

  switch (event.data.action) {
    case "cache-all":
      event.waitUntil(cacheAll());
      break;
    case "check-for-updates":
      if (navigator.onLine) {
        event.waitUntil(cacheAll());
      }
      break;
    case "request-status":
      if (isCaching) {
        caches.open(CHAPTERS_CACHE).then(async (cache) => {
          const initialTotal =
            (await cache.keys()).length + cachingQueue.length;
          const currentCachedCount = initialTotal - cachingQueue.length;
          broadcastMessage({
            type: "caching-progress",
            count: currentCachedCount,
            total: initialTotal,
          });
        });
      }
      break;
  }
});
