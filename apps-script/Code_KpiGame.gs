/* =====================================================================================
   Code_KpiGame.gs — โมดูลเกม KPI Challenge สำหรับระบบสะสมการเรียนรู้พนักงาน (Med-LMS)
   แผนก OPD1 ศูนย์อายุรกรรม โรงพยาบาลเอกชัย

   วิธีติดตั้ง
   1) ใน Apps Script กด + > Script  แล้วตั้งชื่อไฟล์ว่า  Code_KpiGame  (นามสกุล .gs อัตโนมัติ)
   2) วางโค้ดทั้งไฟล์นี้ลงไป
   3) สร้างชีตใหม่ในสเปรดชีตฐานข้อมูลชื่อ  GameScores  โดยแถวที่ 1 ใส่หัวคอลัมน์ดังนี้
      A Timestamp | B Email | C Name | D Department | E PlayMonth | F KpiMonth |
      G Score | H Correct | I Total | J BestCombo | K LearnHours | L GameId | M Pass
   4) แก้ doGet ในไฟล์ Code.gs เดิม โดยเพิ่มบล็อกของ page === 'kpigame' (ดูใน index_patch.html)
   5) เพิ่มไฟล์ HTML ชื่อ  KpiGame  แล้ววางเนื้อหาจากไฟล์ KpiGame.html

   หมายเหตุสำคัญด้านความถูกต้องของข้อมูล
   - คำถามและเฉลยถูกสร้างและตรวจที่ฝั่งเซิร์ฟเวอร์ทั้งหมด หน้าเว็บไม่เคยได้รับเฉลย
     จึงแก้ไขคะแนนจากฝั่งผู้ใช้ไม่ได้ ใช้เป็นหลักฐานชั่วโมงการเรียนรู้ได้
   - ชั่วโมงการเรียนรู้จากเกมนับได้ครั้งเดียวต่อหนึ่งเดือนข้อมูล KPI ต่อหนึ่งคน
     เล่นซ้ำได้ไม่จำกัดเพื่อทำคะแนนแข่งขัน แต่ชั่วโมงจะไม่ถูกนับซ้ำ
   ===================================================================================== */

/* ================= ค่าที่ปรับได้ ================= */
const SHEET_GAME = 'GameScores';

const GAME_QUESTION_COUNT   = 7;     // จำนวนข้อต่อรอบ
const GAME_SECONDS_PER_Q    = 12;    // เวลาต่อข้อ (วินาที)
const GAME_PASS_RATIO       = 0.7;   // เกณฑ์ผ่าน 70% ของจำนวนข้อ (7 ข้อ = ต้องถูก 5 ข้อขึ้นไป)
const GAME_LEARN_HOURS      = 0.5;   // ชั่วโมงการเรียนรู้ที่ได้เมื่อผ่าน (ต่อ 1 เดือนข้อมูล KPI)
const COURSE_LEARN_HOURS    = 1;     // ชั่วโมงการเรียนรู้ต่อ 1 บทเรียนที่สอบผ่าน
const GAME_LEADERBOARD_SIZE = 5;     // แสดงกี่อันดับแรก
const GAME_POINTS_BY_RANK   = [5, 4, 3, 2, 1]; // แต้มสะสมที่แอดมินมอบให้ 5 อันดับแรกของเดือน

/* ================= ข้อมูล KPI จริง (แก้เดือนใหม่ที่นี่ที่เดียว) =================
   เติมค่าของเดือนใหม่ต่อท้าย array v ของแต่ละตัวชี้วัด และเติมชื่อเดือนใน KPI_MONTHS
   ค่า null = เดือนนั้นยังไม่มีข้อมูล ระบบจะข้ามไม่นำมาออกข้อสอบ
   dir : 'up' = ยิ่งมากยิ่งดี , 'down' = ยิ่งน้อยยิ่งดี
   tg  : เป้าหมายคงที่ , tgm : เป้าหมายรายเดือน (ใช้กับตัวที่เป้าไม่เท่ากันทุกเดือน)
   ============================================================================== */
const KPI_MONTHS = [
  { key: '2569-01', short: 'ม.ค.', full: 'มกราคม 2569' },
  { key: '2569-02', short: 'ก.พ.', full: 'กุมภาพันธ์ 2569' },
  { key: '2569-03', short: 'มี.ค.', full: 'มีนาคม 2569' },
  { key: '2569-04', short: 'เม.ย.', full: 'เมษายน 2569' },
  { key: '2569-05', short: 'พ.ค.', full: 'พฤษภาคม 2569' },
  { key: '2569-06', short: 'มิ.ย.', full: 'มิถุนายน 2569' },
  { key: '2569-07', short: 'ก.ค.', full: 'กรกฎาคม 2569' }
];

const KPI_PERS = [
  { id: 'F', name: 'การเงิน',            desc: 'รายได้ จำนวนคนไข้ และค่าใช้จ่าย' },
  { id: 'C', name: 'ผู้รับบริการ',        desc: 'ความพึงพอใจและข้อร้องเรียน' },
  { id: 'I', name: 'กระบวนการ',          desc: 'เวลารอคอยและความปลอดภัย' },
  { id: 'L', name: 'เรียนรู้และพัฒนา',   desc: 'อบรม ประชุม และการพัฒนาคน' }
];

