# Apps Script (clasp)

โฟลเดอร์นี้ใช้เก็บซอร์สโค้ด Google Apps Script ที่เป็นแบ็กเอนด์ของ Med-LMS
(Web App ที่ `index.html` เรียกผ่านตัวแปร `APP_URL`) ให้ sync กับ git repo นี้
ผ่านเครื่องมือ [`clasp`](https://github.com/google/clasp) ของ Google

## ครั้งแรก (ทำในเครื่องของคุณเอง ไม่ใช่ในเซสชันนี้)

clasp ต้อง login ผ่านเบราว์เซอร์ด้วยบัญชี Google ของคุณเอง จึงต้องรันคำสั่งเหล่านี้
**ในเครื่อง/เทอร์มินัลของคุณ** ไม่ใช่ในคอนเทนเนอร์รันงานนี้

```bash
npm install -g @google/clasp
clasp login
```

## เชื่อมกับโปรเจกต์ Apps Script ที่มีอยู่

1. เปิดโปรเจกต์ Apps Script (script.google.com) ที่ผูกกับ `APP_URL` ใน `index.html`
2. ไปที่ **Project Settings** (ไอคอนเฟือง) แล้ว copy **Script ID**
3. แก้ไฟล์ `.clasp.json` ที่ root ของ repo นี้ ใส่ Script ID แทน `PASTE_YOUR_SCRIPT_ID_HERE`
4. ดึงโค้ดจริงลงมา:

```bash
clasp pull
```

โค้ดทั้งหมด (Code.gs, ไฟล์ .gs อื่นๆ, appsscript.json) จะถูกดึงมาไว้ในโฟลเดอร์ `apps-script/` นี้

## Push กลับขึ้น Apps Script

หลังแก้โค้ดในโฟลเดอร์นี้แล้ว (ไม่ว่าจะแก้เองหรือให้ Claude ช่วยแก้):

```bash
clasp push
```

## หมายเหตุ

- `.clasp.json` มี Script ID เฉพาะโปรเจกต์ของคุณ — อย่า commit ค่าไฟล์นี้ถ้า Script ID เป็นความลับ
  (ปกติไม่ใช่ความลับร้ายแรง แต่ถ้าต้องการปิดเป็นส่วนตัว ให้เพิ่ม `.clasp.json` ใน `.gitignore` แทน)
- ทุกครั้งที่แก้ `apps-script/*.gs` แล้วต้องการ deploy เป็น Web App เวอร์ชันใหม่ ให้ทำผ่าน
  Apps Script editor (Deploy > Manage deployments > Edit) หลังจาก `clasp push` แล้ว
