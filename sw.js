/* Med-LMS service worker  v2
   - หน้า HTML: ดึงจากเน็ตก่อนเสมอ (กันหน้าเก่าค้างในเครื่องผู้ใช้)
   - ไฟล์รูป/manifest: ใช้จากแคชได้ เพื่อความเร็ว
*/
const CACHE = 'medlms-shell-v2';
const SHELL = ['./index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;   // ไม่ยุ่งกับ script.google.com

  const isPage = e.request.mode === 'navigate'
              || url.pathname.endsWith('/')
              || url.pathname.endsWith('.html');

  if (isPage) {
    // network-first : ได้ของใหม่เสมอ ถ้าเน็ตหลุดค่อยใช้ของเก่า
    e.respondWith(
      fetch(e.request)
        .then(r => {
          const copy = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
          return r;
        })
        .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
