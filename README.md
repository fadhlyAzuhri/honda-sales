# Web Sales Honda

Web gratis di GitHub Pages untuk:
- **Harga** — lihat 2 brosur harga & angsuran (bisa di-zoom, dibagikan ke WA konsumen).
- **Konsumen** — form singkat data konsumen → hasil teks siap kirim WA (format Reg/SALES/Pemohon/…).
- **Riwayat** — daftar konsumen tersimpan, bisa dicari, diedit, diekspor ke Excel.
- **⚙ Update Brosur** — ganti foto brosur tiap bulan langsung dari HP.

---

## A. Pasang online (sekali saja, ±10 menit)

1. **Buat akun GitHub** di https://github.com/signup (gratis).
2. **Buat repo**: tekan **+** (kanan atas) → **New repository**
   - Repository name: `honda-sales`
   - Pilih **Public** → **Create repository**.
3. **Upload file**: ekstrak zip dulu, lalu di halaman repo tekan **uploading an existing file**
   → pilih **semua file** (index.html, app.js, style.css, config.js, brosur.json, motor.json,
   brosur-1.jpg, brosur-2.jpg, README.md) → **Commit changes**.
4. **Aktifkan web**: di repo buka **Settings → Pages**
   - Source: **Deploy from a branch**
   - Branch: **main** dan folder **/ (root)** → **Save**.
5. Tunggu 1–2 menit. Web Anda ada di:
   **`https://USERNAME-ANDA.github.io/honda-sales/`**
   Simpan ke layar utama HP: buka di Chrome → menu ⋮ → **Tambahkan ke layar utama**.

## B. Sambungkan tombol "Update Brosur" (sekali per HP)

Supaya bisa ganti brosur dari web, butuh *token* GitHub:

1. Buka https://github.com/settings/personal-access-tokens/new
2. Isi:
   - Token name: `brosur-honda`
   - Expiration: pilih masa berlaku (misal 1 tahun; kalau habis, buat lagi)
   - Repository access: **Only select repositories** → pilih `honda-sales`
   - Permissions → Repository permissions → **Contents: Read and write**
3. **Generate token** → salin (diawali `github_pat_…`).
4. Buka web Anda → tekan **⚙** → username & nama repo biasanya sudah terisi →
   tempel token → **Simpan & Tes**. Harus muncul "✓ Tersambung".

> Token hanya tersimpan di HP itu. Jangan bagikan token ke siapa pun.

## C. Ganti brosur tiap bulan (±1 menit)

1. Buka web → **⚙**
2. Isi **Periode** (misal `Desember 2026`)
3. Ketuk kotak **Brosur 1** & **Brosur 2** → pilih foto brosur baru
4. **Upload & Terbitkan** → tunggu ±1–2 menit, semua yang buka web melihat brosur baru.

Opsional: perbarui **Daftar tipe & OTR** (dipakai untuk isi OTR otomatis di form) lalu
**Simpan Daftar Tipe**. Format per baris: `New Scoopy Prestige/Stylish | 25.537.000`

## D. Data konsumen

- Nomor Reg otomatis: `001/CDN-TPI/XI/2026`, naik sendiri dan mulai lagi dari 001 tiap bulan
  (tetap bisa diketik manual).
- **Kirim WA** = simpan + buka WhatsApp dengan teks siap kirim. **Salin** = salin teks saja.
- Data konsumen **hanya tersimpan di HP Anda**, tidak pernah ikut di-upload ke GitHub
  (repo ini publik). Karena itu rutin tekan **Riwayat → Backup**; file backup bisa
  dipulihkan di HP lain lewat **Pulihkan**.

## E. Ubah nama / nomor sales

Edit file `config.js` di GitHub (buka file → ikon pensil ✎ → Commit changes):
nama dealer, nama sales, nomor HP, kode reg (`CDN-TPI`), dan nomor WA tujuan
(kosongkan kalau mau pilih kontak tiap kirim).
