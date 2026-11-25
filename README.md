# Humas Desk — Bot Discord Humas + Web Roomchat Control Panel

Sistem komunikasi resmi & anonim untuk tim Humas Discord:
- **Overview Statistik:** Ringkasan DM belum dibalas, klaim perlu follow-up (>3 hari), partner aktif, custom role aktif, warning bulan ini, aspirasi baru, dan rating survei.
- **Web Roomchat Real-Time Multi-Admin (Mobile-Friendly & Ringan):** Admin membalas secara anonim atas nama Bot Humas, lengkap dengan audit trail internal, catatan internal, template cepat, **Media Kit 1-Klik**, **Auto-Flag Follow-Up**, **Fallback Private Thread** jika DM tertutup, serta kirim & tampil gambar 2 arah (Upload / Drag & Drop / `Ctrl+V` screenshot, disimpan lokal anti-expired 24 jam).
- **Anon Chat 2 Arah (`/anonchat`):** Jalur curhat & aduan di luar tiket — identitas member (username & Discord ID) 100% disembunyikan dari admin di web (`Anon #XXXX`).
- **Quick Chat & Staff Reminder:** Simpan daftar staff/member penting untuk 1-klik buka chat atau kirim reminder massal via Bot.
- **Post Channel:** Kirim pengumuman/gambar/embed langsung ke channel server dari web + riwayat postingan.
- **Manajemen Partnership (CRM):** Database partner, PIC cadangan, riwayat kolaborasi, cek validitas invite, alert jika PIC keluar server, broadcast tersegmentasi berjeda + tombol konfirmasi baca, serta Undangan Event & RSVP Partner.
- **Custom Role Booster & Benefit (`/mrole` & `!mrole`):** Panel interaktif View ↔ Edit Mode (Nama, 1/2 Warna Gradasi, Random Color, Icon, Banner, Deskripsi, Equip/Unequip, History, Share hingga 10 teman), otomatis mengikuti status Server Booster Discord + bisa di-grant manual dari web.
- **Kotak Aspirasi (`/aspirasi`) & Survei Evaluasi Event (`/survei`)**
- **Auto-Reply Jam Operasional (Office Hours)**
- **Login Tertutup via `.env` (`superadmin` & `staff`) + Audit Log Aktivitas Admin (khusus `superadmin`)**

---

## Persiapan Bot di Discord Developer Portal
1. Buka https://discord.com/developers/applications → **New Application** → tab **Bot**.
2. Aktifkan **Privileged Gateway Intents**:
   - `SERVER MEMBERS INTENT`
   - `MESSAGE CONTENT INTENT`
3. Undang bot ke server dengan scope `bot` + `applications.commands` dan permission:
   - `Manage Roles` (taruh role bot di atas custom role agar warna & icon tampil)
   - `Send Messages`, `Send Messages in Threads`, `Create Private Threads`, `Manage Threads`, `Embed Links`, `Attach Files`, `Read Message History`.

---

## Cara Setup & Deploy di VPS (Ubuntu/Debian)

### 1. Pastikan Node.js v24+ Terpasang
> Aplikasi ini memakai `node:sqlite` bawaan Node.js v24 (tanpa perlu install database server terpisah).
```bash
node -v # pastikan v22.13+ / v24+
```

### 2. Clone Repo & Install Dependensi
```bash
git clone <URL_REPO_GITHUB_KAMU> humas-desk
cd humas-desk
npm install
npm --prefix web install
```

### 3. Konfigurasi `.env`
```bash
cp .env.example .env
nano .env
```
Isi `DISCORD_TOKEN`, `DISCORD_GUILD_ID`, `NOTIF_CHANNEL_ID`, `FALLBACK_CHANNEL_ID`, `WEB_BASE_URL`, `JWT_SECRET`, dan `ADMIN_ACCOUNTS`.
*(Opsional: hash password admin dengan `npm run hash -- passwordmu` lalu tempel hash-nya ke `ADMIN_ACCOUNTS`.)*

### 4. Build & Jalankan dengan PM2
```bash
npm run build
npm install -g pm2
pm2 start dist/index.js --name humas-desk
pm2 save
pm2 startup
```

Akses web panel di `http://<IP_VPS>:3000` (atau arahkan domain + SSL HTTPS menggunakan Nginx/Caddy reverse proxy ke `http://127.0.0.1:3000`).

---

## Mode Development (Lokal)
- Terminal 1 (Backend + Bot): `npm run dev`
- Terminal 2 (Frontend Vite): `npm run dev:web` → buka `http://localhost:5173`