const KPI_DATA = [
  { p:'F', code:'F1K1', name:'รายได้ศูนย์อายุรกรรม โตขึ้นเท่าไร', unit:'%', dir:'up', tg:13, tgt:'≥ 13%',
    v:[-11.67,-21.41,-2.68,-10.25,-19.5,-3.41,12.16],
    mean:'เทียบกับปีที่แล้วเดือนเดียวกัน ติดลบคือรายได้หดลง เดือน ก.ค. เพิ่งกลับมาเป็นบวกครั้งแรกของปี',
    tip:'รายได้มาจากจำนวนคนไข้ที่เดินเข้ามาและกลับมาอีก งานหน้าเคาน์เตอร์อย่างการนัดครั้งถัดไปให้ชัดเจนมีผลโดยตรง' },

  { p:'F', code:'F1K2', name:'รายได้ศูนย์จิตเวช โตขึ้นเท่าไร', unit:'%', dir:'up', tg:11, tgt:'≥ 11%',
    v:[-37.97,-25.37,-6.83,0.07,38.85,66.47,9.78],
    mean:'ครึ่งปีแรกฟื้นตัวชัดเจน จากติดลบ 38% ขึ้นมาเป็นบวกได้ตั้งแต่เดือน พ.ค.',
    tip:'คนไข้จิตเวชต้องมาต่อเนื่องถึงจะดีขึ้น การโทรตามนัดที่ขาดหายช่วยทั้งคนไข้และตัวเลขนี้' },

  { p:'F', code:'F1K3', name:'จำนวนผู้ป่วยอายุรกรรมต่อเดือน', unit:'คน', dir:'up',
    tgm:[2491,2360,2294,2294,2622,2622,2622], tgt:'เป้าปี 30,156 คน',
    v:[2086,1739,1832,1780,2011,2077,2360],
    mean:'เป้ารายเดือนไม่เท่ากันเพราะวันทำการต่างกัน เดือน ก.ค. ทำได้สูงสุดของปี',
    tip:'ทุกคนไข้ที่ประทับใจแล้วบอกต่อ คือตัวเลขในช่องนี้ของเดือนหน้า' },

  { p:'F', code:'F1K4', name:'จำนวนผู้ป่วยจิตเวชต่อเดือน', unit:'คน', dir:'up',
    tgm:[34,32,31,31,36,36,36], tgt:'เป้าปี 411 คน',
    v:[38,32,28,32,38,39,32],
    mean:'เดือนที่ผ่านเป้าคือเดือนที่คนไข้เก่ามาตามนัดครบ ไม่ใช่เดือนที่มีคนไข้ใหม่เยอะ',
    tip:'เช็กรายชื่อคนไข้ที่ไม่มาตามนัดทุกสัปดาห์ แล้วโทรตาม 5 รายแรกก่อน' },

  { p:'F', code:'F2K5', name:'สัดส่วนค่าล่วงเวลา (OT)', unit:'%', dir:'down', tg:20, tgt:'≤ 20%',
    v:[27.81,27.42,24.1,22.3,30.48,28.05,25.94],
    mean:'OT เกินเป้า 20% ทุกเดือน แปลว่างานล้นเวลาปกติอยู่ประจำ ไม่ใช่แค่บางวัน',
    tip:'จดไว้ว่าช่วงไหนของวันที่งานกองจนต้องอยู่ต่อ แล้วเอาเข้าที่ประชุมแผนก การจัดเวรใหม่ช่วยได้มากกว่าการเร่งมือ' },

  { p:'F', code:'F2K6', name:'ค่าใช้จ่ายรวมเทียบกับรายได้', unit:'%', dir:'down', tg:15, tgt:'≤ 15%',
    v:[7.17,8.96,7.37,8.14,7.3,7.59,null],
    mean:'อยู่ที่ราว 7-9% ตลอดปี ห่างจากเพดาน 15% พอสมควร ถือเป็นตัวที่แผนกคุมได้ดี',
    tip:'รักษาไว้แบบนี้ ของที่เบิกมาแล้วใช้ไม่หมด ส่งคืนคลังแทนการเก็บไว้ในลิ้นชัก' },

  { p:'F', code:'F2K7', name:'ค่าเครื่องเขียนต่อผู้ป่วย 1 คน', unit:'บาท', dir:'down', tg:8, tgt:'≤ 8 บาท',
    v:[4.41,2.75,2.47,4.1,2.67,3.5,null],
    mean:'ผู้ป่วยหนึ่งคนใช้เครื่องเขียนไม่ถึงเพดาน 8 บาททุกเดือน',
    tip:'พิมพ์เอกสารสองหน้า และเช็กก่อนพิมพ์ว่าจำเป็นต้องมีฉบับกระดาษจริงไหม' },

  { p:'F', code:'F3K8', name:'เครื่องมือแพทย์ที่สอบเทียบตามแผน', unit:'%', dir:'up', tg:90, tgt:'≥ 90%',
    v:[null,100,null,null,null,null,null],
    mean:'เดือนที่มีแผนสอบเทียบ ทำได้ครบ 100% เดือนอื่นยังไม่ถึงรอบตามทะเบียนเครื่องมือแพทย์',
    tip:'ถ้าเจอเครื่องมือที่สติกเกอร์สอบเทียบหมดอายุ แจ้ง MTD ทันที อย่ารอรอบถัดไป' },

  { p:'C', code:'C1K1', name:'ความพึงพอใจของผู้รับบริการ', unit:'เต็ม 5', dir:'up', tg:4.7, tgt:'≥ 4.7',
    v:[4.73,4.7,4.61,4.79,4.76,4.81,4.71],
    mean:'คนไข้ให้คะแนนเราผ่านเป้าเกือบทุกเดือน เป็นตัวที่แผนกทำได้ดีที่สุดตัวหนึ่ง',
    tip:'สิ่งที่ทำให้คะแนนขยับคือคำอธิบายก่อนทำหัตถการ และการเรียกคนไข้ด้วยชื่อ ไม่ใช่หมายเลขคิว' },

  { p:'C', code:'C1K2', name:'ความพึงพอใจของหน่วยงานภายใน', unit:'เต็ม 5', dir:'up', tg:4.6, tgt:'≥ 4.6',
    v:[3.79,3.86,3.75,3.79,3.67,3.74,3.84],
    mean:'หน่วยงานอื่นให้คะแนนเราต่ำกว่าเป้า 4.6 ทุกเดือน เป็นตัวที่ห่างเป้ามากที่สุดในกลุ่มนี้',
    tip:'ส่วนใหญ่มาจากการประสานงานข้ามแผนก รับสายแล้วบอกชื่อตัวเองทุกครั้ง และตอบกลับเรื่องที่ค้างภายในวันเดียวกัน' },

  { p:'C', code:'C1K3', name:'ข้อร้องเรียนเรื่องพฤติกรรมบริการ', unit:'ครั้ง', dir:'down', tg:0, tgt:'0 ครั้ง',
    v:[1,0,0,0,1,0,1],
    mean:'เป้าคือศูนย์ ปีนี้เกิดแล้ว 3 ครั้ง เฉลี่ยประมาณ 2 เดือนครั้ง',
    tip:'ตอนงานยุ่งที่สุดคือตอนที่น้ำเสียงเปลี่ยนโดยไม่รู้ตัว ถ้ารู้สึกว่าตัวเองเริ่มหงุดหงิด สลับให้เพื่อนรับเคสแทนสักครู่' },

  { p:'I', code:'I1K1', name:'ข้อร้องเรียนเรื่องรอตรวจนาน', unit:'ครั้ง', dir:'down', tg:0, tgt:'0 ครั้ง',
    v:[2,1,0,0,1,0,1],
    mean:'เป้าคือศูนย์ ปีนี้มีแล้ว 5 ครั้ง ทุกครั้งเกิดในวันที่คนไข้แน่นกว่าปกติ',
    tip:'บอกเวลารอโดยประมาณตั้งแต่ตอนรับบัตร คนไข้ที่รู้ล่วงหน้าว่าต้องรอ 40 นาที ร้องเรียนน้อยกว่าคนที่ไม่รู้อะไรเลย' },

  { p:'I', code:'I1K2', name:'เวลาจากพยาบาลถึงห้องตรวจ', unit:'นาที', dir:'down', tg:15, tgt:'≤ 15 นาที',
    v:[13,14,15,15,16,16,16],
    mean:'เกินเป้า 15 นาที และค่อย ๆ ยาวขึ้นทุกเดือนตั้งแต่ต้นปี',
    tip:'ซักประวัติและวัดสัญญาณชีพให้จบในรอบเดียว แล้วส่งเข้าห้องตรวจทันที อย่าพักแฟ้มไว้รอรวมทีละหลายราย' },

  { p:'I', code:'I1K3', name:'เวลารอรวม ตั้งแต่พยาบาลจนรับยา', unit:'นาที', dir:'down', tg:90, tgt:'≤ 90 นาที',
    v:[56,57,62,61,65,74,68],
    mean:'ยังต่ำกว่าเพดาน 90 นาที แต่ยาวขึ้นจากต้นปีเกือบ 12 นาที',
    tip:'ส่งใบสั่งยาให้ห้องยาทันทีที่แพทย์สั่ง อย่ารอให้คนไข้ถือไปเอง จะช่วยตัดเวลารอช่วงท้ายได้มากที่สุด' },

  { p:'I', code:'I1K4', name:'ข้อร้องเรียนเรื่องรอห้องนอน (Admit)', unit:'ครั้ง', dir:'down', tg:0, tgt:'0 ครั้ง',
    v:[0,0,0,0,0,0,0],
    mean:'ศูนย์ครั้งตลอดทั้งปี รักษามาตรฐานนี้ไว้ได้ดีมาก',
    tip:'เมื่อรู้ว่าต้อง Admit ให้ประสานหอผู้ป่วยทันทีในนาทีนั้น ไม่รอให้แฟ้มเดินไปถึงก่อน' },

  { p:'I', code:'I2K5', name:'เหตุการณ์ไม่พึงประสงค์ระดับ C ขึ้นไป', unit:'ครั้ง', dir:'down', tg:0, tgt:'0 ครั้ง',
    v:[0,0,0,0,0,0,0],
    mean:'ยังไม่เกิดเลยตลอดปี ระดับ C คือเหตุที่ถึงตัวผู้ป่วยแล้วแต่ยังไม่เกิดอันตราย เป็นตัวชี้วัดความปลอดภัยหลักของแผนก',
    tip:'ที่ทำให้เลขนี้เป็นศูนย์ได้คือการทวนชื่อ-สกุลและวันเกิดก่อนทำทุกอย่าง ทำต่อไปแบบนี้' },

  { p:'I', code:'I2K6', name:'ผู้ป่วยเบาหวานกลับมาด้วยภาวะแทรกซ้อน', unit:'ครั้ง', dir:'down', tg:0, tgt:'0 ครั้ง',
    v:[0,0,0,0,0,0,0],
    mean:'ศูนย์ตลอดปี แปลว่าคนไข้เบาหวานของเราคุมโรคได้และเข้าใจวิธีดูแลตัวเอง',
    tip:'ก่อนคนไข้กลับ ให้เขาทวนให้ฟังว่าจะกินยาอย่างไร แทนที่จะถามว่าเข้าใจไหม' },

  { p:'I', code:'I2K7', name:'ผู้ป่วยความดันกลับมารักษาซ้ำใน 28 วัน', unit:'ครั้ง', dir:'down', tg:0, tgt:'0 ครั้ง',
    v:[0,0,0,0,0,0,0],
    mean:'ศูนย์ตลอดปีเช่นกัน คนไข้ที่กลับมาเร็วมักเป็นคนที่ไม่ได้กินยาต่อเนื่อง',
    tip:'ย้ำวันนัดครั้งหน้าและเขียนใส่ซองยาให้เห็นชัด คนไข้สูงอายุจำจากปากเปล่าได้ไม่ครบ' },

  { p:'I', code:'I2K8', name:'จำนวนรายงานอุบัติการณ์ของแผนก', unit:'ครั้ง', dir:'up', tg:3, tgt:'≥ 3 ครั้ง',
    v:[3,3,8,5,2,10,12],
    mean:'ตัวนี้ยิ่งมากยิ่งดี เพราะเรื่องที่ถูกรายงานคือเรื่องที่ได้แก้ก่อนจะไปถึงคนไข้จริง',
    tip:'เกือบพลาดก็รายงาน เขียนสั้น ๆ สามบรรทัดพอ เกิดอะไร ตอนไหน แล้วแก้อย่างไร' },

  { p:'L', code:'L1K1', name:'อบรมเฉพาะทางในแผนก (OJT)', unit:'เรื่อง', dir:'up', tg:1, tgt:'1 เรื่อง/คน/เดือน',
    v:[0,2,0,0,1,0,0],
    mean:'เป้าคือเดือนละ 1 เรื่อง แต่ปีนี้มีแค่ 2 เดือนที่ทำได้ ส่วนใหญ่เป็นศูนย์',
    tip:'OJT ไม่ต้องจัดห้องอบรม สอนกันหน้างาน 15 นาทีตอนส่งเวรแล้วบันทึกไว้ ก็นับเป็นหนึ่งเรื่อง' },

  { p:'I', code:'I2K9', name:'โครงการพัฒนาคุณภาพ (CQI) ที่สำเร็จ', unit:'เรื่อง', dir:'up', tg:1, tgt:'1 เรื่องต่อปี',
    v:[null,null,null,null,null,null,null],
    note:['ยังไม่มีประชุม','ยังไม่มีประชุม','ยังไม่มีประชุม','ส่งแบบขออนุมัติแล้ว','ยังไม่ได้ทำตามแผน','ยังไม่ได้ทำตามแผน','ยังไม่ได้ทำตามแผน'],
    mean:'ทั้งปีต้องมี 1 เรื่อง ตอนนี้ส่งแบบขออนุมัติไปแล้วตั้งแต่เดือน เม.ย. แต่ยังไม่ได้เดินตามแผน',
    tip:'CQI ไม่ต้องเป็นเรื่องใหญ่ เอาปัญหาที่บ่นกันบ่อยที่สุดในแผนกมาหนึ่งเรื่องก็เริ่มได้แล้ว' },

  { p:'L', code:'L1K2', name:'เข้าอบรมตามแผนฝ่ายการพยาบาล', unit:'ครั้ง', dir:'up', tg:1, tgt:'1 ครั้งต่อเดือน',
    v:[1,null,2,null,1,1,1],
    note:[null,'เดือนนี้ไม่มีอบรม',null,'เดือนนี้ไม่มีอบรม',null,null,null],
    mean:'เดือนไหนที่ฝ่ายจัดอบรม แผนกเข้าครบทุกครั้ง เดือนที่ว่างคือเดือนที่ไม่มีอบรมจัดขึ้น',
    tip:'เมื่อได้รับหมายกำหนดการอบรม ลงตารางเวรล่วงหน้าเลย จะได้ไม่ชนกับวันที่คนไข้แน่น' },

  { p:'L', code:'L2K4', name:'การปฐมนิเทศพนักงานใหม่โดยหัวหน้าแผนก', unit:'%', dir:'up', tg:100, tgt:'100%',
    v:[null,null,null,null,null,100,100],
    note:['ไม่มีพนักงานใหม่','ไม่มีพนักงานใหม่','ไม่มีพนักงานใหม่','ไม่มีพนักงานใหม่','ไม่มีพนักงานใหม่',null,null],
    mean:'เดือนที่มีพนักงานใหม่เข้ามา ได้รับการปฐมนิเทศครบ 100% ทุกคน',
    tip:'วันแรกของน้องใหม่ พาเดินดูจุดสำคัญให้ครบ ทั้งจุดวางรถฉุกเฉิน ถังดับเพลิง และทางหนีไฟ' },

  { p:'L', code:'L1K3', name:'อบรมภาคบังคับ (Mandatory Training)', unit:'%', dir:'up', tg:80, tgt:'≥ 80%',
    v:[0,14.29,7.14,7.14,6.67,11.11,null],
    mean:'ทำได้ห่างจากเป้า 80% มาก เป็นตัวชี้วัดที่ห่างเป้ามากที่สุดของทั้งแผนกในปีนี้',
    tip:'หลักสูตรภาคบังคับส่วนใหญ่เรียนออนไลน์ได้ ทยอยเก็บสัปดาห์ละหนึ่งบทตอนพักเที่ยง ดีกว่ารอไปเร่งปลายปี' },

  { p:'L', code:'L2K5', name:'การประชุมแผนก', unit:'ครั้ง', dir:'up', tg:1, tgt:'1 ครั้งต่อเดือน',
    v:[1,0,1,1,1,1,1],
    mean:'ประชุมครบเกือบทุกเดือน ขาดเพียงเดือน ก.พ. เดือนเดียว',
    tip:'เอาเรื่องที่อยากให้แก้ไปพูดในที่ประชุม เรื่องที่ไม่ถูกพูดถึงคือเรื่องที่ไม่มีวันถูกแก้' }
];

