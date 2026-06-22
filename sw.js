'use strict';

const CACHE_NAME = 'recomp-v2';
const CORE_ASSETS = ['/', '/index.html', '/manifest.json'];

/* 安裝：先把核心資源存起來 */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS))
  );
});

/* 啟用：刪掉舊快取，接手頁面 */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* 讓頁面可以命令 waiting 的 SW 立即啟用 */
self.addEventListener('message', event => {
  if(event.data && event.data.type === 'SKIP_WAITING'){
    self.skipWaiting();
  }
});

/* 抓資源策略 */
self.addEventListener('fetch', event => {
  const req = event.request;
  if(req.method !== 'GET') return;

  const url = new URL(req.url);

  /* HTML / 頁面導覽：網路優先
     → 線上時盡量拿最新版
     → 離線時再退回快取 */
  if(req.mode === 'navigate' || req.destination === 'document'){
    event.respondWith(
      fetch(req).then(res => {
        if(res && res.status === 200){
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
        }
        return res;
      }).catch(async () => {
        const cached = await caches.match(req);
        return cached || caches.match('/') || caches.match('/index.html');
      })
    );
    return;
  }

  /* Google Fonts：有快取先用，背景更新 */
  if(url.hostname.includes('fonts.g')){
    event.respondWith(
      caches.match(req).then(cached => {
        const networkFetch = fetch(req).then(res => {
          if(res && res.status === 200){
            const clone = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
          }
          return res;
        });
        return cached || networkFetch;
      })
    );
    return;
  }

  /* 其他靜態資源：快取優先 */
  event.respondWith(
    caches.match(req).then(cached => {
      if(cached) return cached;
      return fetch(req).then(res => {
        if(!res || res.status !== 200 || res.type === 'opaque') return res;
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
        return res;
      });
    })
  );
});
