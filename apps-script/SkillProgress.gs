/**
 * SkillProgress.gs — ความคืบหน้าบทเรียนด้านทักษะ (EKG, CPR) สำหรับหน้า Admin
 * สร้างเป็นไฟล์ใหม่ในโปรเจกต์ (ไฟล์ > สคริปต์ > ตั้งชื่อ SkillProgress) แล้ววางทั้งไฟล์
 *
 * - logSkillProgress(data)  : หน้าบทเรียนทักษะเรียกเมื่อเข้าบท / เรียนคืบหน้า / เรียนจบ → ชีต SkillProgress
 * - getSkillProgressAll()   : หน้า Admin เรียก (เฉพาะ admin/hr) รวมข้อมูลจาก
 *     SkillProgress + EKG_Results + EKG_Progress + EKG_State (ข้อมูลเดิมที่มีอยู่แล้ว)
 */

var SKILL_SHEET = 'SkillProgress';
var SKILL_HEADERS = ['เวลา', 'Email', 'ชื่อ', 'แผนก', 'หมวด', 'รหัสบท', 'ชื่อบท', 'สถานะ', 'คะแนน', 'คะแนนเต็ม', 'หมายเหตุ'];

/** บทย่อยของ CPR = บทบาทในเครื่องฝึก (ต้องตรงกับ ROLES ในไฟล์ cpr_trainer) */
var CPR_SUB_LESSONS = [
  { id: 'physician', title: 'แพทย์ผู้สั่งการ' },
  { id: 'mednurse',  title: 'พยาบาลให้ยา' },
  { id: 'airway',    title: 'Airway / NA' },
  { id: 'recorder',  title: 'Recorder' }
];

/** รายการหมวดทักษะ + บทย่อย (บท EKG ดึงจาก EKG_OJT_COURSES ใน Code_EKG.gs) */
function skillModules_() {
  var ekg = (typeof EKG_OJT_COURSES !== 'undefined' ? EKG_OJT_COURSES : []).map(function (c) {
    return { id: String(c.id).replace(/^EKG-/, ''), title: String(c.title).replace(/^การอ่าน EKG:\s*/, '') };
  });
  return [
    { key: 'ekg', icon: '🫀', title: 'การอ่าน EKG', lessons: ekg },
    { key: 'cpr', icon: '🫁', title: 'CPR / ACLS Trainer', lessons: CPR_SUB_LESSONS }
  ];
}

function skillNorm_(s) {
  return String(s || '').replace(/^การอ่าน EKG:\s*/, '').replace(/[\s:：·\-–—\/()]/g, '').toLowerCase();
}

function skillLessonIdByTitle_(module, title) {
  var n = skillNorm_(title);
  if (!n) return '';
  var mod = skillModules_().filter(function (m) { return m.key === module; })[0];
  if (!mod) return '';
  var hit = mod.lessons.filter(function (l) { return skillNorm_(l.title) === n; })[0];
  return hit ? hit.id : '';
}

function skillSheet_() {
  var ss = ss_();
  var sh = ss.getSheetByName(SKILL_SHEET);
  if (!sh) {
    sh = ss.insertSheet(SKILL_SHEET);
    sh.appendRow(SKILL_HEADERS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, SKILL_HEADERS.length)
      .setBackground('#0E8A5F').setFontColor('#FFFFFF').setFontWeight('bold');
  }
  return sh;
}

function skillFmt_(d) {
  if (!d) return '';
  var t = (d instanceof Date) ? d : new Date(d);
  if (isNaN(t.getTime())) return '';
  return Utilities.formatDate(t, 'Asia/Bangkok', 'd/M/yyyy HH:mm');
}