/* ================= ตัวช่วยภายใน ================= */

function KG_sheet_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_GAME);
  if (!sh) throw new Error('ไม่พบชีต "' + SHEET_GAME + '" กรุณาสร้างชีตนี้ก่อน (ดูหัวข้อวิธีติดตั้งในไฟล์ Code_KpiGame.gs)');
  return sh;
}

function KG_tz_() { return Session.getScriptTimeZone() || 'Asia/Bangkok'; }

function KG_monthIndex_(kpiMonthKey) {
  for (var i = 0; i < KPI_MONTHS.length; i++) if (KPI_MONTHS[i].key === kpiMonthKey) return i;
  return -1;
}

function KG_target_(k, m) { return k.tgm ? k.tgm[m] : k.tg; }

function KG_fmt_(n) {
  if (n === null || n === undefined) return '-';
  var d = (Math.abs(n) >= 100 || Number(n) === Math.round(n)) ? 0 : 2;
  return Number(n).toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function KG_pass_(k, m) {
  var v = k.v[m];
  if (v === null || v === undefined) return null;
  var t = KG_target_(k, m);
  return (k.dir === 'up') ? (v >= t) : (v <= t);
}

function KG_shuffle_(arr) {
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

/* ================= 1) ส่งข้อมูลตั้งต้นให้หน้าเกม ================= */

function getKpiGameInit() {
  var user = requireLogin_();
  var months = KPI_MONTHS.map(function (m, i) {
    var live = KPI_DATA.filter(function (k) { return k.v[i] !== null && k.v[i] !== undefined; }).length;
    return { key: m.key, short: m.short, full: m.full, kpiCount: live };
  });
  var latest = KPI_MONTHS[KPI_MONTHS.length - 1].key;
  return {
    user: { name: user.name, dept: user.dept },
    months: months,
    defaultMonth: latest,
    secondsPerQuestion: GAME_SECONDS_PER_Q,
    questionCount: GAME_QUESTION_COUNT,
    passRatio: GAME_PASS_RATIO,
    learnHours: GAME_LEARN_HOURS,
    leaderboardSize: GAME_LEADERBOARD_SIZE
  };
}

/* ================= 1.5) กระดานสรุป KPI ของเดือนที่เลือก =================
   ส่งข้อมูลตัวชี้วัดทั้งหมดให้หน้าเว็บวาดการ์ดสรุป เหมือนหน้าตัวอย่าง
   ======================================================================= */

function getKpiBoard(kpiMonthKey) {
  requireLogin_();
  var m = KG_monthIndex_(kpiMonthKey);
  if (m < 0) throw new Error('ไม่พบเดือนข้อมูลที่เลือก');

  var perCount = {}, perData = {}, perAll = {};
  KPI_PERS.forEach(function (p) { perCount[p.id] = 0; perData[p.id] = 0; perAll[p.id] = 0; });

  var pass = 0, withData = 0;
  var list = KPI_DATA.map(function (k) {
    var v = k.v[m];
    var na = (v === null || v === undefined);
    var st = na ? 'na' : (KG_pass_(k, m) ? 'good' : (KG_near_(k, m) ? 'warn' : 'bad'));
    perAll[k.p]++;                       // นับตัวชี้วัดทั้งหมดของมุมมองนี้ ไม่ว่าจะมีข้อมูลหรือไม่
    if (!na) {
      withData++; perData[k.p]++;
      if (st === 'good') { pass++; perCount[k.p]++; }
    }
    var t = KG_target_(k, m);
    var gap = na ? 0 : (k.dir === 'up' ? Math.max(0, t - v) : Math.max(0, v - t));
    var meanTxt = String(k.mean || '')
      .replace('{v}', KG_fmt_(v))
      .replace('{gap}', KG_fmt_(gap))
      .replace('{miss}', na ? '-' : KG_fmt_(Math.round((100 - v) * 10)));

    // ชุดข้อมูลสำหรับวาดเส้นแนวโน้ม ตั้งแต่เดือนแรกถึงเดือนที่เลือก
    var series = [];
    for (var i = 0; i <= m; i++) {
      series.push({ m: KPI_MONTHS[i].short, v: (k.v[i] === null || k.v[i] === undefined) ? null : Number(k.v[i]) });
    }

    return {
      p: k.p, code: k.code, name: k.name, unit: k.unit, dir: k.dir,
      na: na,
      naText: na ? ((k.note && k.note[m]) ? k.note[m] : 'ยังไม่เก็บข้อมูลเดือนนี้') : '',
      value: na ? '' : KG_fmt_(v),
      raw: na ? null : Number(v),
      target: Number(t),
      targetText: k.tgm ? (KG_fmt_(t) + ' ' + k.unit) : k.tgt,
      status: st,
      meterPct: KG_meter_(k, m),
      mean: meanTxt,
      tip: k.tip || '',
      series: series
    };
  });

  return {
    monthKey: kpiMonthKey,
    monthFull: KPI_MONTHS[m].full,
    pass: pass,                                   // ผ่านเป้ากี่ตัว
    withData: withData,                           // เดือนนี้มีข้อมูลกี่ตัว
    totalAll: KPI_DATA.length,                    // ตัวชี้วัดทั้งหมดของแผนก (คงที่ทุกเดือน)
    noData: KPI_DATA.length - withData,           // ยังไม่ลงข้อมูลกี่ตัว
    pct: withData ? Math.round(pass / withData * 100) : 0,
    pers: KPI_PERS.map(function (p) {
      return {
        id: p.id, name: p.name, desc: p.desc,
        pass: perCount[p.id],
        withData: perData[p.id],
        total: perAll[p.id],
        noData: perAll[p.id] - perData[p.id]
      };
    }),
    kpis: list
  };
}

/** ใกล้เป้าหรือยัง (ใช้แยกสถานะ เฉียดเป้า ออกจาก ยังไม่ถึงเป้า) */
function KG_near_(k, m) {
  var v = k.v[m], t = KG_target_(k, m);
  if (v === null || v === undefined) return false;
  if (k.dir === 'up') return (t !== 0 && v / t >= 0.9);
  if (t === 0) return false;
  return (v / t <= 1.1);
}

/** สัดส่วนความคืบหน้าเทียบเป้า สำหรับวาดแถบ 0-100 */
function KG_meter_(k, m) {
  var v = k.v[m];
  if (v === null || v === undefined) return 0;
  var t = KG_target_(k, m), p;
  if (k.dir === 'up') { p = (t === 0) ? 100 : (v / t) * 100; }
  else { p = (t === 0) ? (v === 0 ? 100 : Math.max(12, 100 - v * 22)) : (t / v) * 100; }
  return Math.max(4, Math.min(100, Math.round(p)));
}

/* ================= 2) เริ่มเกม เซิร์ฟเวอร์สร้างคำถามและเก็บเฉลยไว้เอง ================= */

function startKpiGame(kpiMonthKey) {
  var user = requireLogin_();
  var m = KG_monthIndex_(kpiMonthKey);
  if (m < 0) throw new Error('ไม่พบเดือนข้อมูลที่เลือก');

  var monthFull = KPI_MONTHS[m].full;
  var pool = [];

  KPI_DATA.forEach(function (k) {
    var v = k.v[m];
    if (v === null || v === undefined) return;
    var t = KG_target_(k, m);
    var tgtText = k.tgm ? (KG_fmt_(t) + ' ' + k.unit) : k.tgt;
    var passed = KG_pass_(k, m);

    // แบบที่ 1 ผ่านเป้าหรือยัง
    pool.push({
      code: k.code, type: 'pass',
      q: 'เดือน' + monthFull + ' ตัวชี้วัด “' + k.name + '” ผ่านเป้าหรือยัง',
      sub: 'เป้าหมาย ' + tgtText,
      o: ['ผ่านเป้าแล้ว', 'ยังไม่ถึงเป้า'],
      a: passed ? 0 : 1,
      e: 'ค่าจริงคือ ' + KG_fmt_(v) + ' ' + k.unit + ' เทียบกับเป้า ' + tgtText + ' · ' + k.mean
    });

    // แบบที่ 2 ยิ่งมากยิ่งดีหรือยิ่งน้อยยิ่งดี
    pool.push({
      code: k.code, type: 'dir',
      q: 'ตัวชี้วัด “' + k.name + '” ยิ่งมากยิ่งดี หรือยิ่งน้อยยิ่งดี',
      sub: 'คิดจากความหมายของตัวชี้วัด ไม่ใช่จากตัวเลข',
      o: ['ยิ่งมากยิ่งดี', 'ยิ่งน้อยยิ่งดี'],
      a: (k.dir === 'up') ? 0 : 1,
      e: (k.dir === 'up' ? 'ยิ่งมากยิ่งดี ' : 'ยิ่งน้อยยิ่งดี ') + 'เป้าคือ ' + k.tgt + ' · ' + k.tip
    });

    // แบบที่ 3 ทายค่าจริง (เฉพาะตัวที่ตัวเลขพอจะสร้างตัวลวงได้)
    if (Math.abs(v) > 1) {
      var d1 = Math.round(v * (v > 0 ? 1.45 : 0.55) * 100) / 100;
      var d2 = Math.round(v * (v > 0 ? 0.62 : 1.5) * 100) / 100;
      var opts = KG_shuffle_([{ t: KG_fmt_(v), ok: true }, { t: KG_fmt_(d1), ok: false }, { t: KG_fmt_(d2), ok: false }]);
      var ansIdx = 0;
      for (var i = 0; i < opts.length; i++) if (opts[i].ok) ansIdx = i;
      pool.push({
        code: k.code, type: 'val',
        q: 'เดือน' + monthFull + ' “' + k.name + '” ทำได้เท่าไร',
        sub: 'หน่วย ' + k.unit + ' · เป้า ' + tgtText,
        o: opts.map(function (o) { return o.t + ' ' + k.unit; }),
        a: ansIdx,
        e: 'คำตอบคือ ' + KG_fmt_(v) + ' ' + k.unit + ' · ' + k.mean
      });
    }
  });

  // คละให้ตัวชี้วัดไม่ซ้ำกันก่อน แล้วค่อยเติมให้ครบจำนวนข้อ
  KG_shuffle_(pool);
  var seen = {}, picked = [];
  pool.forEach(function (q) { if (!seen[q.code]) { seen[q.code] = 1; picked.push(q); } });
  pool.forEach(function (q) { if (picked.indexOf(q) < 0) picked.push(q); });
  picked = picked.slice(0, GAME_QUESTION_COUNT);

  if (picked.length < GAME_QUESTION_COUNT) {
    throw new Error('เดือนนี้ยังมีข้อมูล KPI ไม่พอสำหรับออกข้อสอบ กรุณาเลือกเดือนอื่น');
  }

  var gameId = Utilities.getUuid();
  var blank = [];
  for (var z = 0; z < picked.length; z++) blank.push(-2); // -2 = ยังไม่ได้ตอบ
  var secret = {
    email: user.email,
    kpiMonth: kpiMonthKey,
    startAt: new Date().getTime(),
    answers: picked.map(function (q) { return q.a; }),
    explains: picked.map(function (q) { return q.e; }),
    options: picked.map(function (q) { return q.o; }),
    codes: picked.map(function (q) { return q.code; }),
    picks: blank
  };
  CacheService.getUserCache().put('kpigame_' + gameId, JSON.stringify(secret), 1800); // เก็บ 30 นาที

  return {
    gameId: gameId,
    kpiMonth: kpiMonthKey,
    monthFull: monthFull,
    secondsPerQuestion: GAME_SECONDS_PER_Q,
    questions: picked.map(function (q, i) {
      return { no: i + 1, q: q.q, sub: q.sub, o: q.o }; // ไม่ส่งเฉลยออกไป
    })
  };
}

/* ================= 3) ตอบทีละข้อ เซิร์ฟเวอร์เฉลยกลับทันที =================
   หน้าเว็บจะไม่ได้รับเฉลยล่วงหน้า จะได้เฉลยก็ต่อเมื่อ "ล็อกคำตอบไปแล้ว" เท่านั้น
   จึงเฉลยทีละข้อระหว่างเล่นได้ โดยยังแก้คะแนนจากฝั่งผู้ใช้ไม่ได้
   ============================================================================ */

function answerKpiQuestion(gameId, qIndex, pick) {
  var user = requireLogin_();
  var key = 'kpigame_' + gameId;
  var raw = CacheService.getUserCache().get(key);
  if (!raw) throw new Error('รอบเกมนี้หมดอายุแล้ว (เกิน 30 นาที) กรุณาเริ่มเล่นใหม่');

  var secret = JSON.parse(raw);
  if (String(secret.email).toLowerCase() !== String(user.email).toLowerCase()) {
    throw new Error('รอบเกมนี้ไม่ใช่ของบัญชีที่กำลังใช้งาน');
  }
  qIndex = Number(qIndex);
  if (isNaN(qIndex) || qIndex < 0 || qIndex >= secret.answers.length) {
    throw new Error('หมายเลขข้อไม่ถูกต้อง');
  }
  if (secret.picks[qIndex] !== -2) {
    throw new Error('ข้อนี้ตอบไปแล้ว ไม่สามารถตอบซ้ำได้');
  }

  pick = (pick === undefined || pick === null) ? -1 : Number(pick);
  secret.picks[qIndex] = pick;
  CacheService.getUserCache().put(key, JSON.stringify(secret), 1800);

  // คำนวณคะแนนสะสมและคอมโบใหม่จากคำตอบที่บันทึกไว้จริงทั้งหมด
  var score = 0, combo = 0, best = 0, right = 0;
  for (var i = 0; i < secret.answers.length; i++) {
    var p = secret.picks[i];
    if (p === -2) break;
    if (p === secret.answers[i]) {
      right++; combo++;
      if (combo > best) best = combo;
      score += 10 + (combo > 1 ? (combo - 1) * 5 : 0);
    } else {
      combo = 0;
    }
  }

  var ok = (pick === secret.answers[qIndex]);
  return {
    correct: ok,
    correctIndex: secret.answers[qIndex],
    correctText: secret.options[qIndex][secret.answers[qIndex]],
    explain: secret.explains[qIndex],
    score: score,
    combo: combo,
    bestCombo: best,
    rightSoFar: right,
    isLast: (qIndex === secret.answers.length - 1)
  };
}

/* ================= 4) จบเกม เซิร์ฟเวอร์สรุปและบันทึก ================= */

function submitKpiGame(gameId, answers) {
  var user = requireLogin_();
  var raw = CacheService.getUserCache().get('kpigame_' + gameId);
  if (!raw) throw new Error('รอบเกมนี้หมดอายุแล้ว (เกิน 30 นาที) กรุณาเริ่มเล่นใหม่');

  var secret = JSON.parse(raw);
  if (String(secret.email).toLowerCase() !== String(user.email).toLowerCase()) {
    throw new Error('รอบเกมนี้ไม่ใช่ของบัญชีที่กำลังใช้งาน');
  }
  CacheService.getUserCache().remove('kpigame_' + gameId); // ป้องกันส่งซ้ำรอบเดียวกัน

  // ใช้คำตอบที่เซิร์ฟเวอร์บันทึกไว้ตอนตอบทีละข้อเป็นหลักเสมอ
  if (secret.picks && secret.picks.length) {
    answers = secret.picks.map(function (p) { return (p === -2) ? -1 : p; });
  } else {
    answers = answers || [];
  }
  var total = secret.answers.length;
  var correct = 0, combo = 0, best = 0, score = 0;
  var review = [];

  for (var i = 0; i < total; i++) {
    var pick = (answers[i] === undefined || answers[i] === null) ? -1 : Number(answers[i]);
    var ok = (pick === secret.answers[i]);
    if (ok) {
      correct++; combo++;
      if (combo > best) best = combo;
      score += 10 + (combo > 1 ? (combo - 1) * 5 : 0);
    } else {
      combo = 0;
    }
    review.push({
      no: i + 1,
      chosen: (pick < 0) ? '(หมดเวลา / ไม่ได้ตอบ)' : secret.options[i][pick],
      answer: secret.options[i][secret.answers[i]],
      correct: ok,
      explain: secret.explains[i]
    });
  }

  var pass = (correct / total) >= GAME_PASS_RATIO;
  var now = new Date();
  var playMonth = Utilities.formatDate(now, KG_tz_(), 'yyyy-MM');

  // ชั่วโมงการเรียนรู้ นับครั้งเดียวต่อ 1 เดือนข้อมูล KPI ต่อ 1 คน
  var learnHours = 0;
  if (pass) {
    var already = false;
    var data = KG_sheet_().getDataRange().getValues();
    for (var r = 1; r < data.length; r++) {
      if (String(data[r][1]).toLowerCase() === String(user.email).toLowerCase() &&
          String(data[r][5]) === secret.kpiMonth &&
          Number(data[r][10]) > 0) { already = true; break; }
    }
    if (!already) learnHours = GAME_LEARN_HOURS;
  }

  KG_sheet_().appendRow([
    now, user.email, user.name, user.dept,
    playMonth, secret.kpiMonth,
    score, correct, total, best, learnHours, gameId, pass
  ]);

  var stars = (score >= 90) ? 3 : (score >= 55 ? 2 : (score >= 25 ? 1 : 0));
  var monthIdx = KG_monthIndex_(secret.kpiMonth);

  return {
    gameId: gameId,
    score: score, correct: correct, total: total, bestCombo: best,
    pass: pass, stars: stars,
    passNeed: Math.ceil(total * GAME_PASS_RATIO),
    learnHoursAwarded: learnHours,
    kpiMonthFull: monthIdx >= 0 ? KPI_MONTHS[monthIdx].full : secret.kpiMonth,
    needSignature: pass,
    review: review
  };
}

/* ================= 5) ลายเซ็นยืนยันการเรียนรู้จากเกม ================= */

function saveGameSignature(gameId, signatureDataUrl) {
  var user = requireLogin_();
  if (!signatureDataUrl || String(signatureDataUrl).indexOf('data:image') !== 0) {
    throw new Error('ข้อมูลลายเซ็นไม่ถูกต้อง กรุณาลองเซ็นใหม่อีกครั้ง');
  }

  var sh = KG_sheet_();
  var data = sh.getDataRange().getValues();
  var row = null;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][11]) === gameId) { row = data[i]; break; }
  }
  if (!row) throw new Error('ไม่พบผลการเล่นเกมรอบนี้');
  if (String(row[1]).toLowerCase() !== String(user.email).toLowerCase()) {
    throw new Error('คุณไม่มีสิทธิ์ลงชื่อสำหรับผลการเล่นรอบนี้');
  }
  if (row[12] !== true && String(row[12]).toUpperCase() !== 'TRUE') {
    throw new Error('รอบนี้ยังไม่ผ่านเกณฑ์ จึงยังลงชื่อยืนยันไม่ได้');
  }

  // เขียนลงชีต Signatures เดิม เพื่อให้ระบบสร้างแบบฟอร์ม OJT ดึงไปใช้ได้เหมือนบทเรียนปกติ
  var mi = KG_monthIndex_(String(row[5]));
  var courseId = 'GAME_' + String(row[5]);
  var courseTitle = 'เกม KPI Challenge ประจำเดือน' + (mi >= 0 ? KPI_MONTHS[mi].full : String(row[5]));

  SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SIGNATURES)
    .appendRow([new Date(), user.email, user.name, user.dept, courseId, courseTitle, gameId, signatureDataUrl]);

  return { ok: true, courseTitle: courseTitle };
}

