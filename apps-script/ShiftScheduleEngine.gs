/**
 * ShiftScheduleEngine.gs
 * ฟีเจอร์ "สร้างตารางเวรอัตโนมัติ (ร่าง)" — Phase 2b
 * เพิ่มเป็นไฟล์ใหม่ในโปรเจกต์ Apps Script เดิม ไม่แก้ไฟล์อื่น
 * ใช้ค่าคงที่/ฟังก์ชันจาก ShiftRequestBackend.gs (global scope เดียวกัน):
 *   Shift_getOrCreateSheet_, Shift_sheetToObjects_, Shift_normMonth_, Shift_normDate_, Shift_isAdmin_,
 *   Shift_quotaGroup_, Shift_requestSheet_, Shift_admin_getEmployeeList_, SHIFT_WEEKDAY_LABEL, SHIFT_POSITIONS
 *
 * แผ่นงาน (Sheets) ใหม่ที่ไฟล์นี้ใช้ — จะถูกสร้างอัตโนมัติถ้ายังไม่มี:
 *   - ShiftPattern         (แพทเทิร์นอัตรากำลังต่อวันในสัปดาห์ ต่อเดือน ต่อกลุ่ม — แก้ไขได้ทุกเดือน)
 *   - ShiftHolidays        (วันหยุดนักขัตฤกษ์ต่อเดือน — แก้ไขได้ทุกเดือน)
 *   - ShiftMandatoryHours  (ชั่วโมงบังคับต่อตำแหน่ง ต่อเดือน — เก็บไว้ใช้ในเฟสคำนวณชั่วโมง/OT ถัดไป)
 *   - ShiftSchedule        (ตารางเวรที่ Admin กด "บันทึกตารางเวร" แล้ว — เป็นผลลัพธ์สุดท้าย ไม่ใช่ตารางร่าง)
 *
 * ข้อควรรู้สำคัญ: ฟังก์ชันสร้างตารางร่าง (Shift_generateDraftSchedule) เป็นแค่ "ร่าง" อัตโนมัติจากกติกาหลักๆ
 * ที่ตกลงกันไว้ — ยังไม่ครอบคลุมทุกเงื่อนไขในไฟล์แพทเทิร์นเวรเดิม (เช่น การเกลี่ยชั่วโมงรวมให้เท่ากันแบบละเอียด,
 * การคำนวณ OT, การยืมชั่วโมง CP มาทบชั่วโมงบังคับ) — Admin ต้องตรวจสอบ/แก้ไขในหน้าตรวจตารางก่อนบันทึกจริงเสมอ
 */

// ================== CONFIG ==================
const SHEET_SHIFT_PATTERN = 'ShiftPattern';
const SHEET_SHIFT_PATTERN_CP = 'ShiftPatternCP'; // จำนวนคนที่ "ต้องมี" ขึ้นเวร CP ต่อวัน (ตั้งค่าได้เฉพาะกลุ่ม RN — ให้ตัวสร้างตารางร่างจัดคนไป CP อัตโนมัติถ้าคนขอเองไม่ครบ)
const SHEET_SHIFT_HOLIDAYS = 'ShiftHolidays';
const SHEET_SHIFT_MANDATORY_HOURS = 'ShiftMandatoryHours';
const SHEET_SHIFT_SCHEDULE = 'ShiftSchedule';

// รหัสพนักงานที่มีกฎพิเศษเฉพาะตัว (ยืนยันกับหัวหน้าแผนกแล้ว จับคู่ผ่านคอลัมน์ "EmployeeCode" ในชีต Users)
const SHIFT_JUNIOR_WEEKEND_CODE = '67114'; // RN Junior: เสาร์-อาทิตย์ ขึ้นได้แค่ CP / เวรสั้น(เฉพาะเสาร์) / Off เท่านั้น ไม่นับอัตรากำลังหลัก OPD1
const SHIFT_PNNA_SENIOR_CODES = ['57084', '59007', '59031']; // PN/NA senior: ต้องมีอย่างน้อย 1 คนคุมเวร 8-20 น. ทุกวัน
const SHIFT_HEAD_POSITION = 'หัวหน้าแผนก';
const SHIFT_SCHEDULE_GROUPS = ['RN', 'PNNA', 'HEAD'];
const SHIFT_SCHEDULE_GROUP_LABEL = { RN: 'RN', PNNA: 'PN/NA (รวมกัน)', HEAD: 'หัวหน้าแผนก' };
// สัญลักษณ์ในตารางเวรที่ส่งออกเป็น Excel สำหรับวันที่ไม่ได้ขึ้นเวร OPD1
const SHIFT_GRID_MARK_REQUEST = 'R';   // พนักงานขอหยุดเอง (Request)
const SHIFT_GRID_MARK_SYSTEM  = 'X';   // ระบบจัดให้หยุดเองตามความเหมาะสม (ไม่ได้ขอ)
const SHIFT_GRID_MARK_OTHER   = 'R*';  // ขอหยุดเพื่อไปช่วยแผนกอื่น — ไม่นับชั่วโมงทำงาน

// ================== SHEET HELPERS ==================
function Shift_patternSheet_() {
  const sh = Shift_getOrCreateSheet_(SHEET_SHIFT_PATTERN, ['Month', 'Group', 'Weekday', 'WeekParity', 'RowIndex', 'StartTime', 'EndTime', 'Count'], [1]);
  // migration: ชีตเก่าที่สร้างไว้ก่อนมีคอลัมน์ Count (ตอนนั้น 1 แถว = 1 คนเสมอ) — เพิ่มคอลัมน์ให้อัตโนมัติครั้งเดียว
  const headers = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
  if (headers.indexOf('Count') === -1) {
    sh.getRange(1, headers.length + 1).setValue('Count');
  }
  return sh;
}
function Shift_patternCPSheet_() {
  return Shift_getOrCreateSheet_(SHEET_SHIFT_PATTERN_CP, ['Month', 'Group', 'Weekday', 'WeekParity', 'RequiredCP'], [1]);
}
function Shift_holidaySheet_() {
  return Shift_getOrCreateSheet_(SHEET_SHIFT_HOLIDAYS, ['Month', 'Date', 'Label'], [1, 2]);
}
function Shift_mandatoryHoursSheet_() {
  return Shift_getOrCreateSheet_(SHEET_SHIFT_MANDATORY_HOURS, ['Month', 'Position', 'Hours'], [1]);
}
function Shift_scheduleSheet_() {
  return Shift_getOrCreateSheet_(SHEET_SHIFT_SCHEDULE,
    ['Month', 'Date', 'Weekday', 'Group', 'SlotIndex', 'StartTime', 'EndTime', 'Email', 'Name', 'Position', 'Note', 'SavedAt'], [1, 2]);
}

// ================== PATTERN อัตรากำลัง (ตั้งค่าต่อเดือน ต่อกลุ่ม) ==================
// byKey เก็บ slot list โดย key = "weekday:weekParity" — weekParity ใช้เฉพาะ PNNA วันจันทร์ (odd/even) วันอื่นใช้ 'all' เสมอ
// byKey[key] = [{ start, end, count }, ...] — 1 แถว = 1 ช่วงเวลา + จำนวนคนที่ต้องมีในช่วงนั้น (ไม่ต้องเพิ่มแถวซ้ำถ้าเวลาเดียวกัน)
function Shift_getPatternSettings(monthStr, group) {
  try {
    if (!Shift_isAdmin_()) return { ok: false, message: 'ไม่มีสิทธิ์เข้าถึง' };
    const { rows } = Shift_sheetToObjects_(Shift_patternSheet_());
    const mine = rows.filter(r => Shift_normMonth_(r.Month) === monthStr && r.Group === group);
    const byKey = {};
    mine.forEach(r => {
      const key = Number(r.Weekday) + ':' + (r.WeekParity || 'all');
      if (!byKey[key]) byKey[key] = [];
      byKey[key].push({ rowIndex: Number(r.RowIndex), start: String(r.StartTime), end: String(r.EndTime), count: Math.max(1, Number(r.Count) || 1) });
    });
    Object.keys(byKey).forEach(k => byKey[k].sort((a, b) => a.rowIndex - b.rowIndex));
    return { ok: true, month: monthStr, group, byKey };
  } catch (e) {
    return { ok: false, message: 'เกิดข้อผิดพลาดใน Shift_getPatternSettings: ' + (e && e.message ? e.message : e) };
  }
}

