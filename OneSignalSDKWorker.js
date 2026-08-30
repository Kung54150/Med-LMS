/* ============================================================================
   Med-LMS  ·  Service Worker  (Push + ตัวเลขแจ้งเตือนบนไอคอน)
   ----------------------------------------------------------------------------
   ไฟล์นี้ต้องวางไว้ที่ "รากของโฟลเดอร์เว็บ" คือ
       https://kung54150.github.io/Med-LMS/OneSignalSDKWorker.js
   (คือวางไว้ระดับเดียวกับ index.html และ manifest.json ใน GitHub repo)

   ห้ามย้ายไปไว้ในโฟลเดอร์ย่อย เพราะ Service Worker คุมได้แค่โฟลเดอร์ตัวเอง
   ลงไป ถ้าย้ายเข้าโฟลเดอร์ย่อย ตัวเลขบนไอคอนจะไม่ขึ้น
   ========================================================================== */

/* 1) โหลด SDK ของ OneSignal เข้ามา — บรรทัดนี้ห้ามลบ
      OneSignal จะเป็นคนรับ push แล้วเด้งข้อความแจ้งเตือนให้เอง */
importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');


/* ============================================================================
   2) ตัวนับจำนวนบทเรียนใหม่ที่ยังไม่ได้เปิดอ่าน
   ----------------------------------------------------------------------------
   Service Worker ใช้ localStorage ไม่ได้ จึงเก็บตัวเลขไว้ใน Cache Storage แทน
   ซึ่งหน้าเว็บ (index.html) ก็เข้าถึงถังเดียวกันนี้ได้ ทำให้ล้างค่าตรงกันได้
   ========================================================================== */
var BADGE_CACHE = 'medlms-badge';
var BADGE_KEY   = 'unread-count';

async function readCount() {
  try {
    var cache = await caches.open(BADGE_CACHE);
    var res   = await cache.match(BADGE_KEY);
    if (!res) return 0;
    var n = parseInt(await res.text(), 10);
    return isNaN(n) ? 0 : n;
  } catch (e) {
    return 0;
  }
}

async function writeCount(n) {
  try {
    var cache = await caches.open(BADGE_CACHE);
    await cache.put(BADGE_KEY, new Response(String(n)));
  } catch (e) { /* เขียนไม่ได้ก็ไม่เป็นไร ตัวเลขแค่คลาดเคลื่อน ไม่ทำให้แอปพัง */ }
}

/* ตั้งตัวเลขบนไอคอน — ห่อ try/catch ไว้เพราะบางเบราว์เซอร์ (เช่น Safari บางรุ่น)
   ยังไม่รองรับ setAppBadge ใน Service Worker ซึ่งไม่ถือว่าผิดพลาด
   เฉพาะ iOS ระบบจะนับ badge ให้เองจากจำนวนการแจ้งเตือนที่ค้างอยู่ */
async function applyBadge(n) {
  try {
    if (n > 0 && self.navigator && self.navigator.setAppBadge) {
      await self.navigator.setAppBadge(n);
    } else if (self.navigator && self.navigator.clearAppBadge) {
      await self.navigator.clearAppBadge();
    }
  } catch (e) { /* ไม่รองรับ ก็ปล่อยผ่าน */ }
}

async function bumpBadge() {
  var n = (await readCount()) + 1;
  await writeCount(n);
  await applyBadge(n);
}

async function resetBadge() {
  await writeCount(0);
  await applyBadge(0);
}


/* ============================================================================
   3) เมื่อมี push เข้ามา → บวกตัวเลขบนไอคอนขึ้น 1
   ----------------------------------------------------------------------------
   หมายเหตุ: เราไม่ได้เรียก showNotification เอง เพราะ SDK ของ OneSignal
   ทำหน้าที่นั้นอยู่แล้ว ตัวฟังก์ชันนี้ทำแค่ "นับเลขบนไอคอน" เพิ่มให้เท่านั้น
   ========================================================================== */
self.addEventListener('push', function (event) {
  event.waitUntil(bumpBadge());
});


/* 4) เมื่อผู้ใช้กดที่การแจ้งเตือน → ล้างตัวเลขบนไอคอน
      (การเปิดหน้าเว็บ OneSignal จัดการให้เองแล้ว จึงไม่ต้องสั่ง openWindow ซ้ำ
       ไม่งั้นจะเปิดสองแท็บ) */
self.addEventListener('notificationclick', function (event) {
  event.waitUntil(resetBadge());
});


/* 5) รับคำสั่งจากหน้าเว็บ ให้ล้างตัวเลขเมื่อผู้ใช้เปิดแอปเอง */
self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'MEDLMS_CLEAR_BADGE') {
    event.waitUntil(resetBadge());
  }
});


/* 6) ตัวรับ fetch เปล่า ๆ — ไม่ได้เปลี่ยนพฤติกรรมการโหลดหน้าเว็บใด ๆ ทั้งสิ้น
      แต่จำเป็นต้องมี เพราะ Chrome ใช้เป็นเงื่อนไขว่าเว็บนี้ "ติดตั้งเป็นแอปได้"
      ถ้าไม่มีบรรทัดนี้ Android บางเครื่องจะไม่ขึ้นปุ่มเพิ่มลงหน้าจอโฮม */
self.addEventListener('fetch', function () { /* ปล่อยผ่านไปตามปกติ */ });


/* 7) ให้ Service Worker ตัวใหม่ทำงานแทนตัวเก่าทันทีที่อัปเดตไฟล์
      ไม่ต้องรอผู้ใช้ปิดแอปทุกแท็บก่อน */
self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});