/* ================= 6) ตารางอันดับ 5 อันดับแรกของแต่ละเดือน ================= */

function getGameLeaderboard(playMonth) {
  var user = requireLogin_();
  if (!playMonth) playMonth = Utilities.formatDate(new Date(), KG_tz_(), 'yyyy-MM');

  var data = KG_sheet_().getDataRange().getValues();
  var bestBy = {}; // email -> { name, dept, score, plays, when }

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][4]) !== playMonth) continue;
    var email = String(data[i][1]).toLowerCase();
    if (!email) continue;
    var sc = Number(data[i][6]) || 0;
    if (!bestBy[email]) {
      bestBy[email] = { email: email, name: data[i][2], dept: data[i][3], score: sc, plays: 1, when: data[i][0] };
    } else {
      bestBy[email].plays++;
      if (sc > bestBy[email].score) { bestBy[email].score = sc; bestBy[email].when = data[i][0]; }
    }
  }

  var list = Object.keys(bestBy).map(function (k) { return bestBy[k]; });
  // คะแนนสูงกว่าอยู่บน ถ้าคะแนนเท่ากันคนที่ทำได้ก่อนอยู่บน
  list.sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return new Date(a.when).getTime() - new Date(b.when).getTime();
  });
  list.forEach(function (x, i) { x.rank = i + 1; });

  var meLower = String(user.email).toLowerCase();
  var me = null;
  list.forEach(function (x) { if (x.email === meLower) me = { rank: x.rank, score: x.score, plays: x.plays }; });

  return {
    playMonth: playMonth,
    monthLabel: KG_monthLabel_(playMonth),
    totalPlayers: list.length,
    top: list.slice(0, GAME_LEADERBOARD_SIZE).map(function (x) {
      return { rank: x.rank, name: x.name, dept: x.dept, score: x.score, plays: x.plays, isMe: (x.email === meLower) };
    }),
    me: me
  };
}