// เรียกจาก client (google.script.run) เท่านั้น — คืนค่าเป็น JSON string แทน object ตรงๆ
// สาเหตุ: google.script.run ของ Apps Script มีบั๊กที่ยืนยันแล้วจากการ debug ครั้งนี้ — ถ้าเรียกฟังก์ชันเดิมที่คืนค่าเป็น
// object/array ซับซ้อนเป็นครั้งที่ 2 ขึ้นไปในหน้าเดียวกัน (เช่น เปลี่ยนเดือนในดรอปดาวน์แล้วโหลดใหม่) success handler
// จะได้ค่า null แทนค่าจริง ทั้งที่ server คืนค่าถูกต้อง 100% (ยืนยันจาก Executions log) — การ stringify เป็น string
// ก่อนส่งข้าม แล้วให้ client JSON.parse เอง จะเลี่ยงบั๊กนี้ได้ เพราะ string ไม่โดนบั๊กนี้
function Shift_getPatternSettingsJSON(monthStr, group) {
  return JSON.stringify(Shift_getPatternSettings(monthStr, group));
}

// weekdaySlots: [{ weekday:0-6, weekParity:'all'|'odd'|'even', slots:[{start,end,count}, ...] }, ...]
function Shift_savePatternSettings(monthStr, group, weekdaySlots) {
  if (!Shift_isAdmin_()) return { ok: false, message: 'ไม่มีสิทธิ์เข้าถึง' };
  const sh = Shift_patternSheet_();
  const { rows: existing } = Shift_sheetToObjects_(sh);
  existing.filter(r => Shift_normMonth_(r.Month) === monthStr && r.Group === group)
    .sort((a, b) => b.__row - a.__row).forEach(r => sh.deleteRow(r.__row));
  (weekdaySlots || []).forEach(w => {
    (w.slots || []).forEach((s, idx) => {
      if (!s.start || !s.end) return;
      sh.appendRow([monthStr, group, w.weekday, w.weekParity || 'all', idx + 1, s.start, s.end, Math.max(1, Number(s.count) || 1)]);
    });
  });
  return { ok: true };
}

function Shift_copyPatternFromPreviousMonth(monthStr, group) {
  if (!Shift_isAdmin_()) return { ok: false, message: 'ไม่มีสิทธิ์เข้าถึง' };
  const [y, m] = monthStr.split('-').map(Number);
  const prevDate = new Date(y, m - 2, 1);
  const prevMonthStr = Utilities.formatDate(prevDate, Session.getScriptTimeZone(), 'yyyy-MM');
  const res = Shift_getPatternSettings(prevMonthStr, group);
  if (!res.ok) return res;
  if (!Object.keys(res.byKey).length) return { ok: false, message: 'เดือนก่อนหน้า (' + prevMonthStr + ') ยังไม่มีการตั้งค่า Pattern ของกลุ่มนี้' };
  const weekdaySlots = Object.keys(res.byKey).map(k => {
    const parts = k.split(':');
    return { weekday: Number(parts[0]), weekParity: parts[1], slots: res.byKey[k].map(s => ({ start: s.start, end: s.end, count: s.count })) };
  });
  Shift_savePatternSettings(monthStr, group, weekdaySlots);
  return { ok: true, copiedFrom: prevMonthStr };
}

// ================== จำนวนคนที่ "ต้องมี" ขึ้นเวร CP ต่อวัน (ตั้งค่าต่อเดือน — ใช้ได้เฉพาะกลุ่ม RN) ==================
// byKey key = "weekday:all" (RN ไม่ต้องแยกสัปดาห์คี่-คู่เหมือน PNNA) -> จำนวนคนที่ต้องมี (0 = ไม่บังคับ ปล่อยให้เป็นไปตามคำขอเองเหมือนเดิม)
function Shift_getPatternCPSettings(monthStr, group) {
  try {
    if (!Shift_isAdmin_()) return { ok: false, message: 'ไม่มีสิทธิ์เข้าถึง' };
    const { rows } = Shift_sheetToObjects_(Shift_patternCPSheet_());
    const mine = rows.filter(r => Shift_normMonth_(r.Month) === monthStr && r.Group === group);
    const byKey = {};
    mine.forEach(r => {
      const key = Number(r.Weekday) + ':' + (r.WeekParity || 'all');
      byKey[key] = Math.max(0, Number(r.RequiredCP) || 0);
    });
    return { ok: true, month: monthStr, group, byKey };
  } catch (e) {
    return { ok: false, message: 'เกิดข้อผิดพลาดใน Shift_getPatternCPSettings: ' + (e && e.message ? e.message : e) };
  }
}

// เรียกจาก client เท่านั้น — เหตุผลเดียวกับ Shift_getPatternSettingsJSON ด้านบน
function Shift_getPatternCPSettingsJSON(monthStr, group) {
  return JSON.stringify(Shift_getPatternCPSettings(monthStr, group));
}

// weekdayRequired: [{ weekday:0-6, weekParity:'all', required:number }, ...]
function Shift_savePatternCPSettings(monthStr, group, weekdayRequired) {
  if (!Shift_isAdmin_()) return { ok: false, message: 'ไม่มีสิทธิ์เข้าถึง' };
  const sh = Shift_patternCPSheet_();
  const { rows: existing } = Shift_sheetToObjects_(sh);
  existing.filter(r => Shift_normMonth_(r.Month) === monthStr && r.Group === group)
    .sort((a, b) => b.__row - a.__row).forEach(r => sh.deleteRow(r.__row));
  (weekdayRequired || []).forEach(w => {
    const n = Math.max(0, Number(w.required) || 0);
    if (n > 0) sh.appendRow([monthStr, group, w.weekday, w.weekParity || 'all', n]);
  });
  return { ok: true };
}

function Shift_copyPatternCPFromPreviousMonth(monthStr, group) {
  if (!Shift_isAdmin_()) return { ok: false, message: 'ไม่มีสิทธิ์เข้าถึง' };
  const [y, m] = monthStr.split('-').map(Number);
  const prevDate = new Date(y, m - 2, 1);
  const prevMonthStr = Utilities.formatDate(prevDate, Session.getScriptTimeZone(), 'yyyy-MM');
  const res = Shift_getPatternCPSettings(prevMonthStr, group);
  if (!res.ok) return res;
  const weekdayRequired = Object.keys(res.byKey).map(k => {
    const parts = k.split(':');
    return { weekday: Number(parts[0]), weekParity: parts[1], required: res.byKey[k] };
  });
  Shift_savePatternCPSettings(monthStr, group, weekdayRequired);
  return { ok: true, copiedFrom: prevMonthStr };
}

// ================== วันหยุดนักขัตฤกษ์ (ตั้งค่าต่อเดือน) ==================
function Shift_getHolidays(monthStr) {
  if (!Shift_isAdmin_()) return { ok: false, message: 'ไม่มีสิทธิ์เข้าถึง' };
  const { rows } = Shift_sheetToObjects_(Shift_holidaySheet_());
  const list = rows.filter(r => Shift_normMonth_(r.Month) === monthStr)
    .map(r => ({ date: Shift_normDate_(r.Date), label: String(r.Label || '') }))
    .sort((a, b) => a.date < b.date ? -1 : 1);
  return { ok: true, holidays: list };
}
function Shift_saveHolidays(monthStr, holidays) {
  if (!Shift_isAdmin_()) return { ok: false, message: 'ไม่มีสิทธิ์เข้าถึง' };
  const sh = Shift_holidaySheet_();
  const { rows: existing } = Shift_sheetToObjects_(sh);
  existing.filter(r => Shift_normMonth_(r.Month) === monthStr).sort((a, b) => b.__row - a.__row).forEach(r => sh.deleteRow(r.__row));
  (holidays || []).forEach(h => { if (h.date) sh.appendRow([monthStr, h.date, h.label || '']); });
  return { ok: true };
}