/* ======================= บันทึกความคืบหน้า (พนักงาน) ======================= */
// data = { module:'ekg'|'cpr', lessonId?, lessonTitle?, status:'in_progress'|'passed', score?, total?, note? }
function logSkillProgress(data) {
  var user = requireLogin_();
  data = data || {};
  var module = String(data.module || '').toLowerCase();
  if (['ekg', 'cpr'].indexOf(module) === -1) throw new Error('ไม่รู้จักหมวดบทเรียน: ' + module);
  var status = data.status === 'passed' ? 'passed' : 'in_progress';
  var sc = Number(data.score), tt = Number(data.total);
  if (status === 'passed' && tt > 0 && sc / tt < PASS_THRESHOLD) status = 'in_progress';
  var lessonId = String(data.lessonId || '') || skillLessonIdByTitle_(module, data.lessonTitle);
  var title = String(data.lessonTitle || '').slice(0, 200);
  if (!lessonId && !title) throw new Error('ไม่ระบุบทเรียน');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    skillSheet_().appendRow([
      new Date(), String(user.email).toLowerCase(), user.name, user.dept, module,
      lessonId, title, status,
      data.score === undefined ? '' : Number(data.score) || 0,
      data.total === undefined ? '' : Number(data.total) || 0,
      String(data.note || '').slice(0, 200)
    ]);
  } finally {
    lock.releaseLock();
  }
  return { ok: true };
}

/* ======================= อ่านข้อมูลทั้งหมด (Admin) ======================= */
function getSkillProgressAll() {
  requireAdmin_();
  var modules = skillModules_();
  var P = {};          // P[email][module][lessonId] = {status, score, total, date, note, t}
  var LAST = {};       // LAST[email] = Date

  function put(email, module, lessonId, rec) {
    if (!email || !lessonId) return;
    email = String(email).toLowerCase().trim();
    P[email] = P[email] || {};
    P[email][module] = P[email][module] || {};
    var cur = P[email][module][lessonId];
    var rank = { in_progress: 1, passed: 2 };
    var t = rec.t instanceof Date ? rec.t : (rec.t ? new Date(rec.t) : null);
    if (t && !isNaN(t.getTime()) && (!LAST[email] || t > LAST[email])) LAST[email] = t;
    if (!cur || rank[rec.status] > rank[cur.status] ||
        (rank[rec.status] === rank[cur.status] && t && (!cur.t || t > cur.t))) {
      // เก็บคะแนนที่ดีที่สุดไว้เสมอ
      if (cur && cur.status === 'passed' && rec.status === 'passed' && (Number(cur.score) || 0) > (Number(rec.score) || 0)) {
        rec.score = cur.score; rec.total = cur.total;
      }
      rec.t = t;
      P[email][module][lessonId] = rec;
    }
  }

  function rows(name) {
    var sh = ss_().getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) return [];
    return sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  }

  // 1) SkillProgress (ข้อมูลใหม่จากหน้าบทเรียน)
    rows(SKILL_SHEET).forEach(function (r) {
    var module = String(r[4]), id = String(r[5]) || skillLessonIdByTitle_(module, r[6]);
    var st = String(r[7]) === 'passed' ? 'passed' : 'in_progress';
    var sc = Number(r[8]), tt = Number(r[9]);
    var note = String(r[10] || '');
    if (st === 'passed' && tt > 0 && sc / tt < PASS_THRESHOLD) {   // บันทึกเก่าที่ถูกตีเป็นผ่านทั้งที่คะแนนไม่ถึง
      st = 'in_progress';
      note = 'ยังไม่ผ่านเกณฑ์ (' + sc + '/' + tt + ')';
    }
    put(r[1], module, id, { status: st, score: r[8], total: r[9], note: note, t: r[0] });
  });

  // 2) EKG_Results (สอบผ่าน + ลายเซ็น)
  rows('EKG_Results').forEach(function (r) {
    put(r[0], 'ekg', String(r[2]), { status: 'passed', score: r[4], total: r[5],
      note: r[8] ? 'เซ็นชื่อแล้ว' : '', t: r[7] });
  });

  // 3) EKG_Progress (ฉบับเดิม: บันทึกตอนเรียนจบบท)
  rows('EKG_Progress').forEach(function (r) {
    put(r[0], 'ekg', skillLessonIdByTitle_('ekg', r[2]), { status: 'passed', score: r[3], total: r[4], note: '', t: r[5] });
  });

  // 4) EKG_State (ความคืบหน้าที่บันทึกไว้บนเซิร์ฟเวอร์ ถ้ามี)
  var ekgIds = (modules[0].lessons || []).map(function (l) { return l.id; });
  rows('EKG_State').forEach(function (r) {
    var st; try { st = JSON.parse(r[1]); } catch (e) { return; }
    if (!st || typeof st !== 'object') return;
    var when = r[2];
    Object.keys(st.done || {}).forEach(function (id) {
      if (st.done[id]) put(r[0], 'ekg', id, { status: 'passed', note: '', t: when });
    });
    // วัตถุอื่นที่ใช้รหัสบทเป็นคีย์ (เช่น drill, pracBy) = เคยเข้าเรียนบทนั้น
    Object.keys(st).forEach(function (k) {
      var v = st[k];
      if (k === 'done' || !v || typeof v !== 'object' || Array.isArray(v)) return;
      var keys = Object.keys(v);
      if (!keys.length || !keys.every(function (x) { return ekgIds.indexOf(x) > -1; })) return;
      keys.forEach(function (id) { put(r[0], 'ekg', id, { status: 'in_progress', note: '', t: when }); });
    });
  });

  // แปลงวันที่เป็นข้อความ (ส่ง Date กลับไปหน้าเว็บตรง ๆ ไม่ได้)
  var out = {};
  Object.keys(P).forEach(function (email) {
    out[email] = { last: skillFmt_(LAST[email]) };
    Object.keys(P[email]).forEach(function (m) {
      out[email][m] = {};
      Object.keys(P[email][m]).forEach(function (id) {
        var x = P[email][m][id];
        out[email][m][id] = { status: x.status, score: x.score === '' ? null : x.score,
          total: x.total === '' ? null : x.total, note: x.note || '', date: skillFmt_(x.t) };
      });
    });
  });
  return { modules: modules, progress: out };
}


