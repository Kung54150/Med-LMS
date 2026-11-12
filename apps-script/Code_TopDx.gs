/**
 * Code_TopDx.gs
 * กล่อง Top 5 กลุ่มอาการประจำเดือน สำหรับหน้าภาพรวมของระบบสะสมการเรียนรู้พนักงาน OPD1
 *
 * วิธีใช้
 *   1. ใน Apps Script กด + แล้วเลือก Script  ตั้งชื่อไฟล์ว่า  Code_TopDx
 *   2. ลบโค้ดตัวอย่างในไฟล์ใหม่ให้หมด แล้ววางไฟล์นี้ทั้งไฟล์
 *   3. Deploy > New version
 *
 * การอัปเดตข้อมูลรายเดือน ทำได้ 2 ทาง
 *   ทาง A (ง่ายที่สุด ไม่ต้องแตะโค้ด)
 *     สร้างชีตใหม่ชื่อ TopDiagnosis ในไฟล์ Google Sheets เดิม
 *     แถวที่ 1 เป็นหัวตาราง   กลุ่มอาการ | ม.ค. | ก.พ. | มี.ค. | ... | ธ.ค.
 *     แถวถัดไปใส่ชื่อกลุ่มอาการและจำนวนครั้งของแต่ละเดือน
 *     ถ้ามีชีตนี้ ระบบจะใช้ข้อมูลจากชีตแทนตัวเลขที่ฝังไว้ในโค้ดทันที
 *   ทาง B  แก้ตัวเลขในตาราง DX_DATA ด้านล่างนี้โดยตรง แล้ว Deploy ใหม่
 */

var DX_SHEET = 'TopDiagnosis';

var DX_MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
var DX_MONTHS_FULL = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
var DX_YEAR = 2569;

/* ตัวเลขจากไฟล์ สถิติผู้ป่วยตามกลุ่มอาการ อายุรกรรม ม.ค. ถึง ส.ค. 2569
   นับจำนวนครั้งที่เข้ารับบริการ 1 ครั้งนับ 1 กลุ่มอาการหลัก */
var DX_DATA = [
  ['ระบบทางเดินหายใจ / ไข้หวัด',[766,529,512,447,504,629,803,865]],
  ['โรคเรื้อรัง / เมตะบอลิก (HT, DM, DLP, ไทรอยด์)',[408,363,364,371,441,407,423,497]],
  ['ระบบทางเดินอาหาร',[385,322,335,302,329,324,363,385]],
  ['ปวดศีรษะ / เวียนศีรษะ / ระบบประสาท',[186,183,209,173,221,243,251,273]],
  ['ผิวหนัง',[164,135,131,179,157,157,185,199]],
  ['ติดตามอาการต่อเนื่อง (ไม่ระบุโรค)',[95,101,108,115,130,128,119,125]],
  ['ฟังผล / รับยา / หัตถการ / นัดตรวจพิเศษ',[79,82,101,89,106,110,122,146]],
  ['อื่น ๆ / ไม่ระบุอาการ',[86,52,87,84,95,92,115,107]],
  ['หัวใจ / หลอดเลือด',[62,54,55,56,77,84,116,98]],
  ['ระบบปัสสาวะ / ไต',[27,27,30,50,35,34,27,40]],
  ['กล้ามเนื้อ / กระดูก / ข้อ',[16,13,11,17,23,27,33,21]],
  ['ตรวจสุขภาพ / วัคซีน / บริการเชิงป้องกัน',[11,14,20,28,28,25,9,22]],
  ['ไข้ / สงสัยติดเชื้อ',[19,12,19,9,17,17,27,25]],
  ['ตา / หู / คอ (เฉพาะทาง)',[16,5,9,12,7,10,7,11]]
];

/** ดึงข้อมูลจากชีต TopDiagnosis ถ้ามี ไม่มีก็ใช้ DX_DATA */
function DX_source_(){
  try{
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DX_SHEET);
    if (!sh) return DX_DATA;
    var v = sh.getDataRange().getValues();
    if (!v || v.length < 2) return DX_DATA;
    var out = [];
    for (var i = 1; i < v.length; i++){
      var name = String(v[i][0] || '').trim();
      if (!name) continue;
      if (name.indexOf('รวม') === 0) continue;
      var nums = [];
      for (var m = 1; m <= 12; m++){
        var n = Number(v[i][m]);
        nums.push(isNaN(n) ? 0 : n);
      }
      out.push([name, nums]);
    }
    return out.length ? out : DX_DATA;
  }catch(e){
    return DX_DATA;
  }
}

/** เดือนที่มีข้อมูล คืนค่าเป็น index 0 ถึง 11 */
function DX_monthsWithData_(src){
  var keep = [];
  for (var m = 0; m < 12; m++){
    var sum = 0;
    for (var i = 0; i < src.length; i++) sum += (src[i][1][m] || 0);
    if (sum > 0) keep.push(m);
  }
  return keep;
}

/**
 * ฟังก์ชันหลักที่หน้าเว็บเรียกใช้
 * @param {number} monthIndex  0 ถึง 11  ไม่ส่งมาจะใช้เดือนล่าสุดที่มีข้อมูล
 */
function getTopDiagnosis(monthIndex){
  var src = DX_source_();
  var have = DX_monthsWithData_(src);
  if (!have.length){
    return { ok:false, msg:'ยังไม่มีข้อมูลกลุ่มอาการ', months:[] };
  }
  var m = (monthIndex === null || monthIndex === undefined || have.indexOf(Number(monthIndex)) < 0)
        ? have[have.length - 1]
        : Number(monthIndex);

  var list = [];
  var total = 0;
  for (var i = 0; i < src.length; i++){
    var n = src[i][1][m] || 0;
    total += n;
    list.push({ name: src[i][0], n: n, prev: (m > 0 ? (src[i][1][m-1] || 0) : 0) });
  }
  list.sort(function(a,b){ return b.n - a.n; });
  var top = list.slice(0, 5).filter(function(x){ return x.n > 0; });
  var max = top.length ? top[0].n : 1;

  var items = top.map(function(x, idx){
    var diff = null;
    if (m > 0 && x.prev > 0) diff = Math.round((x.n - x.prev) / x.prev * 100);
    return {
      rank: idx + 1,
      name: x.name,
      n: x.n,
      pct: total ? Math.round(x.n / total * 1000) / 10 : 0,
      bar: Math.max(6, Math.round(x.n / max * 100)),
      diff: diff
    };
  });

  var sumTop = 0;
  for (var k = 0; k < items.length; k++) sumTop += items[k].n;

  return {
    ok: true,
    monthIndex: m,
    monthLabel: DX_MONTHS_FULL[m] + ' ' + DX_YEAR,
    total: total,
    topShare: total ? Math.round(sumTop / total * 100) : 0,
    items: items,
    months: have.map(function(i){ return { i: i, label: DX_MONTHS[i] }; })
  };
}

/** ใช้ทดสอบใน Editor กด Run แล้วดูใน Execution log */
function DX_test(){
  Logger.log(JSON.stringify(getTopDiagnosis(), null, 2));
}