// ================== ชั่วโมงบังคับต่อตำแหน่ง (ตั้งค่าต่อเดือน — เก็บไว้ใช้ในเฟสคำนวณชั่วโมง/OT ถัดไป) ==================
function Shift_getMandatoryHours(monthStr) {
  if (!Shift_isAdmin_()) return { ok: false, message: 'ไม่มีสิทธิ์เข้าถึง' };
  const { rows } = Shift_sheetToObjects_(Shift_mandatoryHoursSheet_());
  const map = {};
  rows.filter(r => Shift_normMonth_(r.Month) === monthStr).forEach(r => { map[r.Position] = Number(r.Hours) || 0; });
  return { ok: true, hours: { RN: map.RN || 0, PN: map.PN || 0, NA: map.NA || 0 } };
}
function Shift_saveMandatoryHours(monthStr, hours) {
  if (!Shift_isAdmin_()) return { ok: false, message: 'ไม่มีสิทธิ์เข้าถึง' };
  const sh = Shift_mandatoryHoursSheet_();
  const { rows: existing } = Shift_sheetToObjects_(sh);
  existing.filter(r => Shift_normMonth_(r.Month) === monthStr).sort((a, b) => b.__row - a.__row).forEach(r => sh.deleteRow(r.__row));
  ['RN', 'PN', 'NA'].forEach(pos => { sh.appendRow([monthStr, pos, Number((hours || {})[pos]) || 0]); });
  return { ok: true };
}

// ================== รายชื่อพนักงานตามกลุ่มตารางเวร ==================
function Shift_scheduleGroupEmployees_(group) {
  const all = Shift_admin_getEmployeeList_();
  // หัวหน้าแผนกนับเป็นกำลังคนของกลุ่ม RN ด้วย (ยืนยันกับหัวหน้าแผนกแล้ว — เป็น 1 ใน 4 คนที่ขึ้น OPD1 ได้)
  // ยังมีตารางเวรของตัวเอง (กลุ่ม HEAD) แยกต่างหากเหมือนเดิม — เวลาสร้างร่างทั้ง 2 กลุ่ม (RN และ HEAD) ให้ตรวจสอบวันที่ซ้ำกันเองด้วย
  // เพราะระบบตรวจเวรซ้ำซ้อนอัตโนมัติ (findDuplicateAssignments_) เช็คเฉพาะภายในกลุ่มเดียวกัน ไม่เช็คข้ามกลุ่ม RN/HEAD
  if (group === 'RN') return all.filter(u => u.position === 'RN' || u.position === SHIFT_HEAD_POSITION);
  if (group === 'HEAD') return all.filter(u => u.position === SHIFT_HEAD_POSITION);
  return all.filter(u => u.position === 'PN' || u.position === 'NA'); // PNNA
}

// แปลงเวลารูปแบบ "7.00" หรือ "7:00" เป็นจำนวนนาทีนับจากเที่ยงคืน
function Shift_timeToMinutes_(t) {
  const parts = String(t).replace(/\./g, ':').split(':').map(Number);
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}
// ความยาวของช่องเวรเป็นนาที (รองรับเวรข้ามคืน)
// ใช้เฉพาะ "แสดงผล/แจ้งเตือน" เท่านั้น ไม่ได้ใช้ตัดสินว่าใครได้เวร — การเกลี่ยนับเป็น "วัน" ล้วน
function Shift_slotMinutes_(slot) {
  if (!slot || !slot.start || !slot.end) return 0;
  const s = Shift_timeToMinutes_(slot.start);
  let e = Shift_timeToMinutes_(slot.end);
  if (e <= s) e += 24 * 60;
  return e - s;
}

// เวร CP ไม่มีเวลาเข้า-ออกจริง นับเป็น 12 ชม. (ให้ตรงกับที่ใช้คำนวณในตาราง Excel)
const SHIFT_CP_MINUTES = 12 * 60;

// เตือนเมื่อมีคนทำงานติดกันเกินกี่วัน (ใช้แจ้งเตือนเฉย ๆ ไม่ได้บังคับหยุด)
const SHIFT_MAX_CONSECUTIVE_DAYS = 6;