/* ======================= ผลฝึก CPR → ระบบหลัก (กระดาษคำตอบ / ลายเซ็น / OJT) ======================= */
/** บท CPR ที่ใช้ในแบบฟอร์ม OJT และกระดาษคำตอบ (1 บทบาท = 1 บท) */
var CPR_OJT_COURSES = CPR_SUB_LESSONS.map(function (l) {
  return { id: 'CPR-' + l.id, title: 'CPR / ACLS: ' + l.title };
});

/** หน้า CPR เรียกเมื่อฝึกครบ 1 บทบาท → บันทึกลงชีต Attempts (รูปแบบเดียวกับบทเรียนหลัก)
 *  data = { role, details:[{q, chosenText, correctText, correct}] }
 *  คะแนน = จำนวนจุดตัดสินใจที่ตอบถูกตั้งแต่ครั้งแรก · ผ่านที่ 80% → เซ็นชื่อได้ด้วย saveSignature() เดิม */
function saveCprResult(data) {
  var user = requireLogin_();
  data = data || {};
  var course = CPR_OJT_COURSES.filter(function (c) { return c.id === 'CPR-' + data.role; })[0];
  if (!course) throw new Error('ไม่รู้จักบทบาท: ' + data.role);
  var list = Array.isArray(data.details) ? data.details.slice(0, 40) : [];
  if (!list.length) throw new Error('ไม่มีข้อมูลผลการฝึก');

  var details = list.map(function (d) {
    var o = {
      q: String(d.q || '').slice(0, 400), chosenIndex: null,
      chosenText: String(d.chosenText || '-').slice(0, 400), correctIndex: null,
      correctText: String(d.correctText || '-').slice(0, 400), correct: d.correct === true,
      i: Number(d.i)
    };
    var pth = d.path;   // ผลที่ตามมาเมื่อเลือกผิด (ใช้ในกระดาษคำตอบแบบ Full timeline)
    if (pth && typeof pth === 'object') {
      o.path = {
        kind: String(pth.kind || '').slice(0, 5), worst: Number(pth.worst) || 0, last: Number(pth.last) || 0,
        bads: Number(pth.bads) || 0, end: String(pth.end || '').slice(0, 220),
        stages: (Array.isArray(pth.stages) ? pth.stages : []).slice(0, 8).map(function (x) {
          return { h: String(x.h || '').slice(0, 90), s: Number(x.s) || 0, r: String(x.r || '').slice(0, 6) };
        })
      };
    }
    if (d.mix && typeof d.mix === 'object') {   // ยา/syringe ที่เตรียม (ใช้วาดภาพในกระดาษคำตอบ)
      var cl = function (a) { return (Array.isArray(a) ? a : []).slice(0, 6).map(function (x) { return { id: String(x.id || '').slice(0, 12), ml: Number(x.ml) || 0 }; }); };
      o.mix = { drug: cl(d.mix.drug), flush: cl(d.mix.flush) };
    }
    return o;
  });
  var mt = data.meta || {};
  details[0].cpr = { role: String(data.role), mistakes: Number(mt.mistakes) || 0, harm: Number(mt.harm) || 0,
                     rescued: Number(mt.rescued) || 0, minS: Number(mt.minS) || 0 };
  var score = details.filter(function (d) { return d.correct; }).length;
  var total = details.length;
  var pass = (score / total) >= PASS_THRESHOLD;
  var attemptId = Utilities.getUuid();

  getSheet_(SHEET_ATTEMPTS).appendRow([
    new Date(), user.email, user.name, user.dept,
    course.id, course.title, score, total, pass,
    JSON.stringify(details), attemptId
  ]);
  // ภาพฉากสถานการณ์ ณ จุดตัดสินใจ → ชีต CPR_PaperImages
  var im = data.images || {}, rowsImg = [];
  Object.keys(im).slice(0, 40).forEach(function (k) {
    var u = String(im[k] || '');
    if (u.indexOf('data:image/') === 0 && u.length < 49500) rowsImg.push([attemptId, Number(k), u]);
  });
  if (rowsImg.length) {
    var ss = ss_(), ish = ss.getSheetByName(CPR_IMG_SHEET);
    if (!ish) { ish = ss.insertSheet(CPR_IMG_SHEET); ish.appendRow(['AttemptId', 'เหตุการณ์ที่', 'รูป (ข้อมูล)']); ish.setFrozenRows(1); }
    ish.getRange(ish.getLastRow() + 1, 1, rowsImg.length, 3).setValues(rowsImg);
  }
  var award = null;
  try { if (pass) award = cprAwardPoints_(user, attemptId); } catch (e) { /* ไม่ให้เรื่องแต้มบล็อกการบันทึกผล */ }
  return { attemptId: attemptId, score: score, total: total, pass: pass, award: award };
}
var CPR_IMG_SHEET = 'CPR_PaperImages';