function KG_monthLabel_(playMonth) {
  var TH = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  var p = String(playMonth).split('-');
  if (p.length !== 2) return playMonth;
  var y = Number(p[0]), m = Number(p[1]);
  if (y < 2500) y += 543; // เผื่อกรณีเก็บเป็น ค.ศ.
  return TH[m - 1] + ' ' + y;
}

/** รายชื่อเดือนที่มีสถิติการเล่น สำหรับทำช่องเลือกเดือนในตารางอันดับ */
function getGameMonths() {
  requireLogin_();
  var data = KG_sheet_().getDataRange().getValues();
  var seen = {};
  for (var i = 1; i < data.length; i++) {
    var pm = String(data[i][4]);
    if (pm) seen[pm] = 1;
  }
  var months = Object.keys(seen).sort().reverse();
  var cur = Utilities.formatDate(new Date(), KG_tz_(), 'yyyy-MM');
  if (months.indexOf(cur) < 0) months.unshift(cur);
  return months.map(function (m) { return { key: m, label: KG_monthLabel_(m) }; });
}

/* ================= 7) ประวัติการเล่นและชั่วโมงการเรียนรู้ของฉัน ================= */

function getMyGameHistory() {
  var user = requireLogin_();
  var sigs = {};
  readSignatures_().forEach(function (s) { sigs[s.attemptId] = s; });

  var data = KG_sheet_().getDataRange().getValues();
  var out = [];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][1]).toLowerCase() !== String(user.email).toLowerCase()) continue;
    var gid = String(data[i][11]);
    var mi = KG_monthIndex_(String(data[i][5]));
    out.push({
      date: Utilities.formatDate(new Date(data[i][0]), KG_tz_(), 'dd/MM/yyyy HH:mm'),
      kpiMonth: mi >= 0 ? KPI_MONTHS[mi].full : String(data[i][5]),
      score: Number(data[i][6]) || 0,
      correct: Number(data[i][7]) || 0,
      total: Number(data[i][8]) || 0,
      pass: (data[i][12] === true || String(data[i][12]).toUpperCase() === 'TRUE'),
      learnHours: Number(data[i][10]) || 0,
      gameId: gid,
      hasSignature: !!sigs[gid],
      signatureDataUrl: sigs[gid] ? sigs[gid].signatureDataUrl : null
    });
  }
  return out.reverse();
}