// ================== ตัวสร้างตารางร่าง (Draft) ==================
// group: 'RN' | 'PNNA' | 'HEAD'
//
// กติกาการเกลี่ยเวร (ฉบับล่าสุด):
//   - นับเป็น "จำนวนวันที่ทำงาน" ไม่สนว่าวันนั้นทำกี่ชั่วโมง
//   - ใครทำงานติดกันหลายวันที่สุด ได้หยุดก่อน
//     (ทำโดยเรียงคนที่ทำติดกัน "น้อยที่สุด" ให้ได้เวรก่อน คนที่ติดกันเยอะสุดจึงเหลือค้าง = ได้หยุด)
//   - เงื่อนไขเวรสั้น / สาย / Senior / Junior / CP ถูกจัดก่อนขั้นตอนเกลี่ยเสมอ จึงไม่ถูกทับ
function Shift_generateDraftSchedule(monthStr, group) {
  if (!Shift_isAdmin_()) return { ok: false, message: 'ไม่มีสิทธิ์เข้าถึง' };
  if (SHIFT_SCHEDULE_GROUPS.indexOf(group) === -1) return { ok: false, message: 'กลุ่มไม่ถูกต้อง' };

  const [y, m] = monthStr.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();

  const holidaysRes = Shift_getHolidays(monthStr);
  const holidaySet = {};
  (holidaysRes.holidays || []).forEach(h => { holidaySet[h.date] = true; });

  const { rows: allRequests } = Shift_sheetToObjects_(Shift_requestSheet_());
  const activeThisMonth = allRequests.filter(r => Shift_normMonth_(r.Month) === monthStr && r.Status === 'Active')
    .map(r => Object.assign({}, r, { Date: Shift_normDate_(r.Date) }));

  if (group === 'HEAD') {
    return Shift_generateHeadSchedule_(monthStr, daysInMonth, holidaySet, activeThisMonth);
  }

  const employees = Shift_scheduleGroupEmployees_(group);
  if (!employees.length) {
    return { ok: false, message: 'ยังไม่มีพนักงานในกลุ่มนี้ (ตรวจสอบตำแหน่งพนักงานที่แท็บ "ตำแหน่ง/ระดับพนักงาน")' };
  }
  const byEmail = {}; employees.forEach(u => { byEmail[u.email.toLowerCase()] = u; });
  const byCode = {}; employees.forEach(u => { if (u.code) byCode[String(u.code)] = u.email; });
  const juniorEmail = (group === 'RN' && byCode[SHIFT_JUNIOR_WEEKEND_CODE]) ? byCode[SHIFT_JUNIOR_WEEKEND_CODE] : null;
  const seniorEmails = (group === 'PNNA') ? SHIFT_PNNA_SENIOR_CODES.map(c => byCode[c]).filter(Boolean) : [];

  const patRes = Shift_getPatternSettings(monthStr, group);
  const patternByKey = patRes.byKey || {};
  const patCPRes = (group === 'RN') ? Shift_getPatternCPSettings(monthStr, group) : { byKey: {} };
  const patternCPByKey = patCPRes.byKey || {};

  const alerts = [];
  // ตัวนับที่ใช้เกลี่ยเวร:
  //   personConsecutive = ทำงานติดกันกี่วันแล้ว (ตัวหลัก — ติดกันเยอะสุดได้หยุดก่อน)
  //   personShiftCount  = ทำงานรวมกี่วันในเดือนนี้ (ตัวรอง — เกลี่ยจำนวนวันให้เท่ากัน)
  //   personMinutes     = ชั่วโมงสะสม (ใช้แค่แสดงผล/แจ้งเตือน ไม่ได้ใช้ตัดสินว่าใครได้เวร)
  //   personMaxStreak   = สถิติทำงานติดกันสูงสุดของเดือน (ใช้แจ้งเตือน)
  const personShiftCount = {}; const personConsecutive = {}; const person7amStreak = {};
  const personMinutes = {}; const personMaxStreak = {}; const personOffDays = {};
  employees.forEach(u => {
    personShiftCount[u.email] = 0; personConsecutive[u.email] = 0; person7amStreak[u.email] = 0;
    personMinutes[u.email] = 0; personMaxStreak[u.email] = 0; personOffDays[u.email] = 0;
  });

  const days = [];
  let mondayCount = 0;

  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(y, m - 1, d);
    const wd = dateObj.getDay();
    const dateStr = Utilities.formatDate(dateObj, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    const isHoliday = !!holidaySet[dateStr];
    const isWeekend = (wd === 0 || wd === 6);
    if (wd === 1) mondayCount++;

    // วันนักขัตฤกษ์จัดอัตรากำลังตามวันในสัปดาห์ปกติ — isHoliday ใช้แค่ติดป้ายให้ทราบ
    const patternWd = wd;
    let parity = 'all';
    if (group === 'PNNA' && patternWd === 1) {
      parity = (mondayCount % 2 === 1) ? 'odd' : 'even'; // จันทร์ที่ 1,3,5 = คี่ / 2,4 = คู่
    }
    let patternRows = patternByKey[patternWd + ':' + parity] || [];
    if (!patternRows.length && parity !== 'all') patternRows = patternByKey[patternWd + ':all'] || [];
    let slotDefs = [];
    patternRows.forEach(p => {
      const cnt = Math.max(1, Number(p.count) || 1);
      for (let i = 0; i < cnt; i++) slotDefs.push({ start: p.start, end: p.end });
    });
    slotDefs = slotDefs.map((s, idx) => ({ slotIndex: idx + 1, start: s.start, end: s.end }));

    const requiredCP = (group === 'RN') ? (patternCPByKey[patternWd + ':all'] || 0) : 0;

    const todays = activeThisMonth.filter(r => r.Date === dateStr && byEmail[String(r.Email).toLowerCase()]);
    const offEmails = {}, cpErEmails = {}, shortEmails = [], lateEmails = [];
    todays.forEach(r => {
      const email = String(r.Email).toLowerCase();
      if (r.Type === 'Off') offEmails[email] = true;
      else if (r.Type === 'CP' || r.Type === 'ER') cpErEmails[email] = true;
      else if (r.Type === 'ShortShift') shortEmails.push(email);
      else if (r.Type === 'Late') lateEmails.push(email);
    });

    // กฎเฉพาะหัวหน้าแผนก (ถ้าอยู่ในกลุ่มนี้ = RN): ไม่มีเวร CP / จ.-ศ. ต้องไม่หยุด ยกเว้นวันนักขัตฤกษ์
    const headEmp = employees.find(u => u.position === SHIFT_HEAD_POSITION);
    if (headEmp) {
      const he = headEmp.email.toLowerCase();
      if (cpErEmails[he]) {
        delete cpErEmails[he];
        alerts.push('วันที่ ' + dateStr + ': หัวหน้าแผนกมีคำขอ CP/แผนกอื่นค้างอยู่ แต่หัวหน้าแผนกไม่มีเวร CP (เป็นเวรนอกโรงพยาบาล) ระบบจึงไม่นำมาพิจารณาในร่างนี้ กรุณาตรวจสอบ/ยกเลิกคำขอนั้น');
      }
      if (!isHoliday && !isWeekend && offEmails[he]) {
        delete offEmails[he];
        alerts.push('วันที่ ' + dateStr + ': หัวหน้าแผนกมีคำขอหยุดในวันจันทร์-ศุกร์ แต่กฎกำหนดว่าห้ามหยุดงานยกเว้นวันนักขัตฤกษ์ ระบบจึงจัดให้ทำงานตามปกติในร่างนี้ กรุณาตรวจสอบ/ยกเลิกคำขอนั้น');
      }
    }

    let pool = employees.filter(u => !offEmails[u.email.toLowerCase()] && !cpErEmails[u.email.toLowerCase()]);

    const assigned = {};
    const usedSlotIdx = {};

    // ---------- ตัวเรียงลำดับกลาง: ใครควรได้ "ทำงาน" ก่อน ----------
    // ทำติดกันน้อยที่สุดก่อน → ทำงานรวมน้อยที่สุด → ชั่วโมงน้อยที่สุด (ตัวสุดท้ายใช้ตัดสินเสมอเท่านั้น)
    // ผลคือคนที่ทำติดกันเยอะสุดจะเหลือค้างไม่ได้เวร = ได้หยุดวันนั้น ตามกติกาที่ตกลงกัน
    function compareForWork_(a, b) {
      if (personConsecutive[a.email] !== personConsecutive[b.email]) return personConsecutive[a.email] - personConsecutive[b.email];
      if (personShiftCount[a.email] !== personShiftCount[b.email]) return personShiftCount[a.email] - personShiftCount[b.email];
      return (personMinutes[a.email] || 0) - (personMinutes[b.email] || 0);
    }

    // ---------- CP: ต้องมี requiredCP คนต่อวัน (เฉพาะกลุ่ม RN) ----------
    const cpList = [];
    if (group === 'RN') {
      todays.filter(r => r.Type === 'CP').forEach(r => {
        const u = byEmail[String(r.Email).toLowerCase()];
        if (u && u.position !== SHIFT_HEAD_POSITION) cpList.push({ email: u.email, name: u.name, position: u.position, note: 'ไป CP (ตามคำขอ)' });
      });
    }
    const requestedCPCount = cpList.length;
    let cpCount = requestedCPCount;

    // กฎรหัส 67114 (RN Junior) เสาร์-อาทิตย์: ไม่จัดเข้า OPD1 หลัก เว้นแต่ขอเวรสั้นไว้เอง
    if (juniorEmail && isWeekend) {
      const jl = juniorEmail.toLowerCase();
      const hasShortToday = shortEmails.indexOf(jl) !== -1;
      if (!hasShortToday) pool = pool.filter(u => u.email.toLowerCase() !== jl);
      if (cpCount === 0 && !offEmails[jl] && !hasShortToday && !cpErEmails[jl]) {
        pool = pool.filter(u => u.email.toLowerCase() !== jl);
        const jr = byEmail[jl];
        if (jr) { cpList.push({ email: jr.email, name: jr.name, position: jr.position, note: 'ไป CP (ระบบจัดอัตโนมัติให้จูเนียร์ ' + SHIFT_JUNIOR_WEEKEND_CODE + ' — ยังไม่มีคำขอจริง กรุณาตรวจสอบ/ยืนยัน)' }); cpCount++; }
      }
    }

    // เติมคนไป CP อัตโนมัติให้ครบตามจำนวนที่ตั้งไว้ใน Pattern — ใช้กติกาหมุนเวรเดียวกับการเติมช่อง OPD1
    if (requiredCP > 0 && cpCount < requiredCP) {
      let need = requiredCP - cpCount;
      while (need > 0 && pool.length) {
        const cpEligiblePool = pool.filter(u => u.position !== SHIFT_HEAD_POSITION);
        const eligible = cpEligiblePool.filter(u => shortEmails.indexOf(u.email.toLowerCase()) === -1 && lateEmails.indexOf(u.email.toLowerCase()) === -1);
        const basis = eligible.length ? eligible : cpEligiblePool;
        if (!basis.length) break;
        const chosen = basis.slice().sort(compareForWork_)[0];
        cpList.push({ email: chosen.email, name: chosen.name, position: chosen.position, note: 'ไป CP (ระบบจัดอัตโนมัติ — ยังไม่มีคำขอจริง กรุณาตรวจสอบ/ยืนยัน)' });
        pool = pool.filter(x => x.email.toLowerCase() !== chosen.email.toLowerCase());
        cpCount++; need--;
      }
      if (need > 0) {
        alerts.push('วันที่ ' + dateStr + ': Pattern ตั้งไว้ว่าต้องมี CP ' + requiredCP + ' คน แต่คนไม่พอให้จัด (ขาดอีก ' + need + ' คน) กรุณาตรวจสอบ');
      }
    }
    if (group === 'RN' && requiredCP === 0 && cpCount === 0) {
      alerts.push('วันที่ ' + dateStr + ': ไม่มีคนขึ้น CP เลย (กฎกำหนดว่าทุกวันต้องมีเวร CP) กรุณาตรวจสอบ');
    }
    if (cpCount > requestedCPCount) {
      alerts.push('วันที่ ' + dateStr + ': มีคนขอ CP เอง ' + requestedCPCount + ' คน ระบบจัดเพิ่มให้อีก ' + (cpCount - requestedCPCount)
        + ' คนในร่างนี้ (' + cpList.slice(requestedCPCount).map(x => x.name).join(', ') + ') กรุณาตรวจสอบและกดยืนยันคำขอ CP ให้จริงในระบบถ้าเห็นด้วย');
    }
    const cpSlotDefs = cpList.map((c, i) => ({ slotIndex: 'cp' + (i + 1), start: '', end: '', isCP: true }));
    cpSlotDefs.forEach((s, i) => { assigned[s.slotIndex] = { email: cpList[i].email, name: cpList[i].name, position: cpList[i].position, note: cpList[i].note }; });

    function takeSlot(sortFn) {
      let candidates = slotDefs.filter(s => !usedSlotIdx[s.slotIndex]);
      if (!candidates.length) return null;
      if (sortFn) candidates.sort(sortFn);
      return candidates[0];
    }
    function assignPerson(email, slot, note) {
      const u = byEmail[String(email).toLowerCase()];
      if (!u || !slot) return false;
      assigned[slot.slotIndex] = { email: u.email, name: u.name, position: u.position, note: note || '' };
      usedSlotIdx[slot.slotIndex] = true;
      pool = pool.filter(x => x.email.toLowerCase() !== u.email.toLowerCase());
      return true;
    }

    // 1) ขอเวรสั้น (ขอลงเร็ว) -> เลือกช่องที่เลิกเร็วที่สุดของวันนี้ที่ยังว่าง
    shortEmails.forEach(email => {
      if (!byEmail[email]) return;
      const slot = takeSlot((a, b) => Shift_timeToMinutes_(a.end) - Shift_timeToMinutes_(b.end));
      if (slot) assignPerson(email, slot, 'เวรสั้น (ขอลงเร็ว)');
      else alerts.push('วันที่ ' + dateStr + ': มีคำขอเวรสั้นแต่ไม่มีช่องเวรว่างให้จัด (ตรวจสอบว่าตั้งค่า Pattern ของวันนี้ไว้หรือยัง)');
    });
    // 2) ขอสาย -> เลือกช่องที่เริ่มช้าที่สุดของวันนี้ที่ยังว่าง
    lateEmails.forEach(email => {
      if (!byEmail[email]) return;
      const slot = takeSlot((a, b) => Shift_timeToMinutes_(b.start) - Shift_timeToMinutes_(a.start));
      if (slot) assignPerson(email, slot, 'สาย (ขอเข้างานสาย)');
      else alerts.push('วันที่ ' + dateStr + ': มีคำขอสายแต่ไม่มีช่องเวรว่างให้จัด (ตรวจสอบว่าตั้งค่า Pattern ของวันนี้ไว้หรือยัง)');
    });
    // 3) PN/NA senior ต้องมีคนคุมเวร 8:00-20:00 น. — หมุนเวียนในกลุ่ม senior ด้วยกติกาเดียวกัน
    if (group === 'PNNA' && seniorEmails.length) {
      const need820 = slotDefs.find(s => !usedSlotIdx[s.slotIndex] && Shift_timeToMinutes_(s.start) <= 8 * 60 && Shift_timeToMinutes_(s.end) >= 20 * 60);
      if (need820) {
        const seniorLower = seniorEmails.map(e => e.toLowerCase());
        const availSenior = pool.filter(u => seniorLower.indexOf(u.email.toLowerCase()) !== -1).sort(compareForWork_)[0];
        if (availSenior) assignPerson(availSenior.email, need820, 'Senior คุมเวร 8-20');
        else alerts.push('วันที่ ' + dateStr + ': ไม่มี PN/NA senior (57084/59007/59031) ว่างคุมเวร 8-20 น. กรุณาตรวจสอบ');
      }
    }
    // 4) เติมช่องที่เหลือ — เกลี่ยด้วยจำนวนวัน โดยคนที่ทำติดกันน้อยสุดได้ทำงานก่อน
    //    คนที่ทำติดกันเยอะสุดจึงเหลือค้าง = ได้หยุดวันนั้น ตามกติกาที่ตกลงกัน
    slotDefs.filter(s => !usedSlotIdx[s.slotIndex]).forEach(slot => {
      if (!pool.length) return; // คนไม่พอ ปล่อยว่างไว้ (แจ้งเตือนรวมด้านล่าง)
      const isEarly = (group === 'RN' && Shift_timeToMinutes_(slot.start) <= 7 * 60);
      const candidates = pool.slice().sort((a, b) => {
        // กันคนขึ้นเวร 7 โมงติดกันเกิน 3 วัน (กฎเดิม ยังคงไว้)
        if (isEarly) {
          const aBad = person7amStreak[a.email] >= 3 ? 1 : 0;
          const bBad = person7amStreak[b.email] >= 3 ? 1 : 0;
          if (aBad !== bBad) return aBad - bBad;
        }
        return compareForWork_(a, b);
      });
      assignPerson(candidates[0].email, slot, '');
    });

    const unfilledCount = slotDefs.filter(s => !usedSlotIdx[s.slotIndex]).length;
    if (unfilledCount > 0) {
      alerts.push('วันที่ ' + dateStr + ': ขาดคนจัดเวร ' + unfilledCount + ' ช่อง (คนไม่พอตาม Pattern ที่ตั้งไว้ หลังหักคนที่หยุด/CP/แผนกอื่นวันนี้) กรุณาตรวจสอบ');
    }

    // หัวหน้าแผนกต้องอยู่คุมเวรวันจันทร์-ศุกร์ (ยกเว้นวันนักขัตฤกษ์)
    // ถ้าการเกลี่ยทำให้หลุดไป ให้แจ้งเตือนไว้ให้สลับเอง (ไม่บังคับทับอัตโนมัติ)
    if (headEmp && !isHoliday && !isWeekend) {
      const he = headEmp.email.toLowerCase();
      const headGotSlot = slotDefs.some(s => assigned[s.slotIndex] && String(assigned[s.slotIndex].email).toLowerCase() === he);
      if (!headGotSlot) {
        alerts.push('วันที่ ' + dateStr + ': หัวหน้าแผนกไม่ได้ถูกจัดเวรในวันจันทร์-ศุกร์ (กฎกำหนดให้ต้องอยู่คุมเวร) กรุณาสลับคนด้วยตนเอง');
      }
    }

    // อัปเดตตัวนับสะสมสำหรับวันถัดไป (นับทั้งคนที่ได้ช่อง OPD1 และคนที่ไป CP วันนี้ — ถือว่ามาทำงานเหมือนกัน)
    employees.forEach(u => {
      const email = u.email.toLowerCase();
      const gotSlotDef = slotDefs.find(s => assigned[s.slotIndex] && String(assigned[s.slotIndex].email).toLowerCase() === email);
      const gotCP = cpList.some(c => c.email.toLowerCase() === email);
      if (gotSlotDef || gotCP) {
        personShiftCount[u.email] = (personShiftCount[u.email] || 0) + 1;
        personMinutes[u.email] = (personMinutes[u.email] || 0) + (gotSlotDef ? Shift_slotMinutes_(gotSlotDef) : SHIFT_CP_MINUTES);
        personConsecutive[u.email] = (personConsecutive[u.email] || 0) + 1;
        if (personConsecutive[u.email] > (personMaxStreak[u.email] || 0)) personMaxStreak[u.email] = personConsecutive[u.email];
        person7amStreak[u.email] = (gotSlotDef && group === 'RN' && Shift_timeToMinutes_(gotSlotDef.start) <= 7 * 60) ? (person7amStreak[u.email] || 0) + 1 : 0;
      } else {
        personOffDays[u.email] = (personOffDays[u.email] || 0) + 1;
        personConsecutive[u.email] = 0;
        person7amStreak[u.email] = 0;
      }
    });

    days.push({
      date: dateStr, weekday: wd, weekdayLabel: SHIFT_WEEKDAY_LABEL[wd], isHoliday, isWeekend,
      slots: cpSlotDefs.map(s => Object.assign({ slotIndex: s.slotIndex, start: '', end: '', isCP: true }, assigned[s.slotIndex]))
        .concat(slotDefs.map(s => Object.assign({ slotIndex: s.slotIndex, start: s.start, end: s.end }, assigned[s.slotIndex] || { email: '', name: '', position: '', note: '' }))),
      offNames: todays.filter(r => r.Type === 'Off').map(r => r.Name),
      cpErNames: todays.filter(r => r.Type === 'ER').map(r => r.Name)
    });
  }

  // ---------- สรุปผลทั้งเดือน + แจ้งเตือนความไม่สมดุล ----------
  const personTotals = employees.map(u => ({
    email: u.email, name: u.name,
    shiftCount: personShiftCount[u.email] || 0,
    offDays: personOffDays[u.email] || 0,
    maxStreak: personMaxStreak[u.email] || 0,
    hours: Math.round(((personMinutes[u.email] || 0) / 60) * 10) / 10
  }));

  // เตือนถ้าจำนวน "วันทำงาน" ยังห่างกันเกิน 2 วัน
  if (personTotals.length > 1) {
    const byDays = personTotals.slice().sort((a, b) => a.shiftCount - b.shiftCount);
    const lo = byDays[0], hi = byDays[byDays.length - 1];
    if (hi.shiftCount - lo.shiftCount > 2) {
      alerts.push('⚖️ จำนวนวันทำงานยังห่างกัน ' + (hi.shiftCount - lo.shiftCount) + ' วัน — มากสุด: ' + hi.name + ' ' + hi.shiftCount
        + ' วัน / น้อยสุด: ' + lo.name + ' ' + lo.shiftCount + ' วัน (มักเกิดจากคำขอหยุดกระจุกตัว) กรุณาตรวจสอบ/สลับเวรด้วยตนเอง');
    }
  }

  // เตือนคนที่ทำงานติดกันยาวเกินเกณฑ์
  const longStreak = personTotals.filter(p => p.maxStreak > SHIFT_MAX_CONSECUTIVE_DAYS);
  if (longStreak.length) {
    alerts.push('🔁 มีคนทำงานติดกันเกิน ' + SHIFT_MAX_CONSECUTIVE_DAYS + ' วัน: '
      + longStreak.map(p => p.name + ' (' + p.maxStreak + ' วันติด)').join(', ')
      + ' — เกิดจากวันนั้นคนไม่พอให้สลับ กรุณาตรวจสอบ');
  }

  return { ok: true, month: monthStr, group, days, alerts, personTotals: personTotals };
}

