/**
 * ShiftRequestBackend.gs
 * ฟีเจอร์ "ขอเวรหยุด" (Off-day / เวรสั้น request) — Phase 1
 * เพิ่มเป็นไฟล์ใหม่ในโปรเจกต์ Apps Script เดิม ไม่แก้ Code.gs
 * ตั้งชื่อไฟล์นี้ใน Apps Script ว่า "ShiftRequestBackend" (ห้ามตั้งชื่อ "ShiftRequest" ซ้ำกับ
 * ไฟล์ HTML หน้าพนักงาน เพราะ Apps Script ใช้ชื่อไฟล์ร่วมกันข้ามชนิดไฟล์ ตั้งชื่อซ้ำกันไม่ได้)
 * ใช้ getCurrentUser() และ getSheet_() ที่มีอยู่แล้วใน Code.gs (global scope เดียวกัน)
 *
 * แผ่นงาน (Sheets) ที่ไฟล์นี้ใช้ — จะถูกสร้างอัตโนมัติถ้ายังไม่มี:
 *   - Users          (มีอยู่แล้ว ต้องมีคอลัมน์ Position, Level เพิ่มเข้ามา)
 *   - ShiftQuota      (โควต้าตามวันในสัปดาห์ ต่อเดือน ต่อ "กลุ่มโควต้า": RN แยก / PN+NA รวมกัน)
 *   - OffRequests     (คำขอ Off / เวรสั้น รายบุคคล)
 */

// ================== CONFIG ==================
const SHEET_SHIFT_QUOTA   = 'ShiftQuota';
const SHEET_OFF_REQUESTS  = 'OffRequests';
const SHEET_SHIFT_NOTES   = 'ShiftNotes'; // หมายเหตุเพิ่มเติมของพนักงาน แยกต่างหากจากคำขอ (1 คน 1 ข้อความ ต่อ 1 เดือน)
const SHIFT_NOTE_MAX_LEN  = 1000;

const SHIFT_POSITIONS = ['RN', 'PN', 'NA', 'หัวหน้าแผนก'];
const SHIFT_WEEKDAY_LABEL = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']; // index = Date.getDay() (0=Sun)
const SHIFT_DEADLINE_DAY = 20; // ต้องขอ/แก้ไข/ยกเลิก ให้เสร็จภายในวันที่ 20 ของ "เดือนก่อนหน้า" เวลา 24:00

// PN และ NA นับโควต้าขอเวรหยุด/เวรสั้น "ร่วมกัน" เป็นกลุ่มเดียว (ต่างกันแค่ตอนคิดชั่วโมงทำงานตอนจัดตารางเวรจริง)
// RN แยกโควต้าของตัวเอง, หัวหน้าแผนก (ตำแหน่งพิเศษ) แยกโควต้าของตัวเองอีกกลุ่มหนึ่งต่างหาก (ไม่ปนกับโควต้า RN ปกติ)
// ดังนั้นระบบตั้งค่าและนับโควต้าเป็น "กลุ่ม" (RN, PNNA, HEAD) ไม่ใช่แยกทีละตำแหน่ง
const SHIFT_QUOTA_GROUPS = ['RN', 'PNNA', 'HEAD'];
const SHIFT_QUOTA_GROUP_LABEL = { RN: 'RN', PNNA: 'PN/NA (รวมกัน)', HEAD: 'หัวหน้าแผนก' };
function Shift_quotaGroup_(position) {
  if (position === 'RN') return 'RN';
  if (position === 'หัวหน้าแผนก') return 'HEAD'; // หัวหน้าแผนกมีโควต้าของตัวเองแยกต่างหาก ไม่นับรวมกับ RN ทั่วไป
  return 'PNNA'; // PN และ NA ทั้งคู่ตกกลุ่ม PNNA
}

// คำขอ "ขึ้น CP" (ไปขึ้นแผนก CP ทั้งวัน — ไม่ใช่วันหยุด ไม่กระทบโควต้า Off/เวรสั้น) เปิดให้เฉพาะตำแหน่ง RN และหัวหน้าแผนก
function Shift_canRequestCP_(position) {
  return position === 'RN' || position === 'หัวหน้าแผนก';
}

// คำขอ "ER" (ไปทำงานนอก OPD1 สำหรับ PN/NA — เทียบเท่า CP ของ RN แต่ไม่นับชั่วโมงงาน แค่มาร์กไว้ว่าไป ER)
// เปิดให้เฉพาะตำแหน่ง PN และ NA เท่านั้น ไม่กระทบโควต้า Off/เวรสั้น/สาย มีโควต้าของตัวเองแยกต่างหาก
function Shift_canRequestER_(position) {
  return position === 'PN' || position === 'NA';
}
// ป้ายชื่อที่แสดงให้ผู้ใช้เห็นของคำขอประเภท ER — ภายในระบบและในชีตยังใช้รหัส 'ER' / 'ERSlots' เหมือนเดิม
const SHIFT_ER_LABEL = 'แผนกอื่น';

