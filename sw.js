// Offline support for the home-screen app. Network first (updates arrive as soon as you are online),
// cache as fallback. Everything the app needs is in SHELL.
// Requests bypass the browser's HTTP cache (GitHub Pages lets it keep files 10 minutes): otherwise "network first"
// could still get yesterday's app.js and a fresh deploy wouldn't show up on the phone.
const CACHE = 'circle-v92'
const SHELL = ['./', 'index.html', 'core.js', 'app.js', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'songs.json', 'author-songs.json']

self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE)
  .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting())))
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())))

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return
  e.respondWith(
    fetch(req.url, { cache: 'no-cache' }) // revalidate with the server every time
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)) }
        return res
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./'))),
  )
})