// ตารางเวรของหัวหน้าแผนก — ใช้กฎตายตัวรายวัน ไม่พึ่ง Pattern (หัวหน้าแผนกไม่มีอัตรากำลังแบบ pattern เหมือน RN/PN/NA)
function Shift_generateHeadSchedule_(monthStr, daysInMonth, holidaySet, activeThisMonth) {
  const employees = Shift_scheduleGroupEmployees_('HEAD');
  if (!employees.length) return { ok: false, message: 'ยังไม่ได้ตั้งพนักงานตำแหน่ง "หัวหน้าแผนก" ในระบบ (ไปตั้งค่าที่แท็บ "ตำแหน่ง/ระดับพนักงาน" ก่อน)' };
  const head = employees[0];
  const [y, m] = monthStr.split('-').map(Number);
  const alerts = [];
  const days = [];

  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(y, m - 1, d);
    const wd = dateObj.getDay();
    const dateStr = Utilities.formatDate(dateObj, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    const isHoliday = !!holidaySet[dateStr];
    const todays = activeThisMonth.filter(r => r.Date === dateStr && String(r.Email).toLowerCase() === head.email.toLowerCase());
    const req = todays[0] ? todays[0].Type : null;

    let slot = null, note = '';
    if (wd === 0) {
      if (req && req !== 'Off') alerts.push('วันที่ ' + dateStr + ': หัวหน้าแผนกมีคำขอ (' + req + ') แต่กฎกำหนดให้หยุดทุกวันอาทิตย์ ระบบจึงจัดเป็นวันหยุดในร่างนี้ กรุณาตรวจสอบคำขอ');
      note = 'Off (อาทิตย์)';
    } else if (wd === 6) {
      if (req === 'Off') note = 'Off';
      else if (req === 'ShortShift') note = 'เวรสั้น';
      else if (!req) note = 'Off';
      else { alerts.push('วันที่ ' + dateStr + ': หัวหน้าแผนกมีคำขอ (' + req + ') แต่วันเสาร์ทำได้แค่ Off หรือเวรสั้นเท่านั้น กรุณาตรวจสอบ'); note = 'Off'; }
    } else if (isHoliday) {
      note = 'หยุดนักขัตฤกษ์';
    } else {
      slot = { start: '8.00', end: '17.00' };
      if (req === 'Off') { alerts.push('วันที่ ' + dateStr + ': หัวหน้าแผนกขอหยุดในวันที่ต้องคุมเวร (จ.-ศ. ต้องอยู่ 8-17 น.) กรุณาตรวจสอบ'); note = 'คุมเวร 8-17 (มีคำขอ Off ค้าง โปรดตรวจสอบ)'; }
      else if (req === 'CP') { alerts.push('วันที่ ' + dateStr + ': หัวหน้าแผนกขอ CP ในวันที่ต้องคุมเวร กรุณาตรวจสอบ'); note = 'คุมเวร 8-17 (มีคำขอ CP ค้าง โปรดตรวจสอบ)'; }
      else if (req === 'ShortShift') note = 'คุมเวร (เวรสั้น)';
      else if (req === 'Late') note = 'คุมเวร (สาย)';
      else note = 'คุมเวร 8-17';
    }

    days.push({
      date: dateStr, weekday: wd, weekdayLabel: SHIFT_WEEKDAY_LABEL[wd], isHoliday, isWeekend: (wd === 0 || wd === 6),
      slots: slot
        ? [{ slotIndex: 1, start: slot.start, end: slot.end, email: head.email, name: head.name, position: head.position, note: note }]
        : [{ slotIndex: 1, start: '', end: '', email: '', name: '', position: '', note: note }],
      offNames: slot ? [] : [head.name], cpErNames: []
    });
  }

  return {
    ok: true, month: monthStr, group: 'HEAD', days, alerts,
    personTotals: [{ email: head.email, name: head.name, shiftCount: days.filter(d => d.slots[0] && d.slots[0].email).length }]
  };
}

