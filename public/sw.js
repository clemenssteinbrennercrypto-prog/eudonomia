const CACHE = 'eudaimonia-v1'
const PRECACHE = [
  '/',
  '/index.html',
]

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (e) => {
  // Network first, fall back to cache
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  )
})
