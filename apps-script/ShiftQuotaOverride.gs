/**
 * ShiftQuotaOverride.gs
 * โควต้าเฉพาะกิจรายวัน (Ad-hoc quota override)
 * ------------------------------------------------------------------
 * ไฟล์นี้เป็นไฟล์ใหม่ วางเพิ่มในโปรเจกต์เดิมได้เลย ไม่ทับไฟล์เก่า
 * ตั้งชื่อไฟล์ใน Apps Script ว่า "ShiftQuotaOverride"
 *
 * แนวคิด
 *   - ชีต ShiftQuota (ของเดิม)        = โควต้าประจำ ตั้งตามวันในสัปดาห์ ใช้ทั้งเดือน
 *   - ชีต ShiftQuotaOverride (ใหม่)   = โควต้าเฉพาะกิจ ระบุ "วันที่" เจาะจง ใช้ทับของเดิมเฉพาะวันนั้น
 *
 * ช่องไหนเว้นว่าง = ใช้ค่าโควต้าประจำตามเดิม
 * ช่องไหนใส่ 0    = วันนั้นตำแหน่งนั้นขอไม่ได้เลย
 *
 * ตั้งค่าเฉพาะกิจ "ไม่ลบ" คำขอที่พนักงานทำไว้ก่อนหน้า แต่จะแจ้งเตือนให้ Admin
 * เห็นว่ามีใครเกินโควต้าใหม่บ้าง เพื่อไปคุยกับพนักงานเอง
 * ------------------------------------------------------------------
 * ต้องใช้คู่กับ ShiftRequestBackend.gs (แก้ 4 ฟังก์ชันตามไฟล์ PATCH)
 */

// ================== CONFIG ==================
const SHEET_SHIFT_QUOTA_OVERRIDE = 'ShiftQuotaOverride';

// ชื่อ field ภายในที่ใช้เก็บโควต้าแต่ละประเภท
const SHIFT_OV_FIELDS = ['maxOff', 'shortSlots', 'cpSlots', 'lateSlots', 'erSlots'];

// map ประเภทคำขอ -> field โควต้า
const SHIFT_TYPE_FIELD = {
  Off: 'maxOff',
  ShortShift: 'shortSlots',
  CP: 'cpSlots',
  Late: 'lateSlots',
  ER: 'erSlots'
};

const SHIFT_TYPE_LABEL = {
  Off: 'วันหยุด (Off)',
  ShortShift: 'เวรสั้น',
  CP: 'ขึ้น CP',
  Late: 'สาย',
  ER: 'แผนกอื่น'
};

const SHIFT_FIELD_LABEL = {
  maxOff: 'วันหยุด (X)',
  shortSlots: 'เวรสั้น',
  cpSlots: 'ขึ้น CP',
  lateSlots: 'สาย',
  erSlots: 'แผนกอื่น'
};

// ================== SHEET ==================
function Shift_overrideSheet_() {
  return Shift_getOrCreateSheet_(
    SHEET_SHIFT_QUOTA_OVERRIDE,
    ['Date', 'Group', 'MaxOff', 'ShortSlots', 'CPSlots', 'LateSlots', 'ERSlots', 'Note', 'UpdatedAt', 'UpdatedBy'],
    [1] // คอลัมน์ Date เป็น Plain text กัน Google Sheets แปลงเป็น Date object
  );
}

// แปลงค่าที่อ่านจากชีตเป็นตัวเลข หรือ '' ถ้าเว้นว่าง (= ให้ใช้โควต้าประจำตามเดิม)
function Shift_ovNum_(v) {
  if (v === '' || v === null || v === undefined) return '';
  const n = Number(v);
  return isNaN(n) ? '' : Math.max(0, Math.floor(n));
}

/**
 * อ่าน override ทั้งหมดของเดือนนั้น (ส่ง monthStr = '' เพื่อเอาทุกเดือน)
 * คืนค่า: { '2026-10-23': { RN: {maxOff:0, shortSlots:'', ..., note:'ตรวจใหญ่'}, PNNA: {...} } }
 */
function Shift_getOverrideMap_(monthStr) {
  const { rows } = Shift_sheetToObjects_(Shift_overrideSheet_());
  const map = {};
  rows.forEach(function (r) {
    const d = Shift_normDate_(r.Date);
    if (!d) return;
    if (monthStr && d.slice(0, 7) !== monthStr) return;
    const g = String(r.Group == null ? '' : r.Group).trim();
    if (!g) return;
    if (!map[d]) map[d] = {};
    map[d][g] = {
      maxOff: Shift_ovNum_(r.MaxOff),
      shortSlots: Shift_ovNum_(r.ShortSlots),
      cpSlots: Shift_ovNum_(r.CPSlots),
      lateSlots: Shift_ovNum_(r.LateSlots),
      erSlots: Shift_ovNum_(r.ERSlots),
      note: String(r.Note == null ? '' : r.Note),
      __row: r.__row
    };
  });
  return map;
}

