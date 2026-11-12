/* ---------------------------- ค่าคงที่ ---------------------------- */

/** ลิงก์แอป PWA ที่จะเปิดเมื่อผู้ใช้กดที่การแจ้งเตือน */
const PUSH_PWA_URL = 'https://kung54150.github.io/Med-LMS/';

/** ไอคอนที่แสดงในการแจ้งเตือนบน Android / Chrome */
const PUSH_ICON_URL = 'https://raw.githubusercontent.com/Kung54150/Med-LMS/main/icon-192.png';

const PUSH_PROP_APP_ID   = 'ONESIGNAL_APP_ID';
const PUSH_PROP_API_KEY  = 'ONESIGNAL_API_KEY';
const PUSH_PROP_SENT_IDS = 'PUSH_SENT_COURSE_IDS';

/* [เพิ่มใหม่] ----------------------------------------------------------------
   บทเรียนฝึกทักษะที่เป็นหน้าแยก (ไม่ได้อยู่ในชีตรายการบทเรียน)
   - เพิ่มหน้า/บทฝึกทักษะใหม่เมื่อไร ให้เพิ่ม 1 บรรทัดที่นี่ (id ห้ามซ้ำ)
   - ระบบจะแจ้งเตือนเองในรอบตรวจถัดไป และแจ้งแค่ครั้งเดียวต่อ id
   - page = คำที่ใช้ในลิงก์ ?page=... (ไม่ใส่ = กดแล้วเปิดหน้าหลัก)
   - ใส่ publishAt ได้ถ้าอยากตั้งเวลาแจ้ง เช่น publishAt: '2026-09-20T08:00:00+07:00'
   ------------------------------------------------------------------------- */
const PUSH_EXTRA_LESSONS = [
  { id: 'skill-ekg-reading', title: '🫀 ฝึกทักษะ: การอ่าน EKG', page: 'ekg' },
  { id: 'skill-cpr-trainer', title: '🫁 ฝึกทักษะ: CPR Trainer' }
];

/* [เพิ่มใหม่] ลิงก์ที่จะเปิดเมื่อกดแจ้งเตือนของบทเรียนนั้น */
function lessonLink_(c) {
  let base = '';
  try { base = ScriptApp.getService().getUrl(); } catch (e) {}
  if (!base) return PUSH_PWA_URL;
  if (c.page) return base + '?page=' + encodeURIComponent(c.page);
  if (String(c.id).indexOf('skill-') === 0) return base;
  return base + '?course=' + encodeURIComponent(c.id);
}


/* ============================================================================
   ขั้นตอนที่ 1 — ตั้งค่าคีย์ OneSignal (รันครั้งเดียว)
   ----------------------------------------------------------------------------
   แก้ค่าสองบรรทัดข้างล่างให้เป็นค่าจริง แล้วกดรันฟังก์ชันนี้หนึ่งครั้ง
   คีย์จะถูกเก็บไว้ใน Script Properties ซึ่งปลอดภัยกว่าการฝังไว้ในโค้ด
   เมื่อรันเสร็จแล้ว แนะนำให้ลบค่าจริงออกจากสองบรรทัดนี้ทิ้ง
   เผื่อวันหนึ่งต้องแชร์โค้ดให้คนอื่นดู
   ========================================================================== */
function setupOneSignalKeys() {
  const APP_ID  = '2bb1f89d-af31-4015-88f3-91d5a00ec693';
  const API_KEY = 'วาง OneSignal REST API Key ที่นี่';
  if (APP_ID.indexOf('วาง') === 0 || API_KEY.indexOf('วาง') === 0) {
    throw new Error('กรุณาแก้ค่า APP_ID และ API_KEY ในฟังก์ชันนี้ให้เป็นค่าจริงก่อนกดรัน');
  }

  PropertiesService.getScriptProperties()
    .setProperty(PUSH_PROP_APP_ID, APP_ID.trim())
    .setProperty(PUSH_PROP_API_KEY, API_KEY.trim());

  Logger.log('บันทึกคีย์ OneSignal เรียบร้อยแล้ว');
  return 'บันทึกคีย์เรียบร้อย';
}