/**
 * จุดเดียวที่ตัดสินว่า "วันนี้ประเภทนี้เต็มหรือยัง" — ใช้ร่วมกันทั้งฝั่งพนักงานและฝั่ง admin
 *
 * กติกาพิเศษ: คนที่จะไปช่วยแผนกอื่นได้ ต้องเป็นคนที่ "หยุด" จาก OPD1 ในวันนั้น
 * ดังนั้นคำขอแผนกอื่น 1 คน = กินโควต้าวันหยุด (Off) ไป 1 ที่ด้วยเสมอ
 *   เช่น maxOff=3, erSlots=1 → ถ้ามีคนขอแผนกอื่น 1 คน จะเหลือคนขอ Off ได้อีกแค่ 2 คน
 *
 * activeSameDate = คำขอ Active ของวันนั้น เฉพาะกลุ่มโควต้าเดียวกัน
 * excludeRow     = เลขแถวของคำขอเดิมของคนที่กำลังขออยู่ (ไม่ให้นับตัวเองซ้ำ) ส่ง null ถ้าไม่มี
 */
function Shift_quotaCheck_(activeSameDate, excludeRow, type, quota) {
  function cnt(t) {
    return activeSameDate.filter(function (r) {
      return r.Type === t && (!excludeRow || r.__row !== excludeRow);
    }).length;
  }
  const offLike = cnt('Off') + cnt('ER'); // คำขอแผนกอื่นนับรวมเป็นวันหยุดด้วย

  if (type === 'Off') {
    if (offLike >= quota.maxOff) return { full: true, label: 'วันหยุด (X)', max: quota.maxOff };
    return { full: false };
  }
  if (type === 'ER') {
    if (cnt('ER') >= quota.erSlots) return { full: true, label: SHIFT_ER_LABEL, max: quota.erSlots };
    if (offLike >= quota.maxOff) return { full: true, label: SHIFT_ER_LABEL + ' — โควต้าวันหยุด (X)', max: quota.maxOff };
    return { full: false };
  }
  const spec = { ShortShift: ['เวรสั้น', quota.shortSlots], CP: ['ขึ้น CP', quota.cpSlots], Late: ['สาย', quota.lateSlots] }[type];
  if (!spec) return { full: true, label: 'ไม่ทราบประเภท', max: 0 };
  if (cnt(type) >= spec[1]) return { full: true, label: spec[0], max: spec[1] };
  return { full: false };
}

/** ข้อความแจ้งเตือนตอนโควต้าเต็ม (ใช้ร่วมกันทั้งพนักงานและ admin) */
function Shift_fullMessage_(check, quota, group, dateStr) {
  const groupLabel = SHIFT_QUOTA_GROUP_LABEL[group];
  const noteTail = quota.overrideNote ? ' (หมายเหตุ: ' + quota.overrideNote + ')' : '';
  if (check.max === 0 && quota.isOverride) {
    return 'วันที่ ' + dateStr + ' ปิดรับคำขอ ' + check.label + ' สำหรับกลุ่ม ' + groupLabel + ' เป็นกรณีพิเศษ' + noteTail;
  }
  if (check.max === 0) {
    return 'วันที่ ' + dateStr + ' ไม่เปิดให้ขอ ' + check.label + ' สำหรับกลุ่ม ' + groupLabel;
  }
  return 'โควต้า ' + check.label + ' ของกลุ่ม ' + groupLabel + ' วันที่ ' + dateStr + ' เต็มแล้ว (' + check.max + ' คน)' + noteTail;
}

// คำขอ "สาย" (ขอขึ้นเวรที่เข้างานสายที่สุดของวันนั้น — ไม่ใช่วันหยุด ไม่กระทบโควต้า Off/เวรสั้น/CP/ER)
// เปิดให้ทุกตำแหน่ง (RN/PN/NA/หัวหน้าแผนก) และนับโควต้าเป็น "กลุ่ม" เหมือน Off/เวรสั้น

// ================== SHEET HELPERS ==================
function Shift_getOrCreateSheet_(name, headers, textCols) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
  }
  // บังคับคอลัมน์ที่เก็บข้อความแบบ "YYYY-MM" / "YYYY-MM-DD" ให้เป็น Plain text เสมอ
  // กัน Google Sheets แปลงเป็น Date object เองอัตโนมัติตอนบันทึก (ต้นเหตุบั๊ก "บันทึกแล้วโหลดไม่เจอ")
  if (textCols && textCols.length) {
    textCols.forEach(function (col) {
      sh.getRange(1, col, Math.max(sh.getMaxRows(), 2000), 1).setNumberFormat('@');
    });
  }
  return sh;
}

function Shift_quotaSheet_() {
  const sh = Shift_getOrCreateSheet_(SHEET_SHIFT_QUOTA, ['Month', 'Position', 'Weekday', 'MaxOff', 'ShortSlots', 'CPSlots', 'LateSlots', 'ERSlots'], [1]);
  // migration: ชีตเก่าที่สร้างไว้ก่อนมีฟีเจอร์ CP/สาย/ER จะยังไม่มีคอลัมน์เหล่านี้ — เพิ่มท้ายตารางให้อัตโนมัติครั้งเดียว
  const lastCol = Math.max(sh.getLastColumn(), 1);
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  if (headers.indexOf('CPSlots') === -1) {
    sh.getRange(1, headers.length + 1).setValue('CPSlots');
  }
  const headers2 = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
  if (headers2.indexOf('LateSlots') === -1) {
    sh.getRange(1, headers2.length + 1).setValue('LateSlots');
  }
  const headers3 = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
  if (headers3.indexOf('ERSlots') === -1) {
    sh.getRange(1, headers3.length + 1).setValue('ERSlots');
  }
  return sh;
}

