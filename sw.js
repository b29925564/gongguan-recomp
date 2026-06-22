'use strict';

const CACHE_NAME = 'recomp-v1';
const CACHE_URLS = ['/', '/index.html'];

/* 安裝：把主要資源快取起來 */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

/* 啟動：清掉舊版快取 */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* 攔截請求：快取優先，沒有再去網路拿 */
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  /* Google Fonts：網路優先，失敗才用快取 */
  if(url.hostname.includes('fonts.g')){
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  /* 其他資源：快取優先 */
  e.respondWith(
    caches.match(e.request)
      .then(cached => {
        if(cached) return cached;
        return fetch(e.request).then(res => {
          if(!res || res.status !== 200 || res.type === 'opaque') return res;
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          return res;
        });
      })
  );
});