/* ============================================================================
   ขั้นตอนที่ 2 — ติดตั้งตัวตรวจบทเรียนใหม่ (รันครั้งเดียว)
   ----------------------------------------------------------------------------
   ระบบจะตรวจทุก 15 นาทีว่ามีบทเรียนใดถึงเวลาเผยแพร่แล้วหรือยัง
   ถ้ามี จะส่งการแจ้งเตือนให้พนักงานทุกคนที่เปิดสิทธิ์ไว้โดยอัตโนมัติ
   ========================================================================== */
function installNewLessonTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'checkAndNotifyNewLessons') {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger('checkAndNotifyNewLessons')
    .timeBased()
    .everyMinutes(15)
    .create();

  /* รันรอบแรกทันที เพื่อบันทึกรายการบทเรียนปัจจุบันไว้เป็นฐาน */
  const result = checkAndNotifyNewLessons();

  Logger.log('ติดตั้งตัวตรวจเรียบร้อย · ' + result);
  return result;
}


/** ยกเลิกระบบแจ้งเตือนอัตโนมัติ (ใช้เมื่อต้องการหยุดชั่วคราว) */
function removeNewLessonTrigger() {
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'checkAndNotifyNewLessons') {
      ScriptApp.deleteTrigger(t);
      n++;
    }
  });
  Logger.log('ยกเลิกตัวตรวจแล้ว ' + n + ' รายการ');
  return 'ยกเลิกแล้ว ' + n + ' รายการ';
}


/* ============================================================================
   หัวใจของระบบ — ตรวจว่ามีบทเรียนใดถึงเวลาเผยแพร่แล้วและยังไม่เคยแจ้งเตือน
   ฟังก์ชันนี้ถูกเรียกอัตโนมัติทุก 15 นาที ไม่ต้องกดรันเอง
   ========================================================================== */