/**
 * ตัวรวมโควต้า: เอาโควต้าประจำมาเป็นฐาน แล้วทับด้วยโควต้าเฉพาะกิจถ้ามี
 * นี่คือฟังก์ชันหลักที่ ShiftRequestBackend.gs ต้องเรียกใช้แทนการอ่าน quotaMap ตรง ๆ
 */
function Shift_quotaFor_(quotaMap, ovMap, dateStr, wd, group) {
  const base = (quotaMap && quotaMap[group] && quotaMap[group][wd]) || {};
  const out = {
    maxOff: Number(base.maxOff) || 0,
    shortSlots: Number(base.shortSlots) || 0,
    cpSlots: Number(base.cpSlots) || 0,
    lateSlots: Number(base.lateSlots) || 0,
    erSlots: Number(base.erSlots) || 0,
    isOverride: false,
    overrideNote: '',
    overrideFields: []
  };
  const ov = ovMap && ovMap[dateStr] && ovMap[dateStr][group];
  if (!ov) return out;
  SHIFT_OV_FIELDS.forEach(function (f) {
    if (ov[f] !== '' && ov[f] !== null && ov[f] !== undefined) {
      out[f] = Number(ov[f]) || 0;
      out.isOverride = true;
      out.overrideFields.push(f);
    }
  });
  if (out.isOverride) out.overrideNote = ov.note || '';
  return out;
}

// หมายเหตุของวันนั้น (เอาอันแรกที่ไม่ว่าง) ไว้แสดงให้พนักงานเห็นว่าทำไมวันนี้ปิด
function Shift_overrideNoteFor_(ovMap, dateStr) {
  const byGroup = ovMap && ovMap[dateStr];
  if (!byGroup) return '';
  for (const g in byGroup) {
    if (byGroup[g] && byGroup[g].note) return byGroup[g].note;
  }
  return '';
}

// ================== ตรวจคำขอที่ค้างอยู่ว่าเกินโควต้าใหม่หรือไม่ ==================
/**
 * คืนรายการ conflict ของวันที่+กลุ่มนั้น (ไม่ลบอะไรทั้งสิ้น แค่รายงาน)
 * ใช้ cache ที่ส่งเข้ามาได้ เพื่อไม่ต้องอ่านชีตซ้ำเวลาวนหลายวัน
 */
function Shift_overrideConflicts_(dateStr, group, cache) {
  const monthStr = dateStr.slice(0, 7);
  cache = cache || {};
  if (!cache.quota) cache.quota = {};
  if (!cache.ov) cache.ov = {};
  if (!cache.quota[monthStr]) cache.quota[monthStr] = Shift_getQuotaMap_(monthStr);
  if (!cache.ov[monthStr]) cache.ov[monthStr] = Shift_getOverrideMap_(monthStr);
  if (!cache.requests) cache.requests = Shift_sheetToObjects_(Shift_requestSheet_()).rows;

  const wd = new Date(dateStr + 'T00:00:00').getDay();
  const eff = Shift_quotaFor_(cache.quota[monthStr], cache.ov[monthStr], dateStr, wd, group);

  const active = cache.requests.filter(function (r) {
    return Shift_normDate_(r.Date) === dateStr &&
           Shift_quotaGroup_(r.Position) === group &&
           r.Status === 'Active';
  });

  const out = [];
  Object.keys(SHIFT_TYPE_FIELD).forEach(function (t) {
    const max = eff[SHIFT_TYPE_FIELD[t]];
    // โควต้าวันหยุด (X) ถูกใช้ร่วมกับคำขอแผนกอื่น จึงต้องนับรวมกันตอนตรวจว่าเกินหรือไม่
    const list = (t === 'Off')
      ? active.filter(function (r) { return r.Type === 'Off' || r.Type === 'ER'; })
      : active.filter(function (r) { return r.Type === t; });
    if (list.length > max) {
      out.push({
        date: dateStr,
        group: group,
        groupLabel: SHIFT_QUOTA_GROUP_LABEL[group] || group,
        type: t,
        typeLabel: SHIFT_TYPE_LABEL[t] + (t === 'Off' ? ' (รวมแผนกอื่น)' : ''),
        count: list.length,
        max: max,
        names: list.map(function (r) { return r.Name + (r.Type === 'ER' ? ' [แผนกอื่น]' : ''); })
      });
    }
  });
  return out;
}


// ================== ADMIN API ==================