// ================== บันทึก/อ่านตารางเวรที่ Admin ยืนยันแล้ว ==================
// days: มาจากผลลัพธ์ Shift_generateDraftSchedule (หรือฉบับที่ Admin แก้ไขในเบราว์เซอร์แล้ว) — เซิร์ฟเวอร์บันทึกตามที่ส่งมาโดยไม่ตรวจกติกาซ้ำ (เชื่อการตรวจของ Admin)
function Shift_saveGeneratedSchedule(monthStr, group, days) {
  if (!Shift_isAdmin_()) return { ok: false, message: 'ไม่มีสิทธิ์เข้าถึง' };
  const sh = Shift_scheduleSheet_();
  const data = sh.getDataRange().getValues();
  const header = data[0];

  // เก็บแถวของเดือน/กลุ่มอื่นไว้ ตัดเฉพาะของเดือน+กลุ่มนี้ออก
  const keep = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!r[0] && !r[1]) continue;
    if (Shift_normMonth_(r[0]) === monthStr && String(r[3]) === group) continue;
    keep.push(r);
  }

  const now = new Date();
  let added = 0;
  (days || []).forEach(function (d) {
    (d.slots || []).forEach(function (s) {
      if (!s.email) return;
      keep.push([monthStr, d.date, d.weekday, group, s.slotIndex, s.start, s.end,
        s.email, s.name || '', s.position || '', s.note || '', now]);
      added++;
    });
  });

  Shift_rewriteScheduleSheet_(sh, header, keep);
  return { ok: true, message: 'บันทึกตารางเวรเรียบร้อย (' + added + ' รายการ)' };
}

/**
 * บันทึกตารางเวรเฉพาะ "วันเดียว" — ใช้ตอน Admin แก้ชื่อคนในดรอปดาวน์แล้วบันทึกทันที
 * เร็วกว่า Shift_saveGeneratedSchedule มาก เพราะลบ/เขียนใหม่แค่วันเดียว ไม่ใช่ทั้งเดือน
 * day = { date, weekday, slots:[{slotIndex,start,end,email,name,position,note}, ...] }
 */
function Shift_saveScheduleDay(monthStr, group, day) {
  if (!Shift_isAdmin_()) return { ok: false, message: 'ไม่มีสิทธิ์เข้าถึง' };
  if (!day || !day.date) return { ok: false, message: 'ไม่มีข้อมูลวันที่ให้บันทึก' };
  const sh = Shift_scheduleSheet_();
  const data = sh.getDataRange().getValues();
  const header = data[0];

  const keep = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!r[0] && !r[1]) continue;
    if (Shift_normMonth_(r[0]) === monthStr && String(r[3]) === group
        && Shift_normDate_(r[1]) === day.date) continue; // ตัดของเดิมของวันนี้ทิ้ง
    keep.push(r);
  }

  const now = new Date();
  (day.slots || []).forEach(function (s) {
    if (!s.email) return;
    keep.push([monthStr, day.date, day.weekday, group, s.slotIndex, s.start, s.end,
      s.email, s.name || '', s.position || '', s.note || '', now]);
  });

  Shift_rewriteScheduleSheet_(sh, header, keep);
  return {
    ok: true,
    message: 'บันทึกวันที่ ' + day.date + ' เรียบร้อย',
    savedAt: Utilities.formatDate(now, Session.getScriptTimeZone(), 'HH:mm:ss')
  };
}