function Shift_requestSheet_() {
  return Shift_getOrCreateSheet_(SHEET_OFF_REQUESTS,
    ['RequestId', 'Timestamp', 'Email', 'Name', 'Position', 'Level', 'Month', 'Date', 'Type', 'Status', 'UpdatedAt'], [7, 8]);
}

function Shift_notesSheet_() {
  return Shift_getOrCreateSheet_(SHEET_SHIFT_NOTES, ['Month', 'Email', 'Name', 'Position', 'Note', 'UpdatedAt'], [1]);
}

// ป้องกันปัญหา Google Sheets แปลงข้อความหน้าตาเหมือนวันที่ ("2026-09", "2026-09-05") เป็น Date object
// เองตอนบันทึก (แม้จะตั้งคอลัมน์เป็น Plain text แล้ว ข้อมูลเก่าที่เคยถูกแปลงไปแล้วก็ยังต้องอ่านให้ถูก)
// ฟังก์ชันนี้แปลงกลับเป็น string รูปแบบเดิมเสมอ ไม่ว่าค่าที่อ่านได้จากชีตจะเป็น Date หรือ string ก็ตาม
function Shift_normMonth_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM');
  }
  return String(v == null ? '' : v).trim();
}
function Shift_normDate_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(v == null ? '' : v).trim();
}

function Shift_sheetToObjects_(sh) {
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return { headers: data[0] || [], rows: [] };
  const headers = data[0];
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = data[i][idx]; });
    obj.__row = i + 1; // 1-based sheet row number, for updates
    rows.push(obj);
  }
  return { headers, rows };
}

// ================== USER / POSITION HELPERS ==================
function Shift_getCurrentUserWithPosition_() {
  const base = getCurrentUser(); // จาก Code.gs
  if (!base || !base.ok) return null;
  const sh = getSheet_(SHEET_USERS); // จาก Code.gs
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const idxEmail = headers.indexOf('Email');
  const idxPos = headers.indexOf('Position');
  const idxLevel = headers.indexOf('Level');
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idxEmail]).trim().toLowerCase() === base.email.trim().toLowerCase()) {
      base.position = idxPos >= 0 ? String(data[i][idxPos] || '').trim() : '';
      base.level = idxLevel >= 0 ? String(data[i][idxLevel] || '').trim() : '';
      break;
    }
  }
  base.isAdmin = (base.role === 'admin' || base.role === 'hr');
  return base;
}

function Shift_isAdmin_() {
  const u = Shift_getCurrentUserWithPosition_();
  return !!(u && u.isAdmin);
}

// ================== DEADLINE ==================
// เดดไลน์ของเดือนเป้าหมาย monthStr ("YYYY-MM") คือ วันที่ 20 ของเดือนก่อนหน้า เวลา 24:00 (สิ้นสุดวันที่ 20)
function Shift_getDeadline_(monthStr) {
  const [y, m] = monthStr.split('-').map(Number); // m = 1-12, เดือนเป้าหมาย
  // เดดไลน์ = วันที่ 20 ของ "เดือนก่อนหน้า" เวลา 23:59:59.999 (สิ้นสุดวันที่ 20 = 24:00)
  // Date(year, monthIndex0, day) โดย monthIndex0 ของเดือนก่อนหน้า = (m-1)-1 = m-2
  return new Date(y, m - 2, SHIFT_DEADLINE_DAY, 23, 59, 59, 999);
}

function Shift_isMonthLocked_(monthStr) {
  return new Date() > Shift_getDeadline_(monthStr);
}

// ================== QUOTA ==================
// คืนค่า quota ของเดือนนั้น เป็น map ตาม "กลุ่มโควต้า": { "RN": {0:{maxOff,shortSlots}, ...}, "PNNA": {...} }
function Shift_getQuotaMap_(monthStr) {
  const { rows } = Shift_sheetToObjects_(Shift_quotaSheet_());
  const map = {};
  SHIFT_QUOTA_GROUPS.forEach(g => { map[g] = {}; });
  rows.filter(r => Shift_normMonth_(r.Month) === monthStr).forEach(r => {
    const group = String(r.Position); // คอลัมน์ชื่อ Position ในชีต ShiftQuota เก็บค่า "กลุ่มโควต้า" (RN / PNNA)
    const wd = Number(r.Weekday);
    if (!map[group]) map[group] = {};
    map[group][wd] = { maxOff: Number(r.MaxOff) || 0, shortSlots: Number(r.ShortSlots) || 0, cpSlots: Number(r.CPSlots) || 0, lateSlots: Number(r.LateSlots) || 0, erSlots: Number(r.ERSlots) || 0 };
  });
  return map;
}

function Shift_getQuotaSettings(monthStr) {
  if (!Shift_isAdmin_()) return { ok: false, message: 'ไม่มีสิทธิ์เข้าถึง' };
  const map = Shift_getQuotaMap_(monthStr);
  const hasData = SHIFT_QUOTA_GROUPS.some(g => Object.keys(map[g] || {}).length > 0);
  const rows = [];
  SHIFT_QUOTA_GROUPS.forEach(group => {
    for (let wd = 0; wd <= 6; wd++) {
      const cell = (map[group] && map[group][wd]) || { maxOff: 0, shortSlots: 1, cpSlots: 0, lateSlots: 0, erSlots: 0 };
      rows.push({ position: group, label: SHIFT_QUOTA_GROUP_LABEL[group], weekday: wd, weekdayLabel: SHIFT_WEEKDAY_LABEL[wd], maxOff: cell.maxOff, shortSlots: cell.shortSlots, cpSlots: cell.cpSlots, lateSlots: cell.lateSlots, erSlots: cell.erSlots });
    }
  });
  return { ok: true, hasData, rows, deadline: Shift_getDeadline_(monthStr).toISOString() };
}

