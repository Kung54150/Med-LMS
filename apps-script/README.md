# apps-script — โค้ดระบบ Med-LMS (Google Apps Script)

โฟลเดอร์นี้เก็บสำเนาโค้ดของระบบจริงที่ `index.html` เด้งไปหา (`script.google.com/macros/s/.../exec`)
เพื่อให้มีสำรองและประวัติการแก้ไขใน GitHub

> ไฟล์ที่มีตอนนี้: Code.gs, Code_TopDx.gs, Code_EKG.gs, Code_KpiGame.gs, AdminShift.html (ยังขาด appsscript.json และไฟล์ HTML อื่นของระบบ เช่น index, ekg_reading, KpiGame ถ้ามี)

## ดึงโค้ดด้วย clasp (ทำครั้งแรก จากเครื่องของคุณ)
1. ติดตั้ง Node.js แล้วรัน `npm i -g @google/clasp`
2. เปิด https://script.google.com/home/usersettings แล้วเปิด **Google Apps Script API**
3. ล็อกอิน แล้วดึงโค้ด (Script ID อยู่ใน Apps Script > Project Settings > IDs):
   ```bash
   clasp login
   cd apps-script
   clasp clone <SCRIPT_ID>
   ```
4. ตรวจว่ามีไฟล์ `.gs`, `.html`, `appsscript.json` แล้วคอมมิตขึ้นรีโป:
   ```bash
   git add . && git commit -m "Add Apps Script source" && git push
   ```

## ใช้งานต่อ
- ดึงการแก้ไขล่าสุดจากหน้าเว็บ Apps Script: `clasp pull`
- ส่งโค้ดในรีโปขึ้น Apps Script: `clasp push`
- เมื่อแก้แล้วต้อง **Deploy > Manage deployments > แก้ไข > เวอร์ชันใหม่** ลิงก์ `/exec` เดิมจึงได้โค้ดใหม่

## ข้อควรระวัง
- รีโปนี้เป็น **public** อย่าคอมมิตรหัสผ่าน โทเคน หรือ API key ที่เขียนไว้ในโค้ด ให้ย้ายไปไว้ใน Script Properties
- ไฟล์ `.clasprc.json` (โทเคนล็อกอิน) ห้ามคอมมิต (กันไว้ใน `.gitignore` แล้ว)