/** เขียนทับทั้งชีตรวดเดียว — เร็วกว่า deleteRow/appendRow ทีละแถวหลายสิบเท่า */
function Shift_rewriteScheduleSheet_(sh, header, rows) {
  const out = [header].concat(rows);
  const cols = header.length;
  if (sh.getMaxRows() < out.length) {
    sh.insertRowsAfter(sh.getMaxRows(), out.length - sh.getMaxRows() + 50);
  }
  const lastRow = sh.getLastRow();
  if (lastRow > 1) sh.getRange(2, 1, lastRow - 1, cols).clearContent();
  sh.getRange(1, 1, out.length, cols).setValues(out);
  SpreadsheetApp.flush();
}

function Shift_getSavedSchedule(monthStr, group) {
  if (!Shift_isAdmin_()) return { ok: false, message: 'ไม่มีสิทธิ์เข้าถึง' };
  const { rows } = Shift_sheetToObjects_(Shift_scheduleSheet_());
  const mine = rows.filter(r => Shift_normMonth_(r.Month) === monthStr && r.Group === group)
    .map(r => {
      const rawSlot = String(r.SlotIndex);
      const isCP = rawSlot.indexOf('cp') === 0;
      return {
        date: Shift_normDate_(r.Date), weekday: Number(r.Weekday), slotIndex: isCP ? rawSlot : Number(rawSlot),
        start: String(r.StartTime), end: String(r.EndTime), email: r.Email, name: r.Name, position: r.Position, note: String(r.Note || ''), isCP: isCP,
        savedAtMs: (Object.prototype.toString.call(r.SavedAt) === '[object Date]') ? r.SavedAt.getTime() : 0
      };
    });
  return { ok: true, rows: mine };
}