function Shift_saveQuotaSettings(monthStr, rows) {
  if (!Shift_isAdmin_()) return { ok: false, message: 'ไม่มีสิทธิ์เข้าถึง' };
  const sh = Shift_quotaSheet_();
  const { rows: existing } = Shift_sheetToObjects_(sh);
  // ลบแถวเดิมของเดือนนี้ทั้งหมด (ลบจากล่างขึ้นบนเพื่อไม่ให้เลขแถวเพี้ยน)
  existing.filter(r => Shift_normMonth_(r.Month) === monthStr)
    .sort((a, b) => b.__row - a.__row)
    .forEach(r => sh.deleteRow(r.__row));
  // เพิ่มแถวใหม่ (r.position คือค่ากลุ่มโควต้า RN / PNNA / HEAD — CPSlots มีความหมายเฉพาะกลุ่ม RN และ HEAD, ERSlots มีความหมายเฉพาะกลุ่ม PNNA, LateSlots ใช้ได้ทุกกลุ่ม)
  rows.forEach(r => {
    sh.appendRow([monthStr, r.position, r.weekday, Number(r.maxOff) || 0, Number(r.shortSlots) || 0, Number(r.cpSlots) || 0, Number(r.lateSlots) || 0, Number(r.erSlots) || 0]);
  });
  return { ok: true };
}

function Shift_copyQuotaFromPreviousMonth(monthStr) {
  if (!Shift_isAdmin_()) return { ok: false, message: 'ไม่มีสิทธิ์เข้าถึง' };
  const [y, m] = monthStr.split('-').map(Number);
  const prevDate = new Date(y, m - 2, 1);
  const prevMonthStr = Utilities.formatDate(prevDate, Session.getScriptTimeZone(), 'yyyy-MM');
  const map = Shift_getQuotaMap_(prevMonthStr);
  const hasData = SHIFT_QUOTA_GROUPS.some(g => Object.keys(map[g] || {}).length > 0);
  if (!hasData) return { ok: false, message: 'เดือนก่อนหน้า (' + prevMonthStr + ') ยังไม่มีการตั้งค่าโควต้า' };
  const rows = [];
  SHIFT_QUOTA_GROUPS.forEach(group => {
    for (let wd = 0; wd <= 6; wd++) {
      const cell = (map[group] && map[group][wd]) || { maxOff: 0, shortSlots: 1, cpSlots: 0, lateSlots: 0, erSlots: 0 };
      rows.push({ position: group, weekday: wd, maxOff: cell.maxOff, shortSlots: cell.shortSlots, cpSlots: cell.cpSlots, lateSlots: cell.lateSlots, erSlots: cell.erSlots });
    }
  });
  Shift_saveQuotaSettings(monthStr, rows);
  return { ok: true, rows, copiedFrom: prevMonthStr };
}

// ================== MONTHLY VIEW (Employee) ==================
function Shift_getMonthlyView(monthStr) {
  const me = Shift_getCurrentUserWithPosition_();
  if (!me) return { ok: false, message: 'ไม่พบข้อมูลผู้ใช้ กรุณาติดต่อผู้ดูแลระบบ' };
  if (!me.position) return { ok: false, message: 'บัญชีของคุณยังไม่ได้ตั้งค่าตำแหน่งงาน (Position) กรุณาแจ้งหัวหน้าแผนก' };

  const [y, m] = monthStr.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const quotaMap = Shift_getQuotaMap_(monthStr);
  const ovMap = Shift_getOverrideMap_(monthStr);
  const { rows: allRequests } = Shift_sheetToObjects_(Shift_requestSheet_());
  const activeThisMonth = allRequests.filter(r => Shift_normMonth_(r.Month) === monthStr && r.Status === 'Active');

  const days = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(y, m - 1, d);
    const wd = dateObj.getDay();
    const dateStr = Utilities.formatDate(dateObj, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    const byPosition = {};
    SHIFT_POSITIONS.forEach(pos => {
      const group = Shift_quotaGroup_(pos);
      const quota = Shift_quotaFor_(quotaMap, ovMap, dateStr, wd, group);
      const pick = t => activeThisMonth.filter(r => Shift_normDate_(r.Date) === dateStr && Shift_quotaGroup_(r.Position) === group && r.Type === t);
      const tag = r => r.Name + (r.Position !== pos ? ' (' + r.Position + ')' : '');
      const offReqs = pick('Off');
      const shortReqs = pick('ShortShift');
      const cpReqs = pick('CP');
      const lateReqs = pick('Late');
      const erReqs = pick('ER');
      byPosition[pos] = {
        // offCount/offNames รวมคำขอแผนกอื่นเข้ามาด้วย เพราะใช้โควต้าวันหยุดร่วมกัน
        // (คนที่ไปช่วยแผนกอื่นต้องเป็นคนที่หยุดจาก OPD1) — ติดป้าย [แผนกอื่น] ให้เห็นชัดว่าใครเป็นแบบไหน
        maxOff: quota.maxOff,
        offCount: offReqs.length + erReqs.length,
        offNames: offReqs.map(tag).concat(erReqs.map(r => tag(r) + ' [' + SHIFT_ER_LABEL + ']')),
        offOnlyCount: offReqs.length,
        offOnlyNames: offReqs.map(tag),
        shortSlots: quota.shortSlots, shortCount: shortReqs.length, shortNames: shortReqs.map(tag),
        cpSlots: quota.cpSlots, cpCount: cpReqs.length, cpNames: cpReqs.map(r => r.Name),
        lateSlots: quota.lateSlots, lateCount: lateReqs.length, lateNames: lateReqs.map(tag),
        erSlots: quota.erSlots, erCount: erReqs.length, erNames: erReqs.map(tag),
        isOverride: quota.isOverride,
        overrideNote: quota.overrideNote
      };
    });
    const mine = activeThisMonth.find(r => Shift_normDate_(r.Date) === dateStr && String(r.Email).toLowerCase() === me.email.toLowerCase());
    days.push({
      date: dateStr, weekday: wd, weekdayLabel: SHIFT_WEEKDAY_LABEL[wd],
      byPosition, myRequest: mine ? mine.Type : null,
      isOverride: !!ovMap[dateStr],
      overrideNote: Shift_overrideNoteFor_(ovMap, dateStr)
    });
  }

  return {
    ok: true,
    month: monthStr,
    me: { email: me.email, name: me.name, position: me.position, level: me.level, isAdmin: me.isAdmin, canCP: Shift_canRequestCP_(me.position), canER: Shift_canRequestER_(me.position) },
    isLocked: Shift_isMonthLocked_(monthStr),
    deadline: Shift_getDeadline_(monthStr).toISOString(),
    days
  };
}