/** รายการโควต้าเฉพาะกิจทั้งหมดของเดือนนั้น พร้อมสถานะว่ามีใครขอไว้เกินหรือไม่ */
function Shift_getQuotaOverrides(monthStr) {
  if (!Shift_isAdmin_()) return { ok: false, message: 'ไม่มีสิทธิ์เข้าถึง' };

  const ovMap = Shift_getOverrideMap_(monthStr);
  const cache = {};
  const items = [];

  Object.keys(ovMap).sort().forEach(function (dateStr) {
    const wd = new Date(dateStr + 'T00:00:00').getDay();
    SHIFT_QUOTA_GROUPS.forEach(function (group) {
      const raw = ovMap[dateStr][group];
      if (!raw) return;
      const quotaMap = Shift_getQuotaMap_(monthStr);
      const eff = Shift_quotaFor_(quotaMap, ovMap, dateStr, wd, group);
      items.push({
        date: dateStr,
        weekday: wd,
        weekdayLabel: SHIFT_WEEKDAY_LABEL[wd],
        group: group,
        groupLabel: SHIFT_QUOTA_GROUP_LABEL[group] || group,
        // ค่าที่ admin กรอกไว้ ('' = ไม่ override ช่องนี้)
        maxOff: raw.maxOff,
        shortSlots: raw.shortSlots,
        cpSlots: raw.cpSlots,
        lateSlots: raw.lateSlots,
        erSlots: raw.erSlots,
        note: raw.note,
        // ค่าที่ใช้จริงหลังรวมกับโควต้าประจำ
        effective: {
          maxOff: eff.maxOff, shortSlots: eff.shortSlots,
          cpSlots: eff.cpSlots, lateSlots: eff.lateSlots, erSlots: eff.erSlots
        },
        conflicts: Shift_overrideConflicts_(dateStr, group, cache)
      });
    });
  });

  return {
    ok: true,
    month: monthStr,
    items: items,
    groups: SHIFT_QUOTA_GROUPS.map(function (g) {
      return { value: g, label: SHIFT_QUOTA_GROUP_LABEL[g] };
    }),
    fields: SHIFT_OV_FIELDS.map(function (f) {
      return { value: f, label: SHIFT_FIELD_LABEL[f] };
    })
  };
}

/**
 * บันทึกโควต้าเฉพาะกิจ (เพิ่มใหม่หรือทับของเดิม)
 * items = [{ date:'2026-10-23', group:'RN', maxOff:0, shortSlots:'', cpSlots:'', lateSlots:'', erSlots:'', note:'ตรวจใหญ่' }, ...]
 * ค่าที่เป็น '' หรือ null = ไม่ override ช่องนั้น (ใช้โควต้าประจำตามเดิม)
 */
function Shift_saveQuotaOverrides(items) {
  if (!Shift_isAdmin_()) return { ok: false, message: 'ไม่มีสิทธิ์เข้าถึง' };
  if (!items || !items.length) return { ok: false, message: 'ไม่มีข้อมูลให้บันทึก' };

  const me = Shift_getCurrentUserWithPosition_();
  const sh = Shift_overrideSheet_();
  const { rows } = Shift_sheetToObjects_(sh);
  const now = new Date();
  const touched = [];

  items.forEach(function (it) {
    const dateStr = Shift_normDate_(it.date);
    const group = String(it.group == null ? '' : it.group).trim();
    if (!dateStr || SHIFT_QUOTA_GROUPS.indexOf(group) === -1) return;

    const vals = [
      dateStr, group,
      Shift_ovNum_(it.maxOff), Shift_ovNum_(it.shortSlots), Shift_ovNum_(it.cpSlots),
      Shift_ovNum_(it.lateSlots), Shift_ovNum_(it.erSlots),
      String(it.note == null ? '' : it.note).slice(0, 300),
      now, me ? me.email : ''
    ];

    // ถ้าทุกช่องว่างหมด = ไม่ override อะไรเลย ให้ลบแถวทิ้งแทนการเก็บแถวเปล่า
    const allBlank = [vals[2], vals[3], vals[4], vals[5], vals[6]].every(function (v) { return v === ''; });

    const existing = rows.find(function (r) {
      return Shift_normDate_(r.Date) === dateStr && String(r.Group).trim() === group;
    });

    if (allBlank) {
      if (existing) sh.getRange(existing.__row, 1, 1, 10).setValues([[dateStr, group, '', '', '', '', '', '', now, me ? me.email : '']]);
      return;
    }

    if (existing) sh.getRange(existing.__row, 1, 1, 10).setValues([vals]);
    else sh.appendRow(vals);

    touched.push({ date: dateStr, group: group });
  });

  SpreadsheetApp.flush();

  // ตรวจว่ามีคำขอเดิมที่เกินโควต้าใหม่หรือไม่ (ไม่ลบ แค่แจ้งเตือน)
  const cache = {};
  let conflicts = [];
  touched.forEach(function (t) {
    conflicts = conflicts.concat(Shift_overrideConflicts_(t.date, t.group, cache));
  });

  return {
    ok: true,
    message: 'บันทึกโควต้าเฉพาะกิจเรียบร้อย (' + touched.length + ' รายการ)',
    conflicts: conflicts
  };
}