/* ======================= แต้มของบทเรียน CPR / ACLS =======================
   RN     : ต้องผ่านครบทั้ง 4 บทบาท → 5 คนแรกได้ 5·4·3·2·1 แต้ม
   PN/NA  : ต้องผ่านบทบาท Airway / NA (เปิดทางเดินหายใจ) → 5 คนแรกได้ 5·4·3·2·1 แต้ม
   ระบบดูตำแหน่งจากคอลัมน์ "Position" ในชีต Users (RN / PN / NA)
   ไม่ได้กรอกตำแหน่งไว้ = ใช้เกณฑ์ของ RN                                    */
var CPR_POINT_KEYS = {
  rn: { id: 'CPR-ALL',    title: 'CPR / ACLS: ผ่านครบทั้ง 4 บทบาท (RN)' },
  pn: { id: 'CPR-AIRWAY', title: 'CPR / ACLS: บทบาท Airway / NA (PN/NA)' }
};

/** ตำแหน่งของพนักงานจากชีต Users → 'rn' หรือ 'pn' */
function userPosition_(email) {
  var sh = getSheet_(SHEET_USERS), data = sh.getDataRange().getValues(), h = data[0];
  var iEmail = h.indexOf('Email'), iPos = h.indexOf('Position');
  if (iPos === -1) iPos = h.indexOf('ตำแหน่ง');
  if (iPos === -1) return 'rn';
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][iEmail]).trim().toLowerCase() === String(email).trim().toLowerCase()) {
      var p = String(data[i][iPos] || '').toUpperCase();
      return (p.indexOf('PN') > -1 || p.indexOf('NA') > -1 || p.indexOf('ผู้ช่วย') > -1) ? 'pn' : 'rn';
    }
  }
  return 'rn';
}

