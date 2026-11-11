# ម៉ាតភ្នំទូកមាស POS — Frontend + Backend

```
docs/     Frontend (GitHub Pages)  — index.html, api.js, config.js, sw.js, manifest
server/   Backend (Node.js + Express + SQLite) — server.js
```

## ស្ថាបត្យកម្ម
- **Frontend** ដំណើរការលើ GitHub Pages (Static) ហើយអាច Install លើទូរស័ព្ទ និងបើក Offline បាន។
- **Backend** (GitHub Pages ដំណើរការ Server មិនបាន ត្រូវដាក់ដាច់ដោយឡែក) ទទួលខុសត្រូវ៖
  Login (JWT + ពាក្យសម្ងាត់ Hash), រក្សាទិន្នន័យ, សិទ្ធិតាម Role, ផ្ញើ Telegram + Gmail។
- Offline: កម្មវិធីរក្សាទុកក្នុង Browser សិន រួច Sync ទៅ Server ដោយស្វ័យប្រវត្តិពេលមានអ៊ីនធឺណិត
  (ការលក់ និងសារ Notification ដែលមិនទាន់ផ្ញើ ត្រូវរង់ចាំក្នុង Queue)។

## ១) Backend
### សាកល្បងលើកុំព្យូទ័រ
```bash
cd server
cp .env.example .env      # កែ JWT_SECRET, ADMIN_PASSWORD
npm install
npm start                 # http://localhost:3000
```
### ដាក់លើ Server (Render / Railway / Fly.io / VPS)
- Root Directory: `server`   Build: `npm install`   Start: `npm start`
- ដាក់ Environment Variables តាម `server/.env.example`
  (`ALLOWED_ORIGINS=https://USERNAME.github.io`)
- **សំខាន់:** ត្រូវភ្ជាប់ Disk/Volume ថេរ ហើយកំណត់ `DB_PATH` ទៅលើវា (ឧ. `/var/data/pos.db`)។
  បើគ្មាន Disk ថេរ ទិន្នន័យនឹងបាត់ពេល Server Restart/Deploy ថ្មី។ `render.yaml` មានឧទាហរណ៍។

### Gmail
បើក 2-Step Verification ក្នុង Google Account → បង្កើត **App Password** → ដាក់ក្នុង `GMAIL_APP_PASSWORD`។

## ២) Frontend (GitHub Pages)
1. Push ទៅ GitHub → **Settings → Pages** → Branch `main` / Folder **`/docs`** → Save។
2. បើក `https://USERNAME.github.io/REPO/` → នៅទំព័រ Login ចុច **⚙ Server** ហើយវាយ URL Backend → រក្សាទុក។
   (ឬកែ `docs/config.js` ដាក់ URL ជាលំនាំដើម)
3. Login ជា `Admin` ជាមួយ `ADMIN_PASSWORD`។

## ចែក Link ឱ្យបុគ្គលិក
- ក្រោយ Login ជា Admin ទៅ **ការកំណត់ (Settings)** នឹងមានកាត **🔗 Link សម្រាប់បុគ្គលិក** → ចុច *ចម្លង* រួចផ្ញើ។
- Link មានរូបរាង `https://USERNAME.github.io/REPO/?api=https://pos-api.onrender.com`
  បុគ្គលិកបើក Link ភ្លាម ត្រូវភ្ជាប់ Server ដោយស្វ័យប្រវត្តិ (ឃើញ 🟢 លើទំព័រ Login) ហើយ Login ដោយឈ្មោះ/លេខសម្ងាត់ដែល Admin បង្កើតឱ្យ។
- ទិន្នន័យទាំងអស់ដែលបុគ្គលិកបញ្ចូល ត្រូវផ្ញើទៅ Server។ បើបាត់អ៊ីនធឺណិត រក្សាក្នុងម៉ាស៊ីនសិន រួច Sync ពេលមានអ៊ីនធឺណិត។
- ត្រូវដាក់ `ALLOWED_ORIGINS` ក្នុង Server ឱ្យត្រូវនឹង `https://USERNAME.github.io` បើមិនដូច្នោះ Browser នឹងបដិសេធ។

## សិទ្ធិតាម Role (Server ពិនិត្យ)
| Role | សិទ្ធិ |
|---|---|
| ADMIN | គ្រប់យ៉ាង (បុគ្គលិក, ចំណាយ, ការកំណត់, លុបវិក្កយបត្រ) |
| CASHIER | លក់, កត់ត្រាលុយអាប់; កែបានតែចំនួនស្តុក (qty) ពេលលក់; មិនអាចកែតម្លៃ/លុបទំនិញ/លុបវិក្កយបត្រ |
| STOCK | គ្រប់គ្រងទំនិញក្នុងស្តុក |

## ចំណាំ
- ទំនិញគំរូ 3 មុខ (Bacchus ...) នឹងត្រូវផ្ញើទៅ Server នៅពេល Admin Login លើកដំបូង — លុបវាចេញបាន។
- Sync គឺ Polling រៀងរាល់ ~20 វិនាទី (មិនមែន Realtime ភ្លាមៗ)។ បើពីរម៉ាស៊ីនកែទំនិញតែមួយក្នុងពេលជាមួយគ្នា ការកែចុងក្រោយឈ្នះ។
- Telegram Token / Gmail Password នៅលើ Server ប៉ុណ្ណោះ មិនបង្ហាញក្នុង Browser ទេ។
- បើមិនបានកំណត់ Server កម្មវិធីដំណើរការ Local ម្នាក់ឯងដូចមុន (គ្មាន Backend)។
- ការទូទាត់ KHQR/Bakong នៅមិនទាន់ភ្ជាប់ Backend (មិនទាន់មានក្នុងកូដដើម)។