// ================== SUBMIT / CANCEL ==================
function Shift_submitRequest(dateStr, type) {
  const me = Shift_getCurrentUserWithPosition_();
  if (!me) return { ok: false, message: 'ไม่พบข้อมูลผู้ใช้' };
  if (!me.position) return { ok: false, message: 'บัญชีของคุณยังไม่ได้ตั้งค่าตำแหน่งงาน' };
  if (['Off', 'ShortShift', 'CP', 'Late', 'ER'].indexOf(type) === -1) return { ok: false, message: 'ประเภทคำขอไม่ถูกต้อง' };
  if (type === 'CP' && !Shift_canRequestCP_(me.position)) return { ok: false, message: 'คำขอไปขึ้น CP เปิดให้เฉพาะตำแหน่ง RN และหัวหน้าแผนกเท่านั้น' };
  if (type === 'ER' && !Shift_canRequestER_(me.position)) return { ok: false, message: 'คำขอไป' + SHIFT_ER_LABEL + ' เปิดให้เฉพาะตำแหน่ง PN และ NA เท่านั้น' };

  const monthStr = dateStr.slice(0, 7);
  if (Shift_isMonthLocked_(monthStr)) {
    return { ok: false, message: 'เลยกำหนดเวลาแก้ไขคำขอของเดือนนี้แล้ว (ปิดรับทุกวันที่ 20 ของเดือนก่อนหน้า เวลา 24:00)' };
  }

  const wd = new Date(dateStr + 'T00:00:00').getDay();
  const group = Shift_quotaGroup_(me.position);
  const quotaMap = Shift_getQuotaMap_(monthStr);
  const ovMap = Shift_getOverrideMap_(monthStr);
  const quota = Shift_quotaFor_(quotaMap, ovMap, dateStr, wd, group);

  const sh = Shift_requestSheet_();
  const { rows } = Shift_sheetToObjects_(sh);
  const activeSameDate = rows.filter(r => Shift_normDate_(r.Date) === dateStr && Shift_quotaGroup_(r.Position) === group && r.Status === 'Active');
  const myExisting = activeSameDate.find(r => String(r.Email).toLowerCase() === me.email.toLowerCase());

  const check = Shift_quotaCheck_(activeSameDate, myExisting ? myExisting.__row : null, type, quota);
  if (check.full) {
    return { ok: false, alarm: true, message: Shift_fullMessage_(check, quota, group, dateStr) + ' กรุณาเลือกวันอื่น' };
  }

  const now = new Date();
  if (myExisting) {
    sh.getRange(myExisting.__row, 1, 1, 11).setValues([[
      myExisting.RequestId, myExisting.Timestamp, me.email, me.name, me.position, me.level, monthStr, dateStr, type, 'Active', now
    ]]);
  } else {
    sh.appendRow([Utilities.getUuid(), now, me.email, me.name, me.position, me.level, monthStr, dateStr, type, 'Active', now]);
  }
  return { ok: true, message: 'บันทึกคำขอเรียบร้อย' };
}



function Shift_cancelRequest(dateStr) {
  const me = Shift_getCurrentUserWithPosition_();
  if (!me) return { ok: false, message: 'ไม่พบข้อมูลผู้ใช้' };

  const monthStr = dateStr.slice(0, 7);
  if (Shift_isMonthLocked_(monthStr)) {
    return { ok: false, message: 'เลยกำหนดเวลาแก้ไข/ยกเลิกคำขอของเดือนนี้แล้ว' };
  }

  const sh = Shift_requestSheet_();
  const { rows } = Shift_sheetToObjects_(sh);
  const mine = rows.find(r => Shift_normDate_(r.Date) === dateStr && r.Status === 'Active' && String(r.Email).toLowerCase() === me.email.toLowerCase());
  if (!mine) return { ok: false, message: 'ไม่พบคำขอของคุณในวันนี้' };

  sh.getRange(mine.__row, 10).setValue('Cancelled'); // column 10 = Status
  sh.getRange(mine.__row, 11).setValue(new Date());  // column 11 = UpdatedAt
  return { ok: true, message: 'ยกเลิกคำขอเรียบร้อย' };
}