function checkAndNotifyNewLessons() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return 'มีการตรวจรอบอื่นทำงานอยู่ ข้ามรอบนี้';

  try {
    const props = PropertiesService.getScriptProperties();
    const now   = new Date();

    /* บทเรียนที่ถือว่า "เผยแพร่แล้ว" คือไม่ได้ตั้งเวลาไว้ หรือถึงเวลาแล้ว
       ใช้เกณฑ์เดียวกับที่ getCourses() ใน Code.gs ใช้ตัดสินว่าล็อกหรือไม่
       [แก้ไข] รวมบทเรียนฝึกทักษะที่เป็นหน้าแยก (PUSH_EXTRA_LESSONS) ด้วย */
    const published = COURSES.concat(PUSH_EXTRA_LESSONS).filter(function (c) {
      if (!c.publishAt) return true;
      const d = new Date(c.publishAt);
      return !isNaN(d.getTime()) && d <= now;
    });

    const raw = props.getProperty(PUSH_PROP_SENT_IDS);

    /* ครั้งแรกสุด: บันทึกรายการที่มีอยู่เดิมไว้เฉย ๆ โดยไม่ส่งแจ้งเตือน
       ป้องกันไม่ให้พนักงานโดนแจ้งเตือนย้อนหลังรวดเดียวสิบกว่าเรื่อง */
    if (raw === null) {
      props.setProperty(PUSH_PROP_SENT_IDS,
        JSON.stringify(published.map(function (c) { return c.id; })));
      return 'ตั้งค่าเริ่มต้นเรียบร้อย (บันทึกบทเรียนเดิม ' +
             published.length + ' เรื่อง โดยไม่ส่งแจ้งเตือน)';
    }

    let sentIds;
    try { sentIds = JSON.parse(raw); } catch (e) { sentIds = []; }
    if (!Array.isArray(sentIds)) sentIds = [];

    const fresh = published.filter(function (c) { return sentIds.indexOf(c.id) === -1; });
    /* [แก้ไข] บันทึกผลทุกรอบ จะได้เช็กได้ว่าระบบตรวจกี่เรื่อง */
    if (!fresh.length) {
      Logger.log('ไม่มีบทเรียนใหม่ (ตรวจ ' + published.length + ' เรื่อง)');
      return 'ไม่มีบทเรียนใหม่';
    }

    /* ถ้าใหม่พร้อมกันไม่เกิน 3 เรื่อง ส่งแยกทีละเรื่อง
       ตัวเลขบนไอคอนจะได้ตรงกับจำนวนบทเรียนใหม่จริง ๆ
       ถ้ามากกว่านั้น ส่งรวมเป็นข้อความเดียว จะได้ไม่รบกวนพนักงานเกินไป */
    const done = [];
    let failed = 0;

    if (fresh.length <= 3) {
      /* ส่งทีละเรื่อง และบันทึกว่าส่งแล้วเฉพาะเรื่องที่ส่งสำเร็จจริง
         ถ้าเรื่องใดส่งพลาด รอบตรวจครั้งถัดไปจะส่งซ้ำให้เอง ไม่ตกหล่น
         และเรื่องที่ส่งไปแล้วก็จะไม่ถูกส่งซ้ำให้พนักงานรำคาญ */
      fresh.forEach(function (c) {
        try {
          /* [แก้ไข] กดแจ้งเตือนแล้วเปิดเข้าบทเรียนนั้นเลย */
          sendPush_('📚 มีบทเรียนใหม่', c.title, lessonLink_(c));
          done.push(c.id);
        } catch (e) {
          failed++;
          Logger.log('ส่งไม่สำเร็จ: ' + c.title + ' — ' + e.message);
        }
        Utilities.sleep(600);
      });
    } else {
      try {
        sendPush_('📚 มีบทเรียนใหม่ ' + fresh.length + ' เรื่อง',
                  'เข้าไปดูรายการบทเรียนใหม่ทั้งหมดได้ในแอป Med-LMS',
                  PUSH_PWA_URL);
        fresh.forEach(function (c) { done.push(c.id); });
      } catch (e) {
        failed = fresh.length;
        Logger.log('ส่งไม่สำเร็จ: ' + e.message);
      }
    }

    if (done.length) {
      done.forEach(function (id) { sentIds.push(id); });
      props.setProperty(PUSH_PROP_SENT_IDS, JSON.stringify(sentIds));
    }

    const msg = 'ส่งแจ้งเตือนแล้ว ' + done.length + ' เรื่อง' +
                (failed ? ' · ส่งไม่สำเร็จ ' + failed + ' เรื่อง (จะลองใหม่รอบหน้า)' : '');
    Logger.log(msg);
    return msg;

  } finally {
    lock.releaseLock();
  }
}


/* ============================================================================
   ส่งการแจ้งเตือนทดสอบ — ใช้ตรวจว่าตั้งค่าครบถูกต้องหรือยัง
   ========================================================================== */
function sendTestPush() {
  const res = sendPush_(
    '🔔 ทดสอบระบบแจ้งเตือน',
    'ถ้าเห็นข้อความนี้ แปลว่าระบบแจ้งเตือน Med-LMS พร้อมใช้งานแล้ว',
    PUSH_PWA_URL
  );
  Logger.log(res);
  return res;
}


/* ============================================================================
   ส่งประกาศเองแบบกำหนดข้อความ
   ใช้เวลาต้องการแจ้งเรื่องอื่นนอกจากบทเรียนใหม่ เช่น เตือนให้ทำแบบทดสอบ
   แก้ข้อความสองบรรทัดข้างล่างแล้วกดรันได้เลย
   ========================================================================== */
function sendAnnouncementToAll() {
  const heading = '📢 ประกาศจากศูนย์อายุรกรรม';
  const message = 'แก้ข้อความบรรทัดนี้ก่อนกดรัน';

  if (message.indexOf('แก้ข้อความบรรทัดนี้') === 0) {
    throw new Error('กรุณาแก้ข้อความในตัวแปร message ก่อนกดรัน');
  }

  const res = sendPush_(heading, message, PUSH_PWA_URL);
  Logger.log(res);
  return res;
}