// ================== Export ตารางเวรแบบ "พนักงาน x วันที่" (ตามฟอร์แมตเดิมของ รพ.) ==================
// สร้าง/เขียนทับชีตใหม่ในสเปรดชีตเดียวกัน: แถว = พนักงานแต่ละคน (2 แถวย่อยต่อคน: บน=เวลาเข้า ล่าง=เวลาออก), คอลัมน์ = วันที่ 1..สิ้นเดือน
// days: ส่งมาจากหน้าเว็บ (ตารางร่าง/ตารางที่ Admin แก้ไขล่าสุดบนจอ) เพื่อให้ export ตรงกับที่เห็นอยู่ ไม่ต้องบันทึกก่อนก็ export ได้
//
// สีตัวอักษร:
//   R  (ขอหยุดเอง)        = พื้นเหลืองอ่อน ตัวน้ำตาลเข้ม
//   R* (ไปช่วยแผนกอื่น)    = พื้นเขียวอ่อน ตัวเขียวเข้ม
//   X  (ระบบจัดให้หยุด)    = ตัวเทา
//   CP ที่พนักงานขอเอง     = ตัวแดงหนา   (CP ที่ระบบจัดให้ = สีดำปกติ)
//   เวรสั้นที่พนักงานขอเอง  = เวลาเข้า-ออก ตัวแดงหนา ทั้ง 2 แถว
function Shift_exportScheduleGridSheet(monthStr, group, days) {
  if (!Shift_isAdmin_()) return { ok: false, message: 'ไม่มีสิทธิ์เข้าถึง' };
  if (SHIFT_SCHEDULE_GROUPS.indexOf(group) === -1) return { ok: false, message: 'กลุ่มไม่ถูกต้อง' };
  const [y, m] = monthStr.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const groupLabel = SHIFT_SCHEDULE_GROUP_LABEL[group] || group;

  // ลำดับพนักงาน: เอาพนักงานทั้งกลุ่มมาก่อน (โชว์ครบทุกคนแม้บางคนไม่มีเวรวันไหนเลยเดือนนี้)
  const employees = Shift_scheduleGroupEmployees_(group);
  const order = employees.map(u => ({ email: u.email, name: u.name }));
  const byEmpDate = {};
  order.forEach(u => { byEmpDate[u.email.toLowerCase()] = {}; });
  (days || []).forEach(d => {
    (d.slots || []).forEach(s => {
      if (!s.email) return;
      const key = String(s.email).toLowerCase();
      if (!byEmpDate[key]) byEmpDate[key] = {};
      byEmpDate[key][d.date] = { start: s.start, end: s.end, note: s.note || '', isCP: !!s.isCP };
    });
  });
  // เผื่อมีอีเมลที่มีเวรอยู่ในข้อมูลแต่ไม่อยู่ในลิสต์พนักงานปัจจุบันแล้ว (เช่นย้ายตำแหน่ง) ให้เติมท้ายลิสต์ไว้ด้วย
  Object.keys(byEmpDate).forEach(email => {
    if (Object.keys(byEmpDate[email]).length && !order.some(u => u.email.toLowerCase() === email)) {
      let nameGuess = email;
      (days || []).some(d => (d.slots || []).some(s => { if (s.email && String(s.email).toLowerCase() === email) { nameGuess = s.name || email; return true; } return false; }));
      order.push({ email: email, name: nameGuess });
    }
  });

  // อ่านคำขอของเดือนนี้จากชีต OffRequests โดยตรง
  // (ไม่พึ่งข้อมูลที่ส่งมาจากหน้าเว็บ เพราะตารางที่โหลดจากที่บันทึกไว้จะไม่มีข้อมูลส่วนนี้ติดมา)
  // reqMark[email]['YYYY-MM-DD'] = 'Off' | 'ER' | 'CP' | 'ShortShift'
  //   Off/ER        → ใช้เลือกสัญลักษณ์ R / R*
  //   CP/ShortShift → ใช้บอกว่า "พนักงานขอเอง" เพื่อทำฟอนต์สีแดง (ถ้าระบบจัดให้ จะไม่มีคำขอในชีตนี้)
  const reqMark = {};
  const reqData = Shift_sheetToObjects_(Shift_requestSheet_()).rows;
  reqData.forEach(function (r) {
    if (Shift_normMonth_(r.Month) !== monthStr) return;
    if (r.Status !== 'Active') return;
    if (['Off', 'ER', 'CP', 'ShortShift'].indexOf(r.Type) === -1) return;
    const e = String(r.Email).toLowerCase();
    if (!reqMark[e]) reqMark[e] = {};
    reqMark[e][Shift_normDate_(r.Date)] = r.Type;
  });

  // รวมชั่วโมง OPD1 (จากเวลาเข้า-ออกจริง รองรับเวรข้ามคืน) + ชั่วโมง CP (เวรละ 12 ชม.)
  // วันหยุดทุกแบบ (R / X / R*) ไม่นับชั่วโมงทั้งหมด
  function computeEmpHours_(emp) {
    let opd1Minutes = 0;
    let cpCount = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(y, m - 1, d);
      const dateStr = Utilities.formatDate(dateObj, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      const cell = emp[dateStr];
      if (!cell) continue;
      if (cell.isCP) { cpCount++; continue; }
      if (cell.start && cell.end) {
        let sMin = Shift_timeToMinutes_(cell.start);
        let eMin = Shift_timeToMinutes_(cell.end);
        if (eMin <= sMin) eMin += 24 * 60; // เผื่อเวรข้ามคืน
        opd1Minutes += (eMin - sMin);
      }
    }
    return { opd1Hours: opd1Minutes / 60, cpHours: cpCount * 12 };
  }

  const sheetName = ('ตารางเวร_' + groupLabel + '_' + monthStr).substring(0, 90);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const old = ss.getSheetByName(sheetName);
  if (old) ss.deleteSheet(old);
  const sh = ss.insertSheet(sheetName);

  const WD_SHORT = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
  const headerRow = ['ชื่อ'];
  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(y, m - 1, d);
    headerRow.push(String(d) + ' (' + WD_SHORT[dateObj.getDay()] + ')');
  }
  headerRow.push('รวมชม. OPD1', 'รวมชม. CP', 'รวมชม. ทั้งหมด');
  const rows = [headerRow];
  // เก็บตำแหน่งเซลล์ไว้ทำสีทีหลัง
  //   req/sys/other  = สัญลักษณ์วันหยุด R / X / R*
  //   cpReq/shortReq = CP และเวรสั้นที่ "พนักงานขอเอง" → ฟอนต์สีแดง
  const markCells = { req: [], sys: [], other: [], cpReq: [], shortReq: [] };

  order.forEach(function (u, empIdx) {
    const topRow = [u.name];
    const botRow = [''];
    const emailKey = u.email.toLowerCase();
    const emp = byEmpDate[emailKey] || {};
    const marks = reqMark[emailKey] || {};
    const rowNum = 2 + empIdx * 2;
    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(y, m - 1, d);
      const dateStr = Utilities.formatDate(dateObj, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      const cell = emp[dateStr];
      if (cell && cell.isCP) {
        // CP ไม่มีเวลาเข้า-ออกจริง — โชว์แค่ "CP" ในช่องบน ช่องล่างเว้นว่าง (ตามฟอร์แมตเดิมของ รพ.)
        topRow.push('CP'); botRow.push('');
        // ถ้าพนักงานขอ CP เอง → ทำฟอนต์แดง (CP ที่ระบบจัดให้อัตโนมัติจะไม่มีคำขอในชีต จึงเป็นสีปกติ)
        if (marks[dateStr] === 'CP') markCells.cpReq.push({ row: rowNum, col: 1 + d });
      } else if (cell && cell.start && cell.end) {
        topRow.push(cell.start); botRow.push(cell.end);
        // ถ้าพนักงานขอเวรสั้นเอง → ทำฟอนต์แดงทั้งเวลาเข้าและเวลาออก
        if (marks[dateStr] === 'ShortShift') markCells.shortReq.push({ row: rowNum, col: 1 + d });
      } else if (cell && cell.note) {
        topRow.push(cell.note); botRow.push('');
      } else if (marks[dateStr] === 'ER') {
        // ขอหยุดเพื่อไปช่วยแผนกอื่น
        topRow.push(SHIFT_GRID_MARK_OTHER); botRow.push('');
        markCells.other.push({ row: rowNum, col: 1 + d });
      } else if (marks[dateStr] === 'Off') {
        // พนักงานขอหยุดเอง
        topRow.push(SHIFT_GRID_MARK_REQUEST); botRow.push('');
        markCells.req.push({ row: rowNum, col: 1 + d });
      } else {
        // ไม่ได้ขออะไรไว้ และระบบไม่ได้จัดเวรให้ = ระบบให้หยุดเองตามความเหมาะสม
        topRow.push(SHIFT_GRID_MARK_SYSTEM); botRow.push('');
        markCells.sys.push({ row: rowNum, col: 1 + d });
      }
    }
    const hrs = computeEmpHours_(emp);
    const opd1Rounded = Math.round(hrs.opd1Hours * 10) / 10;
    topRow.push(opd1Rounded); botRow.push('');
    topRow.push(hrs.cpHours); botRow.push('');
    topRow.push(Math.round((opd1Rounded + hrs.cpHours) * 10) / 10); botRow.push('');
    rows.push(topRow, botRow);
  });

  const lastCol = headerRow.length;

  // กันชีตใหม่มีคอลัมน์/แถวไม่พอ (เดือน 31 วันต้องใช้ 35 คอลัมน์ แต่ชีตใหม่มีแค่ 26)
  // ถ้าไม่ขยายก่อน setValues/merge จะพังด้วย error เรื่องช่วงเซลล์หรือการผสานเซลล์
  const needRows = rows.length + 4;
  if (sh.getMaxColumns() < lastCol) sh.insertColumnsAfter(sh.getMaxColumns(), lastCol - sh.getMaxColumns());
  if (sh.getMaxRows() < needRows) sh.insertRowsAfter(sh.getMaxRows(), needRows - sh.getMaxRows());
  // ยกเลิกการผสานเซลล์ทั้งหมดก่อนเสมอ — กัน error "ผสานคอลัมน์ที่ตรงและไม่ได้ตรงเข้าด้วยกันไม่ได้"
  try { sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).breakApart(); } catch (e) {}

  if (rows.length > 1) {
    sh.getRange(1, 1, rows.length, lastCol).setValues(rows);
  } else {
    sh.getRange(1, 1, 1, lastCol).setValues(rows);
  }

  // จัดรูปแบบ
  sh.getRange(1, 1, 1, lastCol).setFontWeight('bold').setBackground('#e7f3f1').setHorizontalAlignment('center');
  sh.setFrozenRows(1);
  sh.setFrozenColumns(1);
  const hoursCol1 = lastCol - 2, hoursCol2 = lastCol - 1, hoursCol3 = lastCol;
  for (let i = 0; i < order.length; i++) {
    const r = 2 + i * 2;
    sh.getRange(r, 1, 2, 1).merge().setVerticalAlignment('middle').setFontWeight('bold').setHorizontalAlignment('left');
    sh.getRange(r, hoursCol1, 2, 1).merge().setVerticalAlignment('middle').setFontWeight('bold').setBackground('#fff3e0');
    sh.getRange(r, hoursCol2, 2, 1).merge().setVerticalAlignment('middle').setFontWeight('bold').setBackground('#e8eaf6');
    sh.getRange(r, hoursCol3, 2, 1).merge().setVerticalAlignment('middle').setFontWeight('bold').setBackground('#c8e6c9');
  }
  if (rows.length > 1) {
    sh.getRange(1, 1, rows.length, lastCol).setBorder(true, true, true, true, true, true, '#cccccc', SpreadsheetApp.BorderStyle.SOLID);
  }
  sh.getRange(2, 2, Math.max(rows.length - 1, 1), lastCol - 1).setHorizontalAlignment('center');
  sh.setColumnWidth(1, 130);
  for (let c = 2; c <= lastCol; c++) sh.setColumnWidth(c, 44);
  sh.setColumnWidth(hoursCol1, 78);
  sh.setColumnWidth(hoursCol2, 70);
  sh.setColumnWidth(hoursCol3, 82);
  sh.getRange(1, hoursCol1, 1, 3).setBackground('#ffe0b2');

  // ทำสีสัญลักษณ์วันหยุดให้แยกออกจากกันชัดเจน
  markCells.req.forEach(function (c) {   // R  = ขอหยุดเอง
    sh.getRange(c.row, c.col).setBackground('#fff9c4').setFontWeight('bold').setFontColor('#8d6e00');
  });
  markCells.other.forEach(function (c) { // R* = ไปช่วยแผนกอื่น
    sh.getRange(c.row, c.col).setBackground('#e0f2f1').setFontWeight('bold').setFontColor('#00695c');
  });
  markCells.sys.forEach(function (c) {   // X  = ระบบจัดให้หยุด
    sh.getRange(c.row, c.col).setFontColor('#9e9e9e');
  });
  // ---- ฟอนต์สีแดง: เวรที่พนักงาน "ขอเอง" ----
  markCells.cpReq.forEach(function (c) {    // CP ที่ขอเอง — แถวบนแถวเดียว (แถวล่างว่าง)
    sh.getRange(c.row, c.col).setFontColor('#d32f2f').setFontWeight('bold');
  });
  markCells.shortReq.forEach(function (c) { // เวรสั้นที่ขอเอง — ทั้งเวลาเข้าและเวลาออก
    sh.getRange(c.row, c.col, 2, 1).setFontColor('#d32f2f').setFontWeight('bold');
  });

  // คำอธิบายสัญลักษณ์ท้ายตาราง
  const legendRow = rows.length + 2;
  sh.getRange(legendRow, 1).setValue(
    'คำอธิบายสัญลักษณ์:   ' + SHIFT_GRID_MARK_REQUEST + ' = พนักงานขอหยุดเอง   |   ' +
    SHIFT_GRID_MARK_SYSTEM + ' = ระบบจัดให้หยุดตามความเหมาะสม   |   ' +
    SHIFT_GRID_MARK_OTHER + ' = ขอหยุดเพื่อไปช่วยแผนกอื่น (ไม่นับชั่วโมง)   |   CP = ขึ้นเวร CP (นับ 12 ชม.)'
  );
  sh.getRange(legendRow, 1, 1, Math.min(lastCol, 12)).merge();
  sh.getRange(legendRow, 1).setFontSize(10).setFontColor('#555555').setHorizontalAlignment('left');

  sh.getRange(legendRow + 1, 1).setValue(
    'ตัวอักษรสีแดง = เวรที่พนักงานขอเอง (CP ที่ขอเอง และเวรสั้นที่ขอเอง)   |   ' +
    'CP / เวลาเข้า-ออก สีดำ = ระบบจัดให้ตามอัตรากำลัง'
  );
  sh.getRange(legendRow + 1, 1, 1, Math.min(lastCol, 12)).merge();
  sh.getRange(legendRow + 1, 1).setFontSize(10).setFontColor('#d32f2f').setHorizontalAlignment('left');

  return { ok: true, url: ss.getUrl() + '#gid=' + sh.getSheetId(), sheetName: sheetName };
}