/** ให้แต้มเมื่อครบเงื่อนไขของตำแหน่งนั้น — คืน {points, rank, title} หรือ null */
function cprAwardPoints_(user, attemptId) {
  var me = String(user.email).toLowerCase();
  var passed = {};
  readAttempts_().forEach(function (a) {
    if (a.pass && a.email.toLowerCase() === me && String(a.courseId).indexOf('CPR-') === 0) passed[a.courseId] = 1;
  });
  var pos = userPosition_(user.email);
  if (pos === 'pn') {
    if (!passed['CPR-airway']) return null;                       // PN/NA ต้องผ่านบทบาทเปิดทางเดินหายใจ
  } else {
    var all = CPR_SUB_LESSONS.every(function (l) { return passed['CPR-' + l.id]; });
    if (!all) return null;                                        // RN ต้องผ่านครบทั้ง 4 บทบาท
  }
  var course = CPR_POINT_KEYS[pos];

  var sh = getSheet_(SHEET_POINTS), data = sh.getDataRange().getValues(), used = 0;
  for (var i = 1; i < data.length; i++) {
    if (data[i][4] === course.id) {
      used++;
      if (String(data[i][1]).toLowerCase() === me) return null;    // คนเดิมได้ครั้งเดียว
    }
  }
  if (used >= POINTS_QUOTA_PER_COURSE) return null;                // ครบ 5 คนแรกแล้ว
  if (getPointsBalance_(user.email) >= POINTS_TO_REDEEM) return null; // แต้มค้างครบ 50 ต้องแลกก่อน

  var rank = used + 1, points = POINTS_BY_RANK[rank - 1];
  sh.appendRow([new Date(), user.email, user.name, user.dept, course.id, course.title, rank, points, attemptId]);
  return { points: points, rank: rank, title: course.title };
}

/** กระดาษคำตอบ CPR แบบ Full timeline (เจ้าของผลฝึก หรือ Admin/HR)
 *  key = attemptId หรือ 'latest:CPR-<role>' (ฉบับล่าสุดของตัวเอง) */
function getCprPaper(key) {
  var user = requireLogin_(), me = String(user.email).toLowerCase();
  var all = readAttempts_(), a;
  key = String(key || '');
  if (key.indexOf('latest:') === 0) {
    a = all.filter(function (x) { return x.courseId === key.slice(7) && x.email.toLowerCase() === me; }).pop();
  } else {
    a = all.filter(function (x) { return x.id === key; })[0];
  }
  if (!a || String(a.courseId).indexOf('CPR-') !== 0) throw new Error('ไม่พบผลฝึก CPR นี้');
  var isAdmin = ['admin', 'hr'].indexOf(user.role) > -1;
  if (!isAdmin && a.email.toLowerCase() !== me) throw new Error('คุณไม่มีสิทธิ์ดูผลฝึกนี้');
  var sig = readSignatures_().filter(function (x) { return x.attemptId === a.id; }).pop();
  var images = {};
  var sh = ss_().getSheetByName(CPR_IMG_SHEET);
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(function (r) {
      if (String(r[0]) === a.id) images[Number(r[1])] = String(r[2]);
    });
  }
  var meta = (a.details[0] && a.details[0].cpr) || {};
  return {
    id: a.id, role: String(a.courseId).slice(4), name: a.name, dept: a.dept, when: ekgThaiDate_(a.date),
    score: Number(a.score) || 0, total: Number(a.total) || 0, pass: a.pass,
    details: a.details, meta: meta.mistakes != null ? meta : null, images: images,
    signature: sig ? sig.signatureDataUrl : '', signedAt: sig ? ekgThaiDate_(sig.date) : ''
  };
}

/** หน้า Admin เรียก: รายชื่อบททักษะสำหรับช่อง "สร้างแบบฟอร์ม OJT" */
function getSkillOjtCourses() {
  requireAdmin_();
  var ekg = (typeof EKG_OJT_COURSES !== 'undefined' ? EKG_OJT_COURSES : []);
  return {
    ekg: ekg.map(function (c) { return { id: c.id, title: c.title }; }),
    cpr: CPR_OJT_COURSES
  };
}


/* ======================= กระดาษคำตอบ EKG (มีรูปกราฟ) ======================= */
var EKG_IMG_SHEET = 'EKG_PaperImages';
var EKG_ITEM_SHEET = 'EKG_PaperItems';
/** หน้า EKG เรียกเมื่อสอบครบ 1 รอบ (ผ่านหรือไม่ผ่าน) → 1 แถวในชีต Attempts
 *  details = ข้อความรายข้อ (ใช้ในกระดาษคำตอบของระบบหลัก)
 *  meta    = ค่าเริ่มสุ่ม + คำตอบที่เลือก (หน้า EKG ใช้สร้างรูปกราฟชุดเดิมซ้ำตอนพิมพ์) */
