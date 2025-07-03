const CACHE_NAME = 'shadow-slave-cache-v6';
const CORE_ASSETS = [
    '/',
    '/assets/css/style.css',
    '/assets/js/main.js',
    '/assets/js/chapters.json',
    '/favicon.webp',
    '/translators',
    '/dmca',
    '/rights',
    '/404.html'
];
const FONT_ASSETS = [
    'https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,700;1,400&family=Inter:wght@400;500;700&family=Roboto:wght@400;500;700&family=Merriweather:wght@400;700&display=swap'
];

async function broadcastMessage(message) {
    const clients = await self.clients.matchAll({
        includeUncontrolled: true,
        type: 'window',
    });
    clients.forEach((client) => {
        client.postMessage(message);
    });
}

async function calculateCacheSize(cache) {
    const requests = await cache.keys();
    let totalSize = 0;
    for (const request of requests) {
        const response = await cache.match(request);
        if (response) {
            const blob = await response.blob();
            totalSize += blob.size;
        }
    }
    return totalSize;
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

self.addEventListener('install', (event) => {
    console.log('Service Worker: Installing...');
    event.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            console.log('Service Worker: Caching core and font assets');
            const allCoreAssets = [...CORE_ASSETS, ...FONT_ASSETS];
            const promises = allCoreAssets.map(asset => safeCacheAdd(cache, asset));
            await Promise.all(promises);
            console.log('Service Worker: Initial assets cached.');
            return self.skipWaiting();
        }).catch(error => {
            console.error('Service Worker: Installation failed', error);
        })
    );
});

self.addEventListener('activate', (event) => {
    console.log('Service Worker: Activating...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.filter(name => name !== CACHE_NAME).map(name => caches.delete(name))
            );
        }).then(() => {
            console.log('Service Worker: Old caches deleted.');
            return self.clients.claim();
        })
    );
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    event.respondWith(
        caches.open(CACHE_NAME).then(async (cache) => {
            const cachedResponse = await cache.match(event.request);

            const fetchPromise = fetch(event.request).then((networkResponse) => {
                // Если запрос к сторонним ресурсам (шрифты), то просто возвращаем ответ
                if (!event.request.url.startsWith(self.location.origin)) {
                    // Кэшируем шрифты и их CSS
                     if (event.request.url.includes('fonts.gstatic.com') || event.request.url.includes('fonts.googleapis.com')) {
                        cache.put(event.request, networkResponse.clone());
                    }
                    return networkResponse;
                }
                
                // Для своих ресурсов - обновляем кэш
                cache.put(event.request, networkResponse.clone());
                return networkResponse;
            }).catch(async () => {
                // Если сеть недоступна, возвращаем из кэша.
                // Если в кэше ничего нет, для навигации показываем 404.
                if (event.request.mode === 'navigate') {
                    return await cache.match('/404.html');
                }
                return cachedResponse; // Для других запросов (изображения и т.д.) вернет undefined
            });

            // Возвращаем из кэша сразу (Stale-While-Revalidate), если есть, и параллельно обновляем
            return cachedResponse || fetchPromise;
        })
    );
});


self.addEventListener('message', (event) => {
    if (event.data && event.data.action === 'cache-all') {
        console.log('Service Worker: Received "cache-all" message.');
        event.waitUntil(
            caches.open(CACHE_NAME).then(async (cache) => {
                try {
                    const response = await fetch('/assets/js/chapters.json');
                    const chapters = await response.json();
                    const chapterUrls = chapters.map(chapter => chapter.url);
                    
                    broadcastMessage({ type: 'caching-started', total: chapterUrls.length });
                    
                    let cachedCount = 0;
                    const totalCount = chapterUrls.length;

                    for (const url of chapterUrls) {
                        const isCached = await cache.match(url);
                        if (!isCached) {
                           await safeCacheAdd(cache, new Request(url));
                        }
                        cachedCount++;
                        if (cachedCount % 10 === 0 || cachedCount === totalCount) {
                            broadcastMessage({ type: 'caching-progress', count: cachedCount, total: totalCount });
                        }
                    }

                    console.log('Service Worker: All chapters cached.');
                    const totalSize = await calculateCacheSize(cache);
                    broadcastMessage({ type: 'caching-finished', totalSize });

                } catch (error) {
                    console.error('Service Worker: Failed to fetch and cache chapters.', error);
                    broadcastMessage({ type: 'caching-error', error: error.message });
                }
            })
        );
    }

    if (event.data && event.data.action === 'check-for-updates') {
        console.log('Service Worker: Received "check-for-updates" message.');
        event.waitUntil(
            caches.open(CACHE_NAME).then(async (cache) => {
                try {
                    const networkChaptersResponse = await fetch('/assets/js/chapters.json');
                    const networkChapters = await networkChaptersResponse.json();
                    const networkUrls = networkChapters.map(c => new URL(c.url, self.location.origin).href);

                    const cachedRequests = await cache.keys();
                    const cachedUrls = cachedRequests.map(r => r.url);
                    
                    const newUrlsToCache = networkUrls.filter(url => !cachedUrls.includes(url));

                    if (newUrlsToCache.length === 0) {
                        console.log('Service Worker: Content is up to date.');
                        const totalSize = await calculateCacheSize(cache);
                        broadcastMessage({ type: 'update-finished', upToDate: true, totalSize });
                        return;
                    }

                    broadcastMessage({ type: 'update-started', total: newUrlsToCache.length });

                    let updatedCount = 0;
                    for (const url of newUrlsToCache) {
                        await safeCacheAdd(cache, new Request(url));
                        updatedCount++;
                        broadcastMessage({ type: 'update-progress', count: updatedCount, total: newUrlsToCache.length });
                    }
                    
                    console.log('Service Worker: Update complete.');
                    const totalSize = await calculateCacheSize(cache);
                    broadcastMessage({ type: 'update-finished', upToDate: false, totalSize });
                } catch (error) {
                    console.error('Service Worker: Update check failed.', error);
                    broadcastMessage({ type: 'update-error', error: error.message });
                }
            })
        );
    }
}); 