// ================== หมายเหตุเพิ่มเติมของพนักงาน (แยกจากคำขอ ไม่กระทบโควต้า) ==================
// พนักงานเขียนข้อความอิสระได้ 1 ข้อความต่อเดือน — ไม่ติดล็อกเดดไลน์ (แก้ไขได้เสมอ) เพราะเป็นแค่ข้อความ ไม่ใช่คำขอที่กระทบโควต้า
// Admin จะเห็นข้อความนี้พร้อมกับคำขอทั้งหมดตอนกด "ส่งออกคำขอทั้งเดือน"
function Shift_getMyNote(monthStr) {
  const me = Shift_getCurrentUserWithPosition_();
  if (!me) return { ok: false, message: 'ไม่พบข้อมูลผู้ใช้' };
  const { rows } = Shift_sheetToObjects_(Shift_notesSheet_());
  const mine = rows.find(r => Shift_normMonth_(r.Month) === monthStr && String(r.Email).toLowerCase() === me.email.toLowerCase());
  return { ok: true, note: mine ? String(mine.Note == null ? '' : mine.Note) : '' };
}

function Shift_saveMyNote(monthStr, note) {
  const me = Shift_getCurrentUserWithPosition_();
  if (!me) return { ok: false, message: 'ไม่พบข้อมูลผู้ใช้' };
  const noteText = String(note == null ? '' : note).slice(0, SHIFT_NOTE_MAX_LEN);

  const sh = Shift_notesSheet_();
  const { rows } = Shift_sheetToObjects_(sh);
  const existing = rows.find(r => Shift_normMonth_(r.Month) === monthStr && String(r.Email).toLowerCase() === me.email.toLowerCase());
  const now = new Date();
  if (existing) {
    sh.getRange(existing.__row, 1, 1, 6).setValues([[monthStr, me.email, me.name, me.position, noteText, now]]);
  } else {
    sh.appendRow([monthStr, me.email, me.name, me.position, noteText, now]);
  }
  return { ok: true, message: 'บันทึกหมายเหตุเรียบร้อย' };
}

// ================== ADMIN: POSITION / LEVEL MANAGEMENT ==================
function Shift_getAllUsersPosition() {
  if (!Shift_isAdmin_()) return { ok: false, message: 'ไม่มีสิทธิ์เข้าถึง' };
  const sh = getSheet_(SHEET_USERS);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const idx = {
    email: headers.indexOf('Email'), name: headers.indexOf('Name'),
    dept: headers.indexOf('Department'), role: headers.indexOf('Role'),
    pos: headers.indexOf('Position'), level: headers.indexOf('Level'),
    code: headers.indexOf('EmployeeCode')
  };
  const users = [];
  for (let i = 1; i < data.length; i++) {
    users.push({
      email: data[i][idx.email], name: data[i][idx.name], department: data[i][idx.dept],
      role: data[i][idx.role], position: idx.pos >= 0 ? data[i][idx.pos] : '', level: idx.level >= 0 ? data[i][idx.level] : '',
      code: idx.code >= 0 ? String(data[i][idx.code] || '').trim() : '',
      row: i + 1
    });
  }
  return { ok: true, users, positions: SHIFT_POSITIONS };
}

function Shift_updateUserPosition(email, position, level, employeeCode) {
  if (!Shift_isAdmin_()) return { ok: false, message: 'ไม่มีสิทธิ์เข้าถึง' };
  const sh = getSheet_(SHEET_USERS);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  let idxPos = headers.indexOf('Position');
  let idxLevel = headers.indexOf('Level');
  let idxCode = headers.indexOf('EmployeeCode');
  const idxEmail = headers.indexOf('Email');
  // ถ้ายังไม่มีคอลัมน์ Position/Level/EmployeeCode ให้เพิ่มท้ายตาราง (ทำครั้งเดียวในทางปฏิบัติ)
  if (idxPos === -1) { sh.getRange(1, headers.length + 1).setValue('Position'); idxPos = headers.length; }
  if (idxLevel === -1) { sh.getRange(1, headers.length + (idxPos === headers.length ? 2 : 1)).setValue('Level'); idxLevel = idxPos + 1; }
  if (idxCode === -1) { sh.getRange(1, Math.max(idxPos, idxLevel) + 2).setValue('EmployeeCode'); idxCode = Math.max(idxPos, idxLevel) + 1; }

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idxEmail]).trim().toLowerCase() === String(email).trim().toLowerCase()) {
      sh.getRange(i + 1, idxPos + 1).setValue(position);
      sh.getRange(i + 1, idxLevel + 1).setValue(level);
      sh.getRange(i + 1, idxCode + 1).setValue(employeeCode == null ? '' : String(employeeCode).trim());
      return { ok: true };
    }
  }
  return { ok: false, message: 'ไม่พบพนักงานอีเมลนี้ในระบบ' };
}