function saveEkgPaper(data) {
  var user = requireLogin_();
  data = data || {};
  var course = (typeof EKG_OJT_COURSES !== 'undefined' ? EKG_OJT_COURSES : [])
    .filter(function (c) { return c.id === 'EKG-' + data.lessonId; })[0];
  if (!course) throw new Error('ไม่พบบทเรียน EKG รหัส ' + data.lessonId);
  var list = Array.isArray(data.details) ? data.details.slice(0, 150) : [];
  if (!list.length) throw new Error('ไม่มีข้อมูลคำตอบ');
  var m = data.meta || {};
  var meta = {
    lesson: String(m.lesson || data.lessonId).slice(0, 30),
    base: Number(m.base) || 0,
    attempt: Number(m.attempt) || 1,
    picks: (Array.isArray(m.picks) ? m.picks : []).slice(0, 150).map(function (x) { return Number(x) || 0; })
  };
  function build(max) {
    return list.map(function (d, i) {
      var o = {
        q: String(d.q || '').slice(0, max), chosenIndex: null,
        chosenText: String(d.chosenText || '-').slice(0, max), correctIndex: null,
        correctText: String(d.correctText || '-').slice(0, max), correct: d.correct === true
      };
      if (i === 0) o.ekg = meta;
      return o;
    });
  }
  var json = JSON.stringify(build(160));
  if (json.length > 48000) json = JSON.stringify(build(70));
  var score = Number(data.score) || 0, total = Number(data.total) || 0;
  if (!total) throw new Error('คะแนนเต็มไม่ถูกต้อง');
  var pass = (score / total) >= PASS_THRESHOLD;

  var sh = getSheet_(SHEET_ATTEMPTS);
  var attemptId = String(data.attemptId || '');
  var existingRow = attemptId ? ekgFindAttemptRow_(sh, attemptId) : 0;
  if (!attemptId) attemptId = Utilities.getUuid();

  if (existingRow) {
    sh.getRange(existingRow, 1, 1, 11).setValues([[
      new Date(), user.email, user.name, user.dept,
      course.id, course.title, score, total, pass, json, attemptId
    ]]);
  } else {
    sh.appendRow([
      new Date(), user.email, user.name, user.dept,
      course.id, course.title, score, total, pass, json, attemptId
    ]);
  }

  var imgs = (Array.isArray(data.images) ? data.images : []).slice(0, 40);
  var rowsImg = [];
  imgs.forEach(function (u, i) {
    u = String(u || '');
    if (u.indexOf('data:image/') === 0 && u.length < 49500) rowsImg.push([attemptId, i, u]);
  });
  if (rowsImg.length) {
    var ss = ss_(), ish = ss.getSheetByName(EKG_IMG_SHEET);
    if (!ish) { ish = ss.insertSheet(EKG_IMG_SHEET); ish.appendRow(['AttemptId', 'ลำดับรูป', 'รูป (ข้อมูล)']); ish.setFrozenRows(1); }
    if (existingRow) {
      var lastR = ish.getLastRow();
      if (lastR > 1) {
        var vals = ish.getRange(2, 1, lastR - 1, 1).getValues();
        for (var r = vals.length; r >= 1; r--) {
          if (String(vals[r - 1][0]) === attemptId) ish.deleteRow(r + 1);
        }
      }
    }
    ish.getRange(ish.getLastRow() + 1, 1, rowsImg.length, 3).setValues(rowsImg);
  }

  // เคลียร์ extras (ช้อยส์เต็ม/คำอธิบายรายข้อ) ของเก่าที่อาจตกค้างจากยุคก่อนสำหรับ attemptId นี้
  // เวอร์ชันนี้ไม่ส่ง extras มาบันทึกอีกแล้ว (ต้องการกระดาษคำตอบแบบสรุปรวม ไม่ใช่แบบเฉลยทีละข้อ)
  // ถ้าปล่อยของเก่าตกค้างไว้ enhanceEkgPapers() ในหน้าเว็บจะยังไปเจอแล้วแสดงเฉลยแบบเก่าซ้อนขึ้นมา
  if (existingRow) {
    var xsh = ss_().getSheetByName(EKG_ITEM_SHEET);
    if (xsh) {
      var lastX = xsh.getLastRow();
      if (lastX > 1) {
        var xvals = xsh.getRange(2, 1, lastX - 1, 1).getValues();
        for (var xr = xvals.length; xr >= 1; xr--) {
          if (String(xvals[xr - 1][0]) === attemptId) xsh.deleteRow(xr + 1);
        }
      }
    }
  }

  return { attemptId: attemptId, pass: pass };
}