/** ชั่วโมงการเรียนรู้สะสมทั้งหมด = บทเรียนที่สอบผ่าน + เกมที่ผ่าน */
function getMyLearningHours() {
  var user = requireLogin_();
  var emailLower = String(user.email).toLowerCase();

  var passedCourses = {};
  readAttempts_().forEach(function (a) {
    if (a.email.toLowerCase() === emailLower && a.pass) passedCourses[a.courseId] = 1;
  });
  var courseCount = Object.keys(passedCourses).length;
  var courseHours = courseCount * COURSE_LEARN_HOURS;

  var gameHours = 0, gamePass = 0;
  var data = KG_sheet_().getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][1]).toLowerCase() !== emailLower) continue;
    gameHours += Number(data[i][10]) || 0;
    if (data[i][12] === true || String(data[i][12]).toUpperCase() === 'TRUE') gamePass++;
  }

  return {
    courseCount: courseCount,
    courseHours: Math.round(courseHours * 100) / 100,
    gamePassCount: gamePass,
    gameHours: Math.round(gameHours * 100) / 100,
    totalHours: Math.round((courseHours + gameHours) * 100) / 100
  };
}

/* ================= 8) ฝั่งผู้ดูแลระบบ ================= */

/** สรุปชั่วโมงการเรียนรู้ของพนักงานทุกคน สำหรับรายงานประจำเดือน/ปี */
function getAllLearningHours() {
  requireAdmin_();
  var users = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_USERS).getDataRange().getValues();
  var head = users[0];
  var iEmail = head.indexOf('Email'), iName = head.indexOf('Name'), iDept = head.indexOf('Department'), iRole = head.indexOf('Role');

  var attempts = readAttempts_();
  var gdata = KG_sheet_().getDataRange().getValues();

  var out = [];
  for (var i = 1; i < users.length; i++) {
    var role = String(users[i][iRole] || 'employee').toLowerCase();
    if (role === 'admin' || role === 'hr') continue;
    var email = String(users[i][iEmail]).toLowerCase();

    var passed = {};
    attempts.forEach(function (a) { if (a.email.toLowerCase() === email && a.pass) passed[a.courseId] = 1; });
    var cCount = Object.keys(passed).length;

    var gHours = 0, gPlays = 0, gBest = 0;
    for (var r = 1; r < gdata.length; r++) {
      if (String(gdata[r][1]).toLowerCase() !== email) continue;
      gPlays++;
      gHours += Number(gdata[r][10]) || 0;
      if ((Number(gdata[r][6]) || 0) > gBest) gBest = Number(gdata[r][6]) || 0;
    }

    out.push({
      email: users[i][iEmail], name: users[i][iName], dept: users[i][iDept],
      courseCount: cCount,
      courseHours: Math.round(cCount * COURSE_LEARN_HOURS * 100) / 100,
      gamePlays: gPlays,
      gameBestScore: gBest,
      gameHours: Math.round(gHours * 100) / 100,
      totalHours: Math.round((cCount * COURSE_LEARN_HOURS + gHours) * 100) / 100
    });
  }
  out.sort(function (a, b) { return b.totalHours - a.totalHours; });
  return out;
}