// ================== ADMIN: จัดการคำขอแทนพนักงาน (เผื่อพนักงานใช้แอปไม่คล่อง) ==================
// ต่างจาก Shift_submitRequest/Shift_cancelRequest ของพนักงานตรงที่: ไม่ติดล็อกเดดไลน์ (admin แก้ได้เสมอ)
// และรองรับ force=true เพื่อฝืนบันทึกแม้เกินโควต้า (กรณีจำเป็นจริงๆ)
function Shift_admin_getEmployeeList_() {
  const sh = getSheet_(SHEET_USERS);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const idx = {
    email: headers.indexOf('Email'), name: headers.indexOf('Name'),
    dept: headers.indexOf('Department'), pos: headers.indexOf('Position'), level: headers.indexOf('Level'),
    code: headers.indexOf('EmployeeCode')
  };
  const list = [];
  for (let i = 1; i < data.length; i++) {
    const email = data[i][idx.email];
    if (!email) continue;
    list.push({
      email: email, name: data[i][idx.name], department: data[i][idx.dept],
      position: idx.pos >= 0 ? data[i][idx.pos] : '', level: idx.level >= 0 ? data[i][idx.level] : '',
      code: idx.code >= 0 ? String(data[i][idx.code] || '').trim() : ''
    });
  }
  return list;
}

function Shift_admin_getEmployees() {
  if (!Shift_isAdmin_()) return { ok: false, message: 'ไม่มีสิทธิ์เข้าถึง' };
  return { ok: true, users: Shift_admin_getEmployeeList_() };
}

function Shift_admin_getEmployeeMonth(email, monthStr) {
  if (!Shift_isAdmin_()) return { ok: false, message: 'ไม่มีสิทธิ์เข้าถึง' };
  const target = Shift_admin_getEmployeeList_().find(u => String(u.email).toLowerCase() === String(email).toLowerCase());
  if (!target) return { ok: false, message: 'ไม่พบพนักงานอีเมลนี้ในระบบ' };
  if (!target.position) return { ok: false, message: 'พนักงานคนนี้ยังไม่ได้ตั้งค่าตำแหน่งงาน (Position) กรุณาไปตั้งค่าที่แท็บ "ตำแหน่ง/ระดับพนักงาน" ก่อน' };

  const [y, m] = monthStr.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const quotaMap = Shift_getQuotaMap_(monthStr);
  const ovMap = Shift_getOverrideMap_(monthStr);
  const { rows: allRequests } = Shift_sheetToObjects_(Shift_requestSheet_());
  const activeThisMonth = allRequests.filter(r => Shift_normMonth_(r.Month) === monthStr && r.Status === 'Active');
  const group = Shift_quotaGroup_(target.position);

  const days = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(y, m - 1, d);
    const wd = dateObj.getDay();
    const dateStr = Utilities.formatDate(dateObj, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    const quota = Shift_quotaFor_(quotaMap, ovMap, dateStr, wd, group);
    const n = t => activeThisMonth.filter(r => Shift_normDate_(r.Date) === dateStr && Shift_quotaGroup_(r.Position) === group && r.Type === t).length;
    const erCount = n('ER');
    const mine = activeThisMonth.find(r => Shift_normDate_(r.Date) === dateStr && String(r.Email).toLowerCase() === target.email.toLowerCase());
    days.push({
      date: dateStr, weekday: wd,
      // offCount รวมคำขอแผนกอื่นด้วย เพราะใช้โควต้าวันหยุดร่วมกัน
      maxOff: quota.maxOff, offCount: n('Off') + erCount, offOnlyCount: n('Off'),
      shortSlots: quota.shortSlots, shortCount: n('ShortShift'),
      cpSlots: quota.cpSlots || 0, cpCount: n('CP'),
      lateSlots: quota.lateSlots || 0, lateCount: n('Late'),
      erSlots: quota.erSlots || 0, erCount: erCount,
      current: mine ? mine.Type : null,
      isOverride: quota.isOverride,
      overrideNote: quota.overrideNote
    });
  }

  return {
    ok: true, month: monthStr,
    canCP: Shift_canRequestCP_(target.position),
    canER: Shift_canRequestER_(target.position),
    employee: { email: target.email, name: target.name, department: target.department, position: target.position, level: target.level },
    isLocked: Shift_isMonthLocked_(monthStr),
    deadline: Shift_getDeadline_(monthStr).toISOString(),
    days
  };
}