function ekgFindAttemptRow_(sh, attemptId) {
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var ids = sh.getRange(2, 11, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === attemptId) return i + 2;
  }
  return 0;
}


/** ตรวจว่า attemptId เป็นผลสอบของผู้ใช้คนนี้ในบทนี้จริง (ใช้ใน saveEkgResult) */
function ekgOwnAttempt_(attemptId, email, courseId) {
  return readAttempts_().some(function (a) {
    return a.id === attemptId && a.email.toLowerCase() === String(email).toLowerCase() && a.courseId === courseId;
  });
}

/** เปิดกระดาษคำตอบแบบมีรูป (เจ้าของผลสอบ หรือ Admin/HR) */
function getEkgPaper(attemptId) {
  var user = requireLogin_();
  var all = readAttempts_(), a;
  if (String(attemptId).indexOf('latest:') === 0) {       // ฉบับล่าสุดของตัวเองในบทนั้น
    var cid = String(attemptId).slice(7), me = String(user.email).toLowerCase();
    a = all.filter(function (x) { return x.courseId === cid && x.email.toLowerCase() === me; }).pop();
    if (a) attemptId = a.id;
  } else {
    a = all.filter(function (x) { return x.id === attemptId; })[0];
  }
  if (!a) throw new Error('ไม่พบผลสอบนี้');
  var isAdmin = ['admin', 'hr'].indexOf(user.role) > -1;
  if (!isAdmin && a.email.toLowerCase() !== String(user.email).toLowerCase()) throw new Error('คุณไม่มีสิทธิ์ดูผลสอบนี้');
  var sig = readSignatures_().filter(function (s) { return s.attemptId === attemptId; }).pop();
  var meta = (a.details && a.details[0] && a.details[0].ekg) || null;
  return {
    name: a.name, dept: a.dept, when: ekgThaiDate_(a.date), title: a.title,
    score: Number(a.score) || 0, total: Number(a.total) || 0, pass: a.pass,
    meta: meta, signature: sig ? sig.signatureDataUrl : '',
    signedAt: sig ? ekgThaiDate_(sig.date) : ''
  };
}


/** รูปกราฟสำหรับกระดาษคำตอบในหน้าหลัก
 *  ids = ['<attemptId>' หรือ 'latest:<courseId>'] → { id: ['data:image…', …] }
 *  Admin/HR ดูได้ทุกคน · พนักงานดูได้เฉพาะของตัวเอง */
function getExamPaperImages(ids) {
  var user = requireLogin_();
  var isAdmin = ['admin', 'hr'].indexOf(user.role) > -1;
  var me = String(user.email).toLowerCase();
  var attempts = readAttempts_();
  var want = {}, out = {};
  (ids || []).slice(0, 60).forEach(function (key) {
    key = String(key);
    var a;
    if (key.indexOf('latest:') === 0) {
      var cid = key.slice(7);
      a = attempts.filter(function (x) { return x.courseId === cid && x.email.toLowerCase() === me; }).pop();
    } else {
      a = attempts.filter(function (x) { return x.id === key; })[0];
    }
    if (!a) return;
    if (!isAdmin && a.email.toLowerCase() !== me) return;
    want[a.id] = key;
    out[key] = [];
  });
  var sh = ss_().getSheetByName(EKG_IMG_SHEET);
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(function (r) {
    var key = want[String(r[0])];
    if (key) out[key][Number(r[1]) || 0] = String(r[2]);
  });
  return out;
}

/** รูปกราฟ + ช้อยส์ครบ + คำอธิบาย สำหรับกระดาษคำตอบบท EKG ในหน้าหลัก
 *  → { key: { imgs: [...], items: [{o:[ช้อยส์], a:ข้อที่ถูก, p:ข้อที่เลือก, e:คำอธิบาย, s:คำตอบของกราฟ}] } } */
