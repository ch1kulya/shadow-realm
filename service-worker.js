const CACHE_NAME = 'shadow-slave-cache-v7';
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

async function processCachingQueue() {
    if (isCaching || cachingQueue.length === 0) {
        return;
    }
    isCaching = true;

    const cache = await caches.open(CACHE_NAME);
    const initialTotal = (await cache.keys()).length + cachingQueue.length;

    while (cachingQueue.length > 0) {
        const urlToCache = cachingQueue.shift(); // Берем первый элемент и удаляем из очереди
        await safeCacheAdd(cache, new Request(urlToCache));
        
        const currentCachedCount = initialTotal - cachingQueue.length;
        
        // Отправляем прогресс не слишком часто
        if (cachingQueue.length % 5 === 0 || cachingQueue.length === 0) {
            broadcastMessage({
                type: 'caching-progress',
                count: currentCachedCount,
                total: initialTotal
            });
        }
    }
    
    isCaching = false;
    console.log('Service Worker: Caching queue processed.');
    const totalSize = await calculateCacheSize(cache);
    broadcastMessage({ type: 'caching-finished', totalSize });
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
    if (event.data && event.data.action) {
        switch (event.data.action) {
            case 'cache-all':
                console.log('Service Worker: Received "cache-all" message.');
                event.waitUntil(
                    caches.open(CACHE_NAME).then(async (cache) => {
                        try {
                            const response = await fetch('/assets/js/chapters.json');
                            const chapters = await response.json();
                            const chapterUrls = chapters.map(chapter => new URL(chapter.url, self.location.origin).href);
                            
                            const requestsInCache = await cache.keys();
                            const urlsInCache = requestsInCache.map(req => req.url);

                            cachingQueue = chapterUrls.filter(url => !urlsInCache.includes(url));
                            
                            if (cachingQueue.length === 0) {
                                console.log('Service Worker: Everything is already cached.');
                                const totalSize = await calculateCacheSize(cache);
                                broadcastMessage({ type: 'caching-finished', totalSize });
                                return;
                            }
                            
                            const totalToCache = (await cache.keys()).length + cachingQueue.length;
                            broadcastMessage({ type: 'caching-started', total: totalToCache });
                            processCachingQueue();

                        } catch (error) {
                            console.error('Service Worker: Failed to fetch and cache chapters.', error);
                            broadcastMessage({ type: 'caching-error', error: error.message });
                        }
                    })
                );
                break;

            case 'check-for-updates': // Этот кейс можно объединить с 'cache-all'
                console.log('Service Worker: Received "check-for-updates", treating as "cache-all".');
                self.dispatchEvent(new ExtendableMessageEvent('message', { data: { action: 'cache-all' }}));
                break;

            case 'request-status':
                console.log('Service Worker: Received status request.');
                if (isCaching) {
                    caches.open(CACHE_NAME).then(async (cache) => {
                         const initialTotal = (await cache.keys()).length + cachingQueue.length;
                         const currentCachedCount = initialTotal - cachingQueue.length;
                         broadcastMessage({
                             type: 'caching-progress',
                             count: currentCachedCount,
                             total: initialTotal
                         });
                    });
                }
                break;
        }
    }
}); 