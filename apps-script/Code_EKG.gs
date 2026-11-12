/**
 * Code_EKG.gs — ฉบับที่ 6 (วางทับของเดิมทั้งไฟล์)
 * ฟังก์ชันฝั่งเซิร์ฟเวอร์ของบทเรียนการอ่าน EKG
 *
 * เพิ่มจากฉบับที่ 5
 *  - แก้บั๊ก: ตอนสอบใหม่ (retake) ของบทที่เคยผ่านแล้ว โค้ดเดิมอัปเดตเฉพาะ DetailsJSON
 *    (รายละเอียด+รูปกระดาษคำตอบ) แต่ไม่เคยอัปเดตคอลัมน์ คะแนน/คะแนนเต็ม/ผ่าน ในชีต Attempts เลย
 *    ทำให้กระดาษคำตอบพิมพ์ออกมาแสดงคะแนนเก่าที่ค้างจากรอบแรกสุด ไม่ตรงกับรายละเอียดที่อัปเดตใหม่
 *    → ตอนนี้ saveEkgResult อัปเดตคะแนน/คะแนนเต็ม/สถานะผ่าน ในแถว Attempts ทุกครั้งที่บันทึก (ไม่ใช่แค่ตอนสร้างแถวแรก)
 *  - คะแนนที่โชว์บนกระดาษคำตอบ/EKG_Results (สำหรับบทกราฟเต็ม) เปลี่ยนจาก "จำนวนกราฟที่ผ่าน" (เช่น 8/10)
 *    เป็น "จำนวนขั้นย่อยที่ตอบถูกทั้งหมด" (เช่น 42/50) ตามที่ทางโรงพยาบาลต้องการ — ส่งมาจาก data.displayScore/
 *    data.displayTotal (ถ้าไม่ส่งมาจะ fallback ไปใช้ score/total แบบเดิม) ส่วนเกณฑ์ตัดสิน "ผ่าน/ไม่ผ่าน" ยังคง
 *    อิงจากคะแนนรายกราฟเหมือนเดิม (score/total ที่ยังใช้ตรวจสอบ 80% ก่อนบันทึก) เพื่อไม่ให้กระทบการผ่านเกณฑ์จริง
 *
 * เพิ่มจากฉบับที่ 4
 *  - เพิ่มบท EKG-full (อ่านกราฟครบทุกขั้น 8 ขั้น) และ EKG-st (ST segment) ใน EKG_OJT_COURSES
 *    ให้ตรงกับ ekg_reading.html รุ่นล่าสุด (ไม่งั้นสอบผ่าน 2 บทนี้แล้วจะบันทึกผลไม่ได้)
 *  - กระดาษคำตอบพร้อมรูปกราฟจริง: saveEkgResult รับ data.paper (รายละเอียดคำตอบ+รูปต่อข้อ)
 *    บันทึกรายละเอียดลง Attempts.DetailsJSON (1 แถวต่อ 1 ข้อ/กราฟ) และรูปลงชีตใหม่ EKG_PaperImages
 *    เพิ่มฟังก์ชัน getEkgPaperExtras(keys) ให้ index.html ดึงรูปไปแสดงในกระดาษคำตอบ
 *    (ฟังก์ชันนี้ index.html เรียกอยู่แล้วแต่ไม่เคยมีอยู่จริงในโปรเจกต์ — เป็นสาเหตุที่รูปไม่เคยขึ้น)
 *
 * เพิ่มจากฉบับเดิม (ฉบับที่ 3 → 4)
 *  - getEkgState / saveEkgState : เก็บความคืบหน้าและข้อสอบที่ทำค้างไว้ ต่อผู้ใช้ 1 คน
 *    (เปิดจากเครื่องไหนก็ทำต่อได้)                                  → ชีต EKG_State
 *  - saveEkgResult : บันทึกผลสอบที่ผ่าน + ลายเซ็น ต่อคน ต่อบท (1 แถว)  → ชีต EKG_Results
 *  - saveEkgProgress : ยังเก็บไว้ให้ใช้ได้เหมือนเดิม
 */