function getEkgPaperExtras(ids) {
  var imgs = getExamPaperImages(ids);     // ตรวจสิทธิ์ในฟังก์ชันนี้แล้ว
  var user = requireLogin_(), me = String(user.email).toLowerCase();
  var attempts = readAttempts_(), idOf = {}, out = {};
  Object.keys(imgs).forEach(function (key) {
    out[key] = { imgs: imgs[key], items: [] };
    var a = key.indexOf('latest:') === 0
      ? attempts.filter(function (x) { return x.courseId === key.slice(7) && x.email.toLowerCase() === me; }).pop()
      : { id: key };
    if (a) idOf[a.id] = key;
  });
  var sh = ss_().getSheetByName(EKG_ITEM_SHEET);
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(function (r) {
    var key = idOf[String(r[0])];
    if (!key) return;
    try { out[key].items[Number(r[1]) || 0] = JSON.parse(r[2]); } catch (e) {}
  });
  return out;
}

/** 'yyyy-MM-dd HH:mm' → 'dd/MM/yyyy HH:mm น.' (รูปแบบเดียวกับกระดาษคำตอบบทอื่น) */
function ekgThaiDate_(t) {
  var m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})/.exec(String(t || ''));
  return m ? m[3] + '/' + m[2] + '/' + m[1] + ' ' + m[4] + ' น.' : String(t || '');
}

/** หน้า CPR เรียก: ผลฝึกที่ผ่านแล้วแต่ยังไม่ได้เซ็นชื่อ ของผู้ใช้คนนี้ (เปิดจากเครื่องไหนก็เห็น) */
function getMyCprPending() {
  var user = requireLogin_(), me = String(user.email).toLowerCase();
  var signed = {};
  readSignatures_().forEach(function (s) { if (s.attemptId) signed[String(s.attemptId)] = 1; });
  var label = {};
  CPR_SUB_LESSONS.forEach(function (l) { label['CPR-' + l.id] = l.title; });
  return readAttempts_().filter(function (a) {
    return a.pass && a.email.toLowerCase() === me && label[a.courseId] && a.id && !signed[a.id];
  }).map(function (a) {
    return { id: a.id, label: label[a.courseId], score: Number(a.score) || 0, total: Number(a.total) || 0, when: ekgThaiDate_(a.date) };
  }).reverse().slice(0, 20);
}

/* ======================= กระดาษคำตอบ CPR แบบ Full timeline ในหน้าหลัก ======================= */
/** ดึงลำดับเหตุการณ์ (EVENTS) และรายการขวดยาจากไฟล์ cpr_trainer เพื่อให้หน้าหลักวาดกระดาษได้เอง */
function getCprTimelineData() {
  requireLogin_();
  var cache = CacheService.getScriptCache();
  var hit = cache.get('cprTimeline_v2');
  if (hit) return JSON.parse(hit);
  var src = HtmlService.createHtmlOutputFromFile('cpr_trainer').getContent();
  var m = /var EVENTS=(\[[\s\S]*?\]);\s*\n/.exec(src);
  if (!m) throw new Error('อ่านลำดับเหตุการณ์จากไฟล์ cpr_trainer ไม่ได้');
  var vials = {}, re = /\{id:'([^']+)',name:'([^']+)',sub:'([^']*)',color:'([^']+)'/g, v;
  while ((v = re.exec(src))) vials[v[1]] = { id: v[1], name: v[2], sub: v[3], color: v[4] };
  var out = { events: JSON.parse(m[1]), vials: vials,
              roles: CPR_SUB_LESSONS.reduce(function (o, l) { o[l.id] = l.title; return o; }, {}) };
  try { cache.put('cprTimeline_v2', JSON.stringify(out), 21600); } catch (e) {}
  return out;
}

/** กระดาษคำตอบ CPR ล่าสุดของแต่ละบทบาท (ใช้แนบท้ายบท S1 และในกระดาษของบท CPR)
 *  who = อีเมลพนักงาน (Admin/HR) หรือ '' = ตัวเอง */
function getCprRolePapers(who) {
  var user = requireLogin_(), me = String(user.email).toLowerCase();
  var isAdmin = ['admin', 'hr'].indexOf(user.role) > -1;
  var email = (isAdmin && who) ? String(who).toLowerCase() : me;
  var latest = {};
  readAttempts_().forEach(function (a) {
    if (a.email.toLowerCase() === email && String(a.courseId).indexOf('CPR-') === 0) latest[a.courseId] = a.id;
  });
  return CPR_SUB_LESSONS.map(function (l) { return latest['CPR-' + l.id]; })
    .filter(Boolean).map(function (id) { return getCprPaper(id); });
}