/**
 * ทางลัด: ปิดรับคำขอทั้งวัน (ทุกตำแหน่ง ทุกประเภท = 0)
 * dates = ['2026-10-23', '2026-10-24']
 * types = (ไม่ใส่ = ปิดทุกประเภท) หรือระบุเช่น ['Off','ShortShift'] เพื่อปิดเฉพาะบางประเภท
 * groups = (ไม่ใส่ = ทุกกลุ่ม) หรือระบุเช่น ['RN']
 */
function Shift_closeDates(dates, note, types, groups) {
  if (!Shift_isAdmin_()) return { ok: false, message: 'ไม่มีสิทธิ์เข้าถึง' };
  if (!dates || !dates.length) return { ok: false, message: 'กรุณาเลือกวันที่อย่างน้อย 1 วัน' };

  const useGroups = (groups && groups.length) ? groups : SHIFT_QUOTA_GROUPS;
  const useTypes = (types && types.length) ? types : Object.keys(SHIFT_TYPE_FIELD);

  const items = [];
  dates.forEach(function (d) {
    useGroups.forEach(function (g) {
      const it = { date: d, group: g, note: note || '', maxOff: '', shortSlots: '', cpSlots: '', lateSlots: '', erSlots: '' };
      useTypes.forEach(function (t) {
        const f = SHIFT_TYPE_FIELD[t];
        if (f) it[f] = 0;
      });
      items.push(it);
    });
  });

  return Shift_saveQuotaOverrides(items);
}

/** ลบโควต้าเฉพาะกิจ — ถ้าไม่ระบุ group จะลบทุกกลุ่มของวันนั้น (กลับไปใช้โควต้าประจำ) */
function Shift_deleteQuotaOverride(dateStr, group) {
  if (!Shift_isAdmin_()) return { ok: false, message: 'ไม่มีสิทธิ์เข้าถึง' };
  const target = Shift_normDate_(dateStr);
  const g = String(group == null ? '' : group).trim();

  const sh = Shift_overrideSheet_();
  const { rows } = Shift_sheetToObjects_(sh);
  const hit = rows.filter(function (r) {
    return Shift_normDate_(r.Date) === target && (!g || String(r.Group).trim() === g);
  });
  if (!hit.length) return { ok: false, message: 'ไม่พบโควต้าเฉพาะกิจของวันที่นี้' };

  hit.sort(function (a, b) { return b.__row - a.__row; })
     .forEach(function (r) { sh.deleteRow(r.__row); });

  return { ok: true, message: 'ลบโควต้าเฉพาะกิจเรียบร้อย (' + hit.length + ' รายการ) วันนั้นกลับไปใช้โควต้าประจำตามเดิม' };
}

/** ใช้ตอนพนักงานเปิดหน้าขอเวร เพื่อแสดงกล่องแจ้งเตือนด้านบนว่าเดือนนี้มีวันไหนพิเศษบ้าง */
function Shift_getOverrideNotices(monthStr) {
  const ovMap = Shift_getOverrideMap_(monthStr);
  const quotaMap = Shift_getQuotaMap_(monthStr);
  const out = [];
  Object.keys(ovMap).sort().forEach(function (dateStr) {
    const wd = new Date(dateStr + 'T00:00:00').getDay();
    const parts = [];
    SHIFT_QUOTA_GROUPS.forEach(function (g) {
      if (!ovMap[dateStr][g]) return;
      const eff = Shift_quotaFor_(quotaMap, ovMap, dateStr, wd, g);
      if (!eff.isOverride) return;
      const detail = eff.overrideFields.map(function (f) {
        return SHIFT_FIELD_LABEL[f] + ' ' + eff[f] + ' คน';
      }).join(', ');
      parts.push((SHIFT_QUOTA_GROUP_LABEL[g] || g) + ': ' + detail);
    });
    if (parts.length) {
      out.push({
        date: dateStr,
        weekdayLabel: SHIFT_WEEKDAY_LABEL[wd],
        note: Shift_overrideNoteFor_(ovMap, dateStr),
        detail: parts.join(' | ')
      });
    }
  });
  return { ok: true, month: monthStr, notices: out };
}