/* ============================================================================
   เครื่องมือช่วยแก้ปัญหา — ดูสถานะปัจจุบันของระบบแจ้งเตือน
   กดรันแล้วดูผลที่ Execution log ด้านล่าง
   ========================================================================== */
function pushSystemStatus() {
  const props = PropertiesService.getScriptProperties();
  const appId = props.getProperty(PUSH_PROP_APP_ID);
  const key   = props.getProperty(PUSH_PROP_API_KEY);
  const sent  = props.getProperty(PUSH_PROP_SENT_IDS);

  const triggers = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === 'checkAndNotifyNewLessons';
  });

  let sentCount = 0;
  try { sentCount = JSON.parse(sent || '[]').length; } catch (e) {}

  const out = [
    'OneSignal App ID     : ' + (appId ? 'ตั้งค่าแล้ว (' + appId.slice(0, 8) + '…)' : '❌ ยังไม่ได้ตั้งค่า'),
    'OneSignal API Key    : ' + (key ? 'ตั้งค่าแล้ว' : '❌ ยังไม่ได้ตั้งค่า'),
    'ตัวตรวจอัตโนมัติ      : ' + (triggers.length ? '✔ ทำงานอยู่ (ทุก 15 นาที)' : '❌ ยังไม่ได้ติดตั้ง'),
    'บทเรียนที่แจ้งไปแล้ว  : ' + sentCount + ' เรื่อง',
    'บทเรียนทั้งหมดในระบบ : ' + COURSES.length + ' เรื่อง',
    'บทฝึกทักษะหน้าแยก    : ' + PUSH_EXTRA_LESSONS.length + ' เรื่อง'
  ].join('\n');

  Logger.log(out);
  return out;
}


/* ============================================================================
   ฟังก์ชันภายใน — ยิงคำสั่งไปที่ OneSignal
   (ชื่อลงท้ายด้วย _ หมายถึงเรียกใช้ได้เฉพาะภายในสคริปต์ ไม่ต้องกดรันเอง)
   ========================================================================== */
/** ชื่อกลุ่มผู้รับที่จะลองไล่ทีละอัน
 *  OneSignal เปลี่ยนชื่อกลุ่มมาตรฐานตามยุคของแอป แอปใหม่ใช้ Total Subscriptions
 *  แอปเก่าใช้ Subscribed Users ระบบจะลองจากบนลงล่างจนกว่าจะเจออันที่ส่งได้จริง */
const PUSH_SEGMENTS = ['Total Subscriptions', 'Subscribed Users', 'Active Subscriptions', 'Active Users'];


/* ============================================================================
   ตรวจว่าแอปนี้มีกลุ่มผู้รับชื่ออะไรบ้าง และมีสมาชิกกี่คน
   กดรันฟังก์ชันนี้เพื่อดูรายชื่อกลุ่มจริงจาก OneSignal
   ========================================================================== */
function listOneSignalSegments() {
  const props  = PropertiesService.getScriptProperties();
  const appId  = props.getProperty(PUSH_PROP_APP_ID);
  const apiKey = props.getProperty(PUSH_PROP_API_KEY);

  const res = UrlFetchApp.fetch('https://api.onesignal.com/apps/' + appId + '/segments', {
    method: 'get',
    headers: { 'Authorization': 'Key ' + apiKey },
    muteHttpExceptions: true
  });

  const out = 'สถานะ ' + res.getResponseCode() + '\n' + res.getContentText();
  Logger.log(out);
  return out;
}


/* ============================================================================
   ส่งการแจ้งเตือน — ลองทีละกลุ่มจนกว่าจะสำเร็จ
   ========================================================================== */
