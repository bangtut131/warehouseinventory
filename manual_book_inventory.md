# Buku Panduan Pengguna & Referensi Teknis
**Aplikasi Analisa Inventory Warehouse (SLA Logistik)**

---

## DAFTAR ISI
1. [Pendahuluan](#1-pendahuluan)
2. [Arsitektur Sistem & Alur Data](#2-arsitektur-sistem--alur-data)
3. [Panduan Penggunaan Dashboard](#3-panduan-penggunaan-dashboard)
4. [Penjelasan Formulasi & Perhitungan Matematika](#4-penjelasan-formulasi--perhitungan-matematika)
5. [Klasifikasi & Kategorisasi Barang](#5-klasifikasi--kategorisasi-barang)
6. [Sistem Peringatan Status Stok](#6-sistem-peringatan-status-stok)
7. [Manajemen Sinkronisasi Data (Force Sync)](#7-manajemen-sinkronisasi-data-force-sync)

---

## 1. PENDAHULUAN
Aplikasi **Analisa Inventory Warehouse** dirancang khusus untuk memonitor, mengelola, dan memberikan rekomendasi strategis terkait persediaan barang. Aplikasi ini secara otomatis menarik data penjualan dan data stok dari sistem ERP **Accurate Online**, lalu mengolahnya menggunakan perhitungan matematis rantai pasok (Supply Chain Management) seperti EOQ, ROP, dan Safety Stock untuk memberikan rekomendasi apakah suatu barang perlu segera dipesan ulang, masih aman, atau sedang overstock (berlebihan).

---

## 2. ARSITEKTUR SISTEM & ALUR DATA
Sistem tidak menghitung data secara sembarangan, melainkan mengikuti alur yang ketat untuk menjamin kecepatan dan keakuratan:
1. **Accurate API:** Sumber kebenaran utama (Single Source of Truth). Semua data mentah (Faktur Penjualan, Purchase Order, Daftar Barang, Stok Gudang) ditarik dari sini.
2. **Master Cache Database:** Karena menarik data ribuan faktur dari Accurate membutuhkan waktu lama, sistem menyimpan salinan data tersebut di database VPS (SQLite/Postgres). Ini membuat dashboard bisa diakses secara instan (dalam hitungan milidetik).
3. **Data Filtering (Isolasi Tanggal):** Ketika Anda memilih rentang tanggal di dashboard (misalnya "3 Bulan Terakhir"), sistem akan mengambil data dari *Master Cache*, lalu **secara dinamis menjumlahkan ulang** total qty dan revenue HANYA untuk bulan-bulan yang masuk dalam rentang tanggal tersebut.

---

## 3. PANDUAN PENGGUNAAN DASHBOARD
Dashboard utama menampilkan informasi secara padat dan jelas.
*   **Filter Tanggal (Riwayat):** Terdapat tombol pintasan **3 Bulan**, **6 Bulan**, **Tahun Ini** (Year-to-Date), dan **Semua Data**. Saat tombol ini ditekan, klik **"Terapkan Filter"** agar sistem menghitung ulang rata-rata harian dan bulanan berdasarkan rentang tersebut.
*   **Filter Cabang & Gudang:** Anda bisa menganalisa inventaris secara keseluruhan (Semua Cabang), atau spesifik menukik ke Cabang & Gudang tertentu.
*   **Indikator Mode Data:**
    *   🟢 **Data Real (API):** Menandakan perhitungan saat ini menggunakan data penjualan riil dari hasil sinkronisasi Accurate.
    *   🟡 **Smart Estimation:** Menandakan cache data kosong, sehingga sistem menggunakan algoritma estimasi sementara. (Solusi: Tekan tombol *Force Sync*).

---

## 4. PENJELASAN FORMULASI & PERHITUNGAN MATEMATIKA
Aplikasi ini ibarat otak seorang analis Supply Chain. Berikut adalah rincian rumus yang bekerja di balik layar untuk setiap item barang:

### 4.1. Average Daily Usage (Rata-rata Penggunaan Harian)
Kecepatan pergerakan barang setiap harinya.
*   **Rumus:** `Total Penjualan Qty / Jumlah Hari (berdasarkan filter tanggal)`
*   *Contoh:* Jika filter 90 hari (3 bulan) dan barang terjual 900 pcs, maka Average Daily Usage = `10 pcs/hari`.

### 4.2. Standard Deviation (Standar Deviasi Bulanan & Harian)
Mengukur seberapa fluktuatif penjualan suatu barang. Semakin besar angkanya, semakin tidak menentu penjualannya (kadang laris manis, kadang tidak laku sama sekali).
*   **Rumus Standar Deviasi Bulanan:** Diambil dari varian (selisih kuadrat) penjualan per bulan terhadap rata-rata penjualan bulanan, lalu diakarkuadratkan.
*   **Rumus Standar Deviasi Harian:** `Standar Deviasi Bulanan / Akar(30)`

### 4.3. Safety Stock (Stok Aman/Penyangga)
Jumlah stok tambahan yang harus disimpan untuk mencegah kehabisan barang (Stockout) jika terjadi lonjakan permintaan tak terduga atau keterlambatan pengiriman.
*   **Parameter Default:** 
    *   Lead Time (Waktu Tunggu Pengiriman) = **30 Hari**
    *   Service Level (Tingkat Pelayanan yang ditargetkan) = **95%** (Z-Score = 1.65)
*   **Rumus:** `Z-Score * Standar Deviasi Harian * Akar(Lead Time)`
*   *Contoh Formulasi:* `1.65 * StdDev_Harian * √30`

### 4.4. Reorder Point (ROP - Titik Pemesanan Ulang)
Batas jumlah stok di mana pihak purchasing HARUS segera membuat Purchase Order baru.
*   **Rumus:** `(Lead Time * Average Daily Usage) + Safety Stock`
*   *Penjelasan:* Jika kita butuh waktu 30 hari agar barang sampai, dan sehari rata-rata laku 10 pcs, maka selama masa tunggu kita butuh 300 pcs. Ditambah Safety Stock (misal 50 pcs). Maka ROP = 350 pcs. Jika stok menyentuh 350, segera pesan!

### 4.5. Economic Order Quantity (EOQ - Kuantitas Pemesanan Ekonomis)
Berapa banyak jumlah ideal yang harus dipesan dalam satu kali Purchase Order agar biaya simpan dan biaya pesan paling efisien.
*   **Parameter Default:**
    *   Ordering Cost (Biaya sekali pesan) = **Rp 50.000**
    *   Holding Cost (Biaya simpan tahunan) = **15% dari harga pokok barang (Cost)**
    *   Annual Demand = `Average Daily Usage * 365`
*   **Rumus:** `√ ( (2 * Annual Demand * Ordering Cost) / Holding Cost )`

### 4.6. Penyesuaian Satuan Khusus (Item SAK)
Beberapa barang, terutama kategori Agri (contoh: pupuk yang ada tulisan "KG" pada namanya) memiliki rasio konversi khusus, misalnya 1 Sak = 50 Kg.
Sistem secara cerdas akan mendeteksi ini. Jika rasio konversi ≥ 25, sistem akan membagi **Quantity Stok Aktual** dengan Rasio tersebut agar satuan yang dianalisa dan ditampilkan di tabel menjadi **"Sak"**, bukan "Kg".

---

## 5. KLASIFIKASI & KATEGORISASI BARANG

### 5.1. ABC Analysis (Berdasarkan Nilai Keuangan)
*(Catatan: Saat ini sistem diset ke kelas C secara default untuk stabilitas, namun konsep dasarnya telah disiapkan)*
Barang dikelompokkan berdasarkan seberapa besar kontribusinya terhadap total pendapatan perusahaan.
*   **Kelas A:** 20% barang yang menyumbang 80% pendapatan (Fokus utama).
*   **Kelas B:** 30% barang menengah.
*   **Kelas C:** 50% barang lambat yang menyumbang pendapatan kecil.

### 5.2. XYZ Analysis (Berdasarkan Fluktuasi Permintaan)
Dihitung menggunakan *Coefficient of Variation (CV) = Standar Deviasi Bulanan / Rata-rata Penjualan Bulanan*.
*   **Kelas X (Stabil):** `CV < 0.2`. Penjualan sangat stabil dan mudah diprediksi.
*   **Kelas Y (Fluktuatif):** `0.2 ≤ CV ≤ 0.5`. Penjualan bervariasi karena faktor tren/musiman.
*   **Kelas Z (Sangat Fluktuatif):** `CV > 0.5`. Penjualan sporadis dan sulit diprediksi sama sekali.

### 5.3. Demand Category (Kecepatan Pergerakan)
Kategori yang paling mudah dipahami secara kasat mata, ditentukan dari Rata-rata Penjualan Bulanan.
*   🚀 **Fast Moving:** Rata-rata > 50 unit/bulan.
*   🚶 **Slow Moving:** Rata-rata antara 5 - 50 unit/bulan.
*   🐢 **Non-Moving:** Rata-rata > 0 tetapi < 5 unit/bulan.
*   💀 **Dead Stock:** Tidak ada penjualan sama sekali (0 unit).

---

## 6. SISTEM PERINGATAN STATUS STOK
Tujuan akhir dari semua hitungan matematis di atas adalah untuk memberikan **Status Teks** yang jernih bagi staf gudang dan purchasing. Sistem membandingkan **Stok Aktual (termasuk PO Outstanding/yang sedang dalam perjalanan)** dengan parameter ROP dan Safety Stock.

Terdapat perhitungan stok *Virtual*:
`Stok Tersedia = Stok Fisik di Gudang + PO Outstanding (Barang yang sudah dipesan tapi belum datang)`

Berdasarkan *Stok Tersedia* tersebut, sistem memberikan status:
1. 🔴 **CRITICAL (Kritis):**
   *Syarat:* `Stok Tersedia ≤ Safety Stock`
   *Tindakan:* Darurat! Segera kejar supplier, kemungkinan besar akan terjadi kekosongan barang esok hari.
2. 🟠 **REORDER (Waktunya Pesan):**
   *Syarat:* `Stok Tersedia ≤ ROP` (tapi masih di atas Safety Stock).
   *Tindakan:* Buat Purchase Order sekarang sebanyak nilai **EOQ**.
3. 🟢 **OK (Aman):**
   *Syarat:* `Stok Tersedia > ROP` dan `Stok Tersedia ≤ Max Stock` (Max Stock = ROP + EOQ).
   *Tindakan:* Tidak perlu melakukan apa-apa. Persediaan sehat.
4. 🔵 **OVERSTOCK (Berlebih):**
   *Syarat:* `Stok Tersedia > Max Stock`.
   *Tindakan:* Hentikan pemesanan. Lakukan promosi diskon untuk menghabiskan barang karena biaya penyimpanan (Holding Cost) terlalu membebani perusahaan.

---

## 7. MANAJEMEN SINKRONISASI DATA (FORCE SYNC)
Sistem ini menarik puluhan ribu baris faktur (Sales Invoice) dan pesanan pembelian (Purchase Order) dari server pusat Accurate.
*   Jika sistem menarik data ini setiap kali halaman di-refresh, server Accurate akan mendeteksi sebagai serangan (Rate Limit / HTTP 429) dan memblokir aplikasi.
*   Oleh karena itu, dibuatlah tombol merah **Force Sync**.
*   **Proses Force Sync berjalan di Background (Latar Belakang):**
    1. Fase 1: Mengambil daftar Invoice.
    2. Fase 2: Mengambil rincian setiap Invoice per baris barang secara paralel.
    3. Fase 3: Mengambil jumlah stok fisik di setiap gudang.
    4. Fase 4: Mengambil data PO Outstanding (Barang yang masih ditunggu kedatangannya).
*   **Kapan harus menekan Force Sync?** Disarankan dilakukan 1x sehari (misalnya di pagi hari sebelum mulai analisa) agar data cache yang digunakan oleh dashboard tetap *fresh*. Selama hari itu, pengguna bisa dengan bebas memutar-mutar filter tanggal (3 Bulan, 6 Bulan) secepat kilat menggunakan *Master Cache* yang telah tersimpan.

---
*Dokumen ini dibuat secara otomatis oleh asisten sistem cerdas SLA Logistik.*
