const STATIC_CACHE = 'static-v18';
const CHAPTERS_CACHE = 'chapters-cache';

const STATIC_ASSETS = [
    '/',
    '/assets/css/style.css',
    '/assets/js/main.js',
    '/assets/js/router.js',
    '/assets/js/theme-init.js',
    '/favicon.ico',
    '/404.html',
    '/robots.txt',
    '/assets/img/cover.webp',
];

const FONT_ASSETS = [
    'https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,700&family=Inter:wght@400;500;700&display=swap',
];

let cachingQueue = [];
let isCaching = false;

async function broadcastMessage(message) {
    const clients = await self.clients.matchAll({
        includeUncontrolled: true,
        type: 'window',
    });
    clients.forEach((client) => {
        client.postMessage(message);
    });
}

// Функция для безопасного добавления в кэш
async function safeCacheAdd(cache, request) {
    try {
        const response = await fetch(request, { redirect: 'follow' });
        if (response.ok) {
            await cache.put(request, response);
            return true;
        }
        console.warn(`Service Worker: Request for ${request.url || request} failed with status ${response.status}`);
    } catch (error) {
        console.error(`Service Worker: Caching failed for ${request.url || request}`, error);
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

    const concurrency = 32; // количество одновременных загрузок
    let completed = 0;

    while (cachingQueue.length > 0) {
        const batch = cachingQueue.splice(0, concurrency);
        await Promise.all(batch.map(urlToCache => safeCacheAdd(cache, new Request(urlToCache)).then(() => {
            completed++;
            const currentCachedCount = initialTotal - cachingQueue.length - (batch.length - completed % batch.length);
            if (completed % 20 === 0 || cachingQueue.length === 0) {
                broadcastMessage({
                    type: 'caching-progress',
                    count: currentCachedCount,
                    total: initialTotal
                });
            }
        })));
    }

    isCaching = false;
    console.log('Service Worker: Caching queue processed.');
    broadcastMessage({ type: 'caching-finished' });
}

async function cacheAll() {
    const cache = await caches.open(CHAPTERS_CACHE);
    try {
        const response = await fetch('/assets/js/chapters.json');
        const chapters = await response.json();
        const chapterUrls = chapters.map(ch => new URL(ch.url, self.location.origin).href);

        const cachedRequests = await cache.keys();
        const urlsInCache = cachedRequests.map(r => r.url);

        cachingQueue = chapterUrls.filter(u => !urlsInCache.includes(u));

        if (cachingQueue.length === 0) {
            broadcastMessage({ type: 'caching-finished' });
            return;
        }
        const totalToCache = urlsInCache.length + cachingQueue.length;
        broadcastMessage({ type: 'caching-started', total: totalToCache });
        await processCachingQueue();
    } catch (err) {
        console.error('Service Worker: cacheAll failed', err);
        broadcastMessage({ type: 'caching-error', error: err.message });
        throw err;
    }
}

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(STATIC_CACHE).then(cache => {
            return cache.addAll([...STATIC_ASSETS, ...FONT_ASSETS]);
        })
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.filter(key => key.startsWith('static-') && key !== STATIC_CACHE)
                    .map(oldKey => caches.delete(oldKey))
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;

    const { url } = event.request;

    if (url.includes('/chapters/')) {
        // Отдаём кеш сразу (если он есть) для мгновенной загрузки, затем пробуем сеть и обновляем кеш
        event.respondWith(
            caches.open(CHAPTERS_CACHE).then(async cache => {
                const cached = await cache.match(event.request);
                
                const networkFetch = fetch(event.request).then(response => {
                    if (response.ok) {
                        cache.put(event.request, response.clone());
                    }
                    return response;
                }).catch(_ => cached);

                return cached || networkFetch;
            })
        );
        return;
    }

    // Статика – Stale-while-revalidate из STATIC_CACHE
    event.respondWith(
        caches.open(STATIC_CACHE).then(async cache => {
            const cached = await cache.match(event.request);
            const fetchPromise = fetch(event.request).then(res => {
                cache.put(event.request, res.clone());
                return res;
            }).catch(_ => cached);
            return cached || fetchPromise
                .catch(() => cache.match('/404.html'));
        })
    );
});

self.addEventListener('message', (event) => {
    if (!(event.data && event.data.action)) return;

    switch(event.data.action) {
        case 'cache-all':
            event.waitUntil(cacheAll());
            break;
        case 'check-for-updates':
            // Просто пытаемся докачать недостающие главы
            if (navigator.onLine) {
                event.waitUntil(cacheAll());
            }
            break;
        case 'request-status':
            if (isCaching) {
                caches.open(CHAPTERS_CACHE).then(async cache => {
                    const initialTotal = (await cache.keys()).length + cachingQueue.length;
                    const currentCachedCount = initialTotal - cachingQueue.length;
                    broadcastMessage({ type: 'caching-progress', count: currentCachedCount, total: initialTotal });
                });
            }
            break;
    }
}); 