function sendPush_(heading, message, url) {
  const props  = PropertiesService.getScriptProperties();
  const appId  = props.getProperty(PUSH_PROP_APP_ID);
  const apiKey = props.getProperty(PUSH_PROP_API_KEY);

  if (!appId || !apiKey) {
    throw new Error('ยังไม่ได้ตั้งค่าคีย์ OneSignal — กรุณารันฟังก์ชัน setupOneSignalKeys ก่อน');
  }

  /* ถ้าเคยหาชื่อกลุ่มที่ใช้ได้เจอแล้ว ให้ลองอันนั้นก่อนเลย จะได้ไม่ต้องไล่ใหม่ทุกครั้ง */
  const known = props.getProperty('PUSH_WORKING_SEGMENT');
  const order = known ? [known].concat(PUSH_SEGMENTS.filter(function (s) { return s !== known; }))
                      : PUSH_SEGMENTS.slice();

  let lastBody = '';

  for (let i = 0; i < order.length; i++) {
    const segment = order[i];

    const payload = {
      app_id: appId,
      target_channel: 'push',
      included_segments: [segment],
      headings: { en: heading },
      contents: { en: message },
      url: url,
      chrome_web_icon: PUSH_ICON_URL,
      firefox_icon: PUSH_ICON_URL
    };

    const res = UrlFetchApp.fetch('https://api.onesignal.com/notifications', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Key ' + apiKey },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const code = res.getResponseCode();
    const body = res.getContentText();
    lastBody = 'กลุ่ม "' + segment + '" → HTTP ' + code + ' ' + body;

    /* สำเร็จจริงต้องได้รหัสข้อความกลับมา และต้องไม่มีช่อง errors */
    let ok = false;
    try {
      const json = JSON.parse(body);
      ok = (code === 200 || code === 201) && json.id && !json.errors;
    } catch (e) { ok = false; }

    if (ok) {
      props.setProperty('PUSH_WORKING_SEGMENT', segment);
      const msg = 'ส่งสำเร็จผ่านกลุ่ม "' + segment + '" · ' + body;
      Logger.log(msg);
      return msg;
    }

    Logger.log('ลองกลุ่ม "' + segment + '" ไม่สำเร็จ: ' + body);
    Utilities.sleep(300);
  }

  throw new Error('ส่งไม่สำเร็จทุกกลุ่มที่ลอง · ผลล่าสุด: ' + lastBody +
                  ' · ลองรันฟังก์ชัน listOneSignalSegments เพื่อดูชื่อกลุ่มจริง');
}

/* ============================================================================
   ทดสอบแจ้งเตือนของบทเรียนเดียว — กดรันซ้ำได้ทุกครั้ง ไม่กระทบระบบอัตโนมัติ
   แก้ TEST_ID เป็น id ที่ต้องการทดสอบ แล้วกดรัน
   - บทฝึกทักษะหน้าแยก: 'skill-ekg-reading' หรือ 'skill-cpr-trainer'
   - บทเรียนในชีต: ใส่รหัสบทเรียน (รันฟังก์ชัน listLessonIdsForTest เพื่อดูรหัส)
   ========================================================================== */
function testLessonPush() {
  const TEST_ID = 'skill-ekg-reading';

  const c = COURSES.concat(PUSH_EXTRA_LESSONS).filter(function (x) {
    return String(x.id) === String(TEST_ID);
  })[0];
  if (!c) throw new Error('ไม่พบบทเรียน id: ' + TEST_ID);

  const link = lessonLink_(c);
  Logger.log('ลิงก์ที่จะเปิด: ' + link);
  const res = sendPush_('🧪 [ทดสอบ] มีบทเรียนใหม่', c.title, link);
  Logger.log(res);
  return res;
}

/** ดูรายการ id ของบทเรียนทั้งหมด ไว้เลือกมาทดสอบ */
function listLessonIdsForTest() {
  const out = COURSES.concat(PUSH_EXTRA_LESSONS).map(function (c) {
    return c.id + '  →  ' + c.title;
  }).join('\n');
  Logger.log(out);
  return out;
}