// ========== เปิดหน้า EKG Reading ==========
function serveEkgReading() {
  return HtmlService.createHtmlOutputFromFile('ekg_reading')
    .setTitle('การอ่าน EKG — บทเรียน')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ========== ลิงก์กลับหน้าหลักของระบบ (ปุ่ม ‹ มุมซ้ายบน) ==========
function getEkgHomeUrl() {
  return ScriptApp.getService().getUrl();
}

// ========== ตัวช่วย ==========
function ekgEmail_() {
  var email = '';
  try { email = Session.getActiveUser().getEmail(); } catch (e) {}
  if (!email) throw new Error('ไม่พบอีเมลผู้ใช้ กรุณาเข้าสู่ระบบด้วยบัญชี Google ของหน่วยงาน');
  return email.toLowerCase();
}

function ekgSheet_(name, headers, color) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length)
      .setBackground(color || '#E8396B').setFontColor('#FFFFFF').setFontWeight('bold');
  }
  return sh;
}

function ekgFindRow_(sh, matchFn) {
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var values = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  for (var i = 0; i < values.length; i++) {
    if (matchFn(values[i])) return i + 2;
  }
  return 0;
}

// ========== ความคืบหน้า / ข้อสอบที่ทำค้าง ==========
// ชีต EKG_State : Email | ข้อมูล (JSON) | อัปเดตล่าสุด
function getEkgState() {
  var email = ekgEmail_();
  var sh = ekgSheet_('EKG_State', ['Email', 'ข้อมูลความคืบหน้า (JSON)', 'อัปเดตล่าสุด'], '#6B7280');
  var row = ekgFindRow_(sh, function (r) { return String(r[0]).toLowerCase() === email; });
  if (!row) return '';
  return String(sh.getRange(row, 2).getValue() || '');
}

function saveEkgState(json) {
  var email = ekgEmail_();
  if (typeof json !== 'string' || json.length > 45000) throw new Error('ข้อมูลความคืบหน้าไม่ถูกต้อง');
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = ekgSheet_('EKG_State', ['Email', 'ข้อมูลความคืบหน้า (JSON)', 'อัปเดตล่าสุด'], '#6B7280');
    var row = ekgFindRow_(sh, function (r) { return String(r[0]).toLowerCase() === email; });
    if (!row) { sh.appendRow([email, json, new Date()]); }
    else { sh.getRange(row, 2, 1, 2).setValues([[json, new Date()]]); }
  } finally {
    lock.releaseLock();
  }
  return { ok: true };
}

// ========== บท EKG ที่ใช้ทำแบบฟอร์ม OJT ==========
// รหัสบทต้องตรงกับไฟล์ ekg_reading.html (ขึ้นต้นด้วย EKG- เพื่อไม่ให้ซ้ำกับบทเรียนอื่นในระบบ)
var EKG_OJT_COURSES = [
  { id: 'EKG-paper',  title: 'การอ่าน EKG: รู้จักกระดาษ EKG' },
  { id: 'EKG-waves',  title: 'การอ่าน EKG: ทำความรู้จักคลื่นแต่ละตัว' },
  { id: 'EKG-hr',     title: 'การอ่าน EKG: การนับ Heart Rate' },
  { id: 'EKG-rhythm', title: 'การอ่าน EKG: จังหวะสม่ำเสมอไหม (Rhythm)' },
  { id: 'EKG-pwave',  title: 'การอ่าน EKG: ดู P wave' },
  { id: 'EKG-pr',     title: 'การอ่าน EKG: วัด PR interval' },
  { id: 'EKG-qrs',    title: 'การอ่าน EKG: วัดความกว้าง QRS' },
  { id: 'EKG-nsr',    title: 'การอ่าน EKG: อ่านกราฟเต็ม Normal Sinus Rhythm' },
  { id: 'EKG-brady',  title: 'การอ่าน EKG: Sinus Bradycardia / Tachycardia' },
  { id: 'EKG-test1',  title: 'การอ่าน EKG: บททดสอบ Normal Sinus Rhythm · Sinus Bradycardia · Sinus Tachycardia' },
  { id: 'EKG-twave',  title: 'การอ่าน EKG: T wave' },
  { id: 'EKG-qt',     title: 'การอ่าน EKG: QT interval' },
  { id: 'EKG-uwave',  title: 'การอ่าน EKG: U wave' },
  { id: 'EKG-test2',  title: 'การอ่าน EKG: บททดสอบ T wave · QT interval · U wave' },
  { id: 'EKG-full',   title: 'การอ่าน EKG: อ่านกราฟครบทุกขั้น (รวมทุกเรื่อง)' },
  { id: 'EKG-st',     title: 'การอ่าน EKG: ST segment' }
];

// หน้าแอดมินเรียกเพื่อเพิ่มบท EKG ลงในช่องเลือก "สร้างแบบฟอร์ม OJT"
function getEkgOjtCourses() {
  return EKG_OJT_COURSES.map(function (c) { return { id: c.id, title: c.title }; });
}

// ========== ผลสอบที่ผ่าน + ลายเซ็น ==========
// บันทึก 3 ที่
//  1) EKG_Results : 1 แถว ต่อ 1 คน ต่อ 1 บท (ดูภาพรวมบท EKG)
//  2) Attempts    : รูปแบบเดียวกับบทเรียนอื่น → ขึ้นในประวัติ / หน้าแอดมิน
//  3) Signatures  : รูปแบบเดียวกับบทเรียนอื่น → แบบฟอร์ม OJT ดึงลายเซ็นไปใช้ได้
// หน้าเว็บเรียก 2 ครั้ง: ตอนสอบผ่าน (ยังไม่มีลายเซ็น) และตอนเซ็นชื่อ (มีลายเซ็น)
var EKG_RESULT_HEADERS = ['Email', 'ชื่อ', 'รหัสบท', 'บทเรียน', 'คะแนน', 'คะแนนเต็ม', 'ร้อยละ',
                          'วันเวลาที่สอบผ่าน', 'ลายเซ็น (ข้อมูลรูป)', 'วันเวลาที่เซ็น', 'AttemptId'];

function saveEkgResult(data) {
  if (!data || !data.lessonId) throw new Error('ข้อมูลผลสอบไม่ครบ');
  var courseId = 'EKG-' + data.lessonId;
  var course = EKG_OJT_COURSES.filter(function (c) { return c.id === courseId; })[0];
  if (!course) throw new Error('ไม่พบบทเรียน EKG รหัส ' + data.lessonId);

  // ข้อมูลกระดาษคำตอบ (รูปกราฟ + สรุปคำตอบต่อข้อ) — ไม่บังคับ ส่งมาเมื่อไรก็ได้
  var paper = (data.paper && Array.isArray(data.paper.items) && data.paper.items.length) ? data.paper : null;

  // ใช้ชื่อ-แผนกจากชีต Users ของระบบ (แบบฟอร์ม OJT จับคู่ลายเซ็นด้วยชื่อ)
  var user = (typeof getCurrentUser === 'function') ? getCurrentUser() : null;
  var email = user && user.ok ? String(user.email).toLowerCase() : ekgEmail_();
  var name = user && user.ok ? user.name : email.split('@')[0];
  var dept = user && user.ok ? user.dept : '-';

  var sig = String(data.signature || '');
  if (sig && (sig.indexOf('data:image/png;base64,') !== 0 || sig.length > 49000)) {
    throw new Error('ลายเซ็นมีขนาดใหญ่เกินไป กรุณาเซ็นใหม่ให้เรียบง่ายขึ้น');
  }
  var score = Number(data.score) || 0, total = Number(data.total) || 0;
  if (!total || score / total < 0.8) throw new Error('คะแนนยังไม่ผ่านเกณฑ์ 80%');
  // คะแนนที่จะ "แสดง/บันทึก" (กระดาษคำตอบ, EKG_Results) — ถ้าฝั่งเว็บส่ง displayScore/displayTotal มา (บทกราฟเต็ม
  // จะส่งเป็นจำนวนขั้นย่อยที่ถูก เช่น 42/50) ใช้ค่านั้น ไม่งั้น fallback ไปใช้ score/total ที่ใช้ตัดสินผ่านเกณฑ์ด้านบน
  var hasDisplay = data.displayScore != null && Number(data.displayTotal) > 0;
  var dScore = hasDisplay ? (Number(data.displayScore) || 0) : score;
  var dTotal = hasDisplay ? (Number(data.displayTotal) || 0) : total;
  var passedAt = data.passedAt ? new Date(data.passedAt) : new Date();
  var now = new Date();

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sh = ekgSheet_('EKG_Results', EKG_RESULT_HEADERS);
    if (sh.getLastColumn() < EKG_RESULT_HEADERS.length) {
      sh.getRange(1, 1, 1, EKG_RESULT_HEADERS.length).setValues([EKG_RESULT_HEADERS]);
    }
    var row = ekgFindRow_(sh, function (r) {
      return String(r[0]).toLowerCase() === email && String(r[2]) === String(data.lessonId);
    });
    var old = row ? sh.getRange(row, 1, 1, EKG_RESULT_HEADERS.length).getValues()[0] : null;
    var attemptId = (data.attemptId && ekgOwnAttempt_(data.attemptId, email, course.id)) ? String(data.attemptId) : (old && old[10] ? String(old[10]) : '');

    // สร้างรายละเอียดคำตอบ: ถ้ามีกระดาษคำตอบส่งมา ใช้ 1 แถวต่อ 1 ข้อ(กราฟ) ไม่งั้น fallback เป็นสรุปบรรทัดเดียวแบบเดิม
    var details = paper
      ? paper.items.map(function (it, i) {
          return { q: String((it && it.q) || ('ข้อ ' + (i + 1))), chosenIndex: 0,
                   chosenText: String((it && it.chosenText) || ''), correctIndex: 0,
                   correctText: String((it && it.correctText) || ''), correct: !!(it && it.correct) };
        })
      : [{ q: course.title + ' (แบบทดสอบอ่านกราฟ EKG)', chosenIndex: 0,
           chosenText: 'อ่านถูก ' + dScore + '/' + dTotal, correctIndex: 0,
           correctText: 'ผ่านเกณฑ์ 80%', correct: true }];

    // (2) Attempts — สร้างครั้งแรกที่สอบผ่าน / สอบใหม่ภายหลัง อัปเดตคะแนน+สถานะผ่านให้เป็นรอบล่าสุดเสมอ
    //     (แก้บั๊กเดิมที่รอบ retake อัปเดตแค่ DetailsJSON ทำให้คะแนนบนกระดาษคำตอบค้างเป็นของรอบแรกสุด)
    if (!attemptId) {
      attemptId = Utilities.getUuid();
      ss_().getSheetByName(SHEET_ATTEMPTS).appendRow([
        passedAt, email, name, dept, course.id, course.title, dScore, dTotal, true,
        JSON.stringify(details), attemptId
      ]);
    } else {
      var arow = ekgAttemptsRow_(attemptId);
      if (arow) {
        var atSh = ss_().getSheetByName(SHEET_ATTEMPTS);
        atSh.getRange(arow, 7, 1, 3).setValues([[dScore, dTotal, true]]);   // คะแนน | คะแนนเต็ม | ผ่าน
        if (paper) atSh.getRange(arow, 10).setValue(JSON.stringify(details));   // รายละเอียด+รูป เฉพาะเมื่อมีกระดาษคำตอบชุดใหม่ส่งมา
      }
    }

    // (4) กระดาษคำตอบ: รูปกราฟต่อข้อ — เขียนทับของเดิมของ AttemptId นี้เสมอ (เก็บเฉพาะชุดล่าสุด)
    if (paper) saveEkgPaperImages_(attemptId, paper.images || []);

    // (3) Signatures — เมื่อมีลายเซ็น
    var oldSig = old ? String(old[8] || '') : '';
    var signedAt = old && old[9] ? old[9] : '';
    if (sig) {
      var ssh = ss_().getSheetByName(SHEET_SIGNATURES);
      if (!ssh) throw new Error('ไม่พบชีต "' + SHEET_SIGNATURES + '"');
      ssh.appendRow([now, email, name, dept, course.id, course.title, attemptId, sig]);
      oldSig = sig; signedAt = now;
    }

    // (1) EKG_Results — เก็บคะแนนที่ดีที่สุด (ใช้คะแนนที่แสดงผลเดียวกับกระดาษคำตอบ)
    var bestScore = old ? Math.max(Number(old[4]) || 0, dScore) : dScore;
    var values = [email, name, data.lessonId, course.title, bestScore, dTotal,
                  Math.round(bestScore / dTotal * 100), old ? old[7] : passedAt, oldSig, signedAt, attemptId];
    if (!row) sh.appendRow(values);
    else sh.getRange(row, 1, 1, values.length).setValues([values]);

    return { ok: true, attemptId: attemptId, signed: !!oldSig };
  } finally {
    lock.releaseLock();
  }
}

// หาแถวใน Attempts ด้วย AttemptId (คอลัมน์ที่ 11 — ดูลำดับคอลัมน์ที่ appendRow ด้านบน)
function ekgAttemptsRow_(attemptId) {
  var sh = ss_().getSheetByName(SHEET_ATTEMPTS);
  if (!sh) return 0;
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var ids = sh.getRange(2, 11, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === attemptId) return i + 2;
  }
  return 0;
}

// ========== กระดาษคำตอบ: รูปกราฟต่อข้อ ==========
// ชีต EKG_PaperImages : AttemptId | ลำดับข้อ (0-based) | รูปภาพ (Data URL) | อัปเดตล่าสุด
// เขียนทับ: ลบแถวเดิมของ AttemptId นี้ทิ้งก่อนเขียนชุดใหม่ทุกครั้ง (เก็บเฉพาะรอบล่าสุด ไม่สะสมไม่จำกัด)
var EKG_PAPER_IMG_HEADERS = ['AttemptId', 'ลำดับข้อ', 'รูปภาพ (Data URL)', 'อัปเดตล่าสุด'];
function saveEkgPaperImages_(attemptId, images) {
  if (!attemptId || !Array.isArray(images) || !images.length) return;
  var sh = ekgSheet_('EKG_PaperImages', EKG_PAPER_IMG_HEADERS, '#2563EB');
  var last = sh.getLastRow();
  if (last > 1) {
    var ids = sh.getRange(2, 1, last - 1, 1).getValues();
    for (var i = ids.length - 1; i >= 0; i--) {
      if (String(ids[i][0]) === attemptId) sh.deleteRow(i + 2);
    }
  }
  var now = new Date(), rows = [];
  images.forEach(function (src, i) {
    src = String(src || '');
    // กันข้อมูลเสีย/ใหญ่เกินช่อง (ชีตจำกัดไม่เกิน ~50,000 ตัวอักษรต่อช่อง)
    if (!src || src.indexOf('data:image') !== 0 || src.length > 49000) return;
    rows.push([attemptId, i, src, now]);
  });
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, EKG_PAPER_IMG_HEADERS.length).setValues(rows);
}

// index.html เรียกฟังก์ชันนี้เพื่อดึงรูปกราฟมาแทรกในกระดาษคำตอบ
// keys: อาเรย์ของ 'latest:EKG-xxx' (พนักงานดูของตัวเอง) หรือ AttemptId ตรงๆ (แอดมินดูของคนอื่น)
// คืนค่า { [key]: { imgs: [รูปที่ 1, รูปที่ 2, ...] } }
function getEkgPaperExtras(keys) {
  var out = {};
  if (!Array.isArray(keys) || !keys.length) return out;

  var email = '';
  try {
    var u = (typeof getCurrentUser === 'function') ? getCurrentUser() : null;
    email = (u && u.ok) ? String(u.email).toLowerCase() : ekgEmail_();
  } catch (e) {}

  // แปลง key แบบ 'latest:EKG-xxx' ให้เป็น AttemptId จริงของผู้ใช้ปัจจุบัน (ดูจากชีต EKG_Results)
  var attemptByKey = {};
  keys.forEach(function (k) {
    if (String(k).indexOf('latest:') !== 0) attemptByKey[k] = String(k); // key คือ AttemptId ตรงๆ
  });
  var needLatest = keys.some(function (k) { return String(k).indexOf('latest:') === 0; });
  if (needLatest && email) {
    var rsh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('EKG_Results');
    if (rsh && rsh.getLastRow() > 1) {
      var v = rsh.getRange(2, 1, rsh.getLastRow() - 1, EKG_RESULT_HEADERS.length).getValues();
      for (var i = 0; i < v.length; i++) {
        if (String(v[i][0]).toLowerCase() !== email) continue;
        var key = 'latest:EKG-' + String(v[i][2]);
        if (keys.indexOf(key) !== -1 && v[i][10]) attemptByKey[key] = String(v[i][10]);
      }
    }
  }

  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('EKG_PaperImages');
  var byAttempt = {};
  if (sh && sh.getLastRow() > 1) {
    var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();
    rows.forEach(function (r) {
      var aid = String(r[0]);
      if (!byAttempt[aid]) byAttempt[aid] = [];
      byAttempt[aid][Number(r[1])] = String(r[2] || '');
    });
  }

  keys.forEach(function (k) {
    var aid = attemptByKey[k];
    if (aid && byAttempt[aid]) out[k] = { imgs: byAttempt[aid] };
  });
  return out;
}

// ========== บันทึกผลการเรียน (ฉบับเดิม) ==========
function saveEkgProgress(data) {
  var sheet = ekgSheet_('EKG_Progress', ['Email', 'ชื่อ', 'บทเรียน', 'คะแนน', 'คะแนนเต็ม', 'เวลาที่ทำเสร็จ']);
  var email = '';
  try { email = Session.getActiveUser().getEmail(); } catch (e) { email = 'unknown'; }
  sheet.appendRow([email, email.split('@')[0], data.lessonTitle || '', data.score || 0, data.total || 0, new Date()]);
  return { ok: true };
}
function getEkgSignedLessons() {
  var email = ekgEmail_();
  var out = [];
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1) จาก EKG_Results คอลัมน์ลายเซ็น
  var sh = ss.getSheetByName('EKG_Results');
  if (sh && sh.getLastRow() > 1) {
    var v = sh.getRange(2, 1, sh.getLastRow() - 1, EKG_RESULT_HEADERS.length).getValues();
    for (var i = 0; i < v.length; i++) {
      if (String(v[i][0]).toLowerCase() !== email) continue;
      if (String(v[i][8] || '').indexOf('data:image') === 0) out.push(String(v[i][2]));
    }
  }

  // 2) จากชีต Signatures ซึ่งเก็บ courseId เป็น EKG-xxx
  var sg = ss.getSheetByName(SHEET_SIGNATURES);
  if (sg && sg.getLastRow() > 1) {
    var w = sg.getRange(2, 1, sg.getLastRow() - 1, sg.getLastColumn()).getValues();
    for (var j = 0; j < w.length; j++) {
      if (String(w[j][1]).toLowerCase() !== email) continue;
      var cid = String(w[j][4] || '');
      if (cid.indexOf('EKG-') === 0) {
        var id = cid.substring(4);
        if (out.indexOf(id) < 0) out.push(id);
      }
    }
  }

  return out;
}