function Shift_admin_setRequest(email, dateStr, type, force) {
  if (!Shift_isAdmin_()) return { ok: false, message: 'ไม่มีสิทธิ์เข้าถึง' };
  if (['Off', 'ShortShift', 'CP', 'Late', 'ER'].indexOf(type) === -1) return { ok: false, message: 'ประเภทคำขอไม่ถูกต้อง' };

  const target = Shift_admin_getEmployeeList_().find(u => String(u.email).toLowerCase() === String(email).toLowerCase());
  if (!target) return { ok: false, message: 'ไม่พบพนักงานอีเมลนี้ในระบบ' };
  if (!target.position) return { ok: false, message: 'พนักงานคนนี้ยังไม่ได้ตั้งค่าตำแหน่งงาน' };
  if (type === 'CP' && !Shift_canRequestCP_(target.position)) return { ok: false, message: 'คำขอไปขึ้น CP เปิดให้เฉพาะตำแหน่ง RN และหัวหน้าแผนกเท่านั้น' };
  if (type === 'ER' && !Shift_canRequestER_(target.position)) return { ok: false, message: 'คำขอไป' + SHIFT_ER_LABEL + ' เปิดให้เฉพาะตำแหน่ง PN และ NA เท่านั้น' };

  const monthStr = dateStr.slice(0, 7);
  const wd = new Date(dateStr + 'T00:00:00').getDay();
  const group = Shift_quotaGroup_(target.position);
  const quotaMap = Shift_getQuotaMap_(monthStr);
  const ovMap = Shift_getOverrideMap_(monthStr);
  const quota = Shift_quotaFor_(quotaMap, ovMap, dateStr, wd, group);

  const sh = Shift_requestSheet_();
  const { rows } = Shift_sheetToObjects_(sh);
  const activeSameDate = rows.filter(r => Shift_normDate_(r.Date) === dateStr && Shift_quotaGroup_(r.Position) === group && r.Status === 'Active');
  const existingForTarget = activeSameDate.find(r => String(r.Email).toLowerCase() === target.email.toLowerCase());

  if (!force) {
    const check = Shift_quotaCheck_(activeSameDate, existingForTarget ? existingForTarget.__row : null, type, quota);
    if (check.full) {
      return { ok: false, alarm: true, message: Shift_fullMessage_(check, quota, group, dateStr) + ' ต้องการฝืนบันทึกเกินโควต้าหรือไม่?' };
    }
  }

  const now = new Date();
  if (existingForTarget) {
    sh.getRange(existingForTarget.__row, 1, 1, 11).setValues([[
      existingForTarget.RequestId, existingForTarget.Timestamp, target.email, target.name, target.position, target.level, monthStr, dateStr, type, 'Active', now
    ]]);
  } else {
    sh.appendRow([Utilities.getUuid(), now, target.email, target.name, target.position, target.level, monthStr, dateStr, type, 'Active', now]);
  }
  return { ok: true, message: 'บันทึกคำขอแทนพนักงานเรียบร้อย' };
}



function Shift_admin_cancelRequest(email, dateStr) {
  if (!Shift_isAdmin_()) return { ok: false, message: 'ไม่มีสิทธิ์เข้าถึง' };
  const sh = Shift_requestSheet_();
  const { rows } = Shift_sheetToObjects_(sh);
  const mine = rows.find(r => Shift_normDate_(r.Date) === dateStr && r.Status === 'Active' && String(r.Email).toLowerCase() === String(email).toLowerCase());
  if (!mine) return { ok: false, message: 'ไม่พบคำขอของพนักงานคนนี้ในวันที่เลือก' };
  sh.getRange(mine.__row, 10).setValue('Cancelled');
  sh.getRange(mine.__row, 11).setValue(new Date());
  return { ok: true, message: 'ยกเลิกคำขอแทนพนักงานเรียบร้อย' };
}

// ================== ADMIN: EXPORT ==================
function Shift_exportMonthlyRequests(monthStr) {
  if (!Shift_isAdmin_()) return { ok: false, message: 'ไม่มีสิทธิ์เข้าถึง' };
  const { rows } = Shift_sheetToObjects_(Shift_requestSheet_());
  const data = rows
    .filter(r => Shift_normMonth_(r.Month) === monthStr && r.Status === 'Active')
    .map(r => Object.assign({}, r, { Date: Shift_normDate_(r.Date) }))
    // เรียงตามวันที่ก่อน แล้วเรียงตามเวลาที่ขอ (UpdatedAt) จากเก่าไปใหม่ ภายในวันเดียวกัน — จะได้เห็นว่าใครขอ/กดยืนยันไว้ก่อนเมื่อโควต้าชนกัน
    .sort((a, b) => {
      if (a.Date !== b.Date) return a.Date < b.Date ? -1 : 1;
      const at = a.UpdatedAt instanceof Date ? a.UpdatedAt.getTime() : (a.UpdatedAt ? new Date(a.UpdatedAt).getTime() : 0);
      const bt = b.UpdatedAt instanceof Date ? b.UpdatedAt.getTime() : (b.UpdatedAt ? new Date(b.UpdatedAt).getTime() : 0);
      return at - bt;
    })
    .map(r => {
      // เวลาที่ขอ (ล่าสุด) — ใช้ UpdatedAt เพื่อดูว่าใครกดยืนยันคำขอนี้ไว้ก่อน-หลัง เผื่อโควต้าชนกันในวันเดียวกัน
      const updatedAt = r.UpdatedAt instanceof Date ? r.UpdatedAt : (r.UpdatedAt ? new Date(r.UpdatedAt) : null);
      return {
        date: r.Date, weekday: SHIFT_WEEKDAY_LABEL[new Date(r.Date + 'T00:00:00').getDay()],
        position: r.Position, level: r.Level, name: r.Name, email: r.Email,
        type: r.Type === 'Off' ? 'R (ขอหยุด)' : r.Type === 'ShortShift' ? 'เวรสั้น' : r.Type === 'CP' ? 'CP' : r.Type === 'ER' ? 'R* (' + SHIFT_ER_LABEL + ')' : 'สาย',
        requestedAt: (updatedAt && !isNaN(updatedAt.getTime())) ? updatedAt.toISOString() : ''
      };
    });

  // หมายเหตุเพิ่มเติมของพนักงาน (แยกจากคำขอ) — ดึงมาพร้อมกันของเดือนเดียวกัน ให้ Admin เห็นตอนส่งออก
  const { rows: noteRows } = Shift_sheetToObjects_(Shift_notesSheet_());
  const notes = noteRows
    .filter(r => Shift_normMonth_(r.Month) === monthStr && String(r.Note == null ? '' : r.Note).trim() !== '')
    .map(r => ({ name: r.Name, email: r.Email, position: r.Position, note: String(r.Note) }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'th'));

  return { ok: true, rows: data, notes };
}