/** ส่งออกรายงานชั่วโมงการเรียนรู้เป็น CSV */
function buildLearningHoursCSV() {
  requireAdmin_();
  var rows = [['ชื่อพนักงาน','แผนก','บทเรียนที่ผ่าน','ชม.จากบทเรียน','จำนวนครั้งที่เล่นเกม','คะแนนเกมสูงสุด','ชม.จากเกม','ชม.รวม'].map(csvEscape_).join(',')];
  getAllLearningHours().forEach(function (e) {
    rows.push([e.name, e.dept, e.courseCount, e.courseHours, e.gamePlays, e.gameBestScore, e.gameHours, e.totalHours].map(csvEscape_).join(','));
  });
  return rows.join('\n');
}

/**
 * มอบแต้มสะสมให้ 5 อันดับแรกของเดือนที่ระบุ (เช่น '2569-08')
 * แอดมินกดครั้งเดียวตอนสิ้นเดือน ระบบจะไม่ให้แต้มซ้ำถ้าเคยมอบไปแล้ว
 * แต้มจะเข้าไปรวมกับระบบแลก LINE credit เดิมของโรงพยาบาลทันที
 */
function awardMonthlyGamePoints(playMonth) {
  requireAdmin_();
  if (!playMonth) throw new Error('กรุณาระบุเดือนที่ต้องการมอบแต้ม เช่น 2569-08');

  var lb = getGameLeaderboard(playMonth);
  if (!lb.top.length) throw new Error('เดือน ' + lb.monthLabel + ' ยังไม่มีผู้เล่น');

  var psh = getSheet_(SHEET_POINTS);
  var pdata = psh.getDataRange().getValues();
  var courseId = 'GAMERANK_' + playMonth;

  for (var i = 1; i < pdata.length; i++) {
    if (String(pdata[i][4]) === courseId) {
      throw new Error('เดือน ' + lb.monthLabel + ' เคยมอบแต้มไปแล้ว ไม่สามารถมอบซ้ำได้');
    }
  }

  var awarded = [];
  lb.top.forEach(function (p, idx) {
    var pts = GAME_POINTS_BY_RANK[idx];
    if (!pts) return;
    // หาอีเมลจริงของผู้เล่นจากชีตเกม
    var gdata = KG_sheet_().getDataRange().getValues();
    var email = '', dept = p.dept;
    for (var r = 1; r < gdata.length; r++) {
      if (String(gdata[r][4]) === playMonth && String(gdata[r][2]) === p.name) { email = gdata[r][1]; dept = gdata[r][3]; break; }
    }
    if (!email) return;
    psh.appendRow([new Date(), email, p.name, dept, courseId,
                   'เกม KPI Challenge อันดับที่ ' + p.rank + ' ประจำ' + lb.monthLabel,
                   p.rank, pts, 'GAMERANK']);
    awarded.push({ rank: p.rank, name: p.name, points: pts });
  });

  return { ok: true, monthLabel: lb.monthLabel, awarded: awarded };
}
