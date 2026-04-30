import { google } from 'googleapis';

// ─── Existing SLA Sheet Types ────────────────────────────────

export interface SheetOrder {
    doName: string;
    completedAt: string | null;
}

// ─── Dispatch (TMS) Types ────────────────────────────────────

export interface DispatchRecord {
    scheduledDate: string;        // Dijadwalkan Tanggal
    customerName: string;         // Nama Pelanggan
    customerCode: string;         // Kode Pelanggan
    taskNumber: string;           // Nomor Tugas (DO number — key matching)
    taskType: string;             // Jenis Tugas
    destination: string;          // Lokasi Tujuan
    officeLocation: string;       // Lokasi Kantor
    assignmentStatus: string;     // Status Penugasan
    driver: string;               // Driver Bertugas
    coDriver: string;             // Co-Driver
    proofOfDelivery: string;      // Bukti Selesai (URL)
    completionDetails: string;    // Rincian Penyelesaian
    taskCreatedAt: string;        // Waktu Tugas Dibuat
    assignedAt: string;           // Waktu Penugasan
    taskStartedAt: string;        // Waktu Tugas Dijalankan
    taskCompletedAt: string;      // Waktu Tugas Diselesaikan
    // Derived
    isDeparted: boolean;          // true if taskStartedAt has value
    isCompleted: boolean;         // true if taskCompletedAt has value
    durationMinutes: number | null; // taskCompletedAt - taskStartedAt in minutes
}

// ─── Shared Auth Helper ──────────────────────────────────────

function getGoogleAuth() {
    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
    let privateKey = process.env.GOOGLE_PRIVATE_KEY;

    if (privateKey) {
        // Bulletproof PEM parser (menahan segala bug Coolify & Nixpacks)
        privateKey = privateKey
            .replace(/^"|"$/g, '') // Hapus tanda kutip jika ada
            .replace(/\\+n/g, '\n') // Ubah \n atau \\n menjadi enter asli
            .replace(/-----BEGIN PRIVATE KEY-----/g, '-----BEGIN_PRIVATE_KEY-----')
            .replace(/-----END PRIVATE KEY-----/g, '-----END_PRIVATE_KEY-----')
            .replace(/\s+/g, '\n') // Ubah semua spasi (hasil flattening Nixpacks) jadi enter
            .replace(/-----BEGIN_PRIVATE_KEY-----/g, '-----BEGIN PRIVATE KEY-----')
            .replace(/-----END_PRIVATE_KEY-----/g, '-----END PRIVATE KEY-----');
    }

    if (!clientEmail || !privateKey) {
        return null;
    }

    return new google.auth.GoogleAuth({
        credentials: {
            client_email: clientEmail,
            private_key: privateKey,
        },
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
}

// ─── Existing: Fetch SLA Orders ──────────────────────────────

export async function fetchSpreadsheetOrders(): Promise<SheetOrder[]> {
    try {
        const auth = getGoogleAuth();
        const spreadsheetId = process.env.SPREADSHEET_ID;

        if (!auth || !spreadsheetId) {
            console.warn('[Google Sheets] Kredensial tidak lengkap di .env, mode sheets di-skip');
            return [];
        }

        const sheets = google.sheets({ version: 'v4', auth });
        
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'Orders!A:Z', 
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0) {
            console.log('[Google Sheets] Sheet "Orders" kosong atau tidak ditemukan.');
            return [];
        }

        const headers: string[] = rows[0];
        const headerLower = headers.map(h => h ? String(h).toLowerCase().trim() : '');
        
        let idxDO = headerLower.findIndex(h => h === 'nama do' || h === 'no do' || h === 'do' || h === 'nomor tugas');
        if (idxDO === -1) {
             idxDO = headerLower.findIndex(h => h.includes('do') || h.includes('tugas'));
        }

        const idxTime = headerLower.findIndex(h => h === 'waktu tugas diselesaikan' || h.includes('waktu tugas diselesaikan'));

        if (idxDO === -1 || idxTime === -1) {
            console.log(`[Google Sheets] Kolom tidak ditemukan. DO Index: ${idxDO}, Time Index: ${idxTime}. Headers: ${headers.join(', ')}`);
            return [];
        }

        const orders: SheetOrder[] = [];

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const doName = row[idxDO];
            const completedAt = row[idxTime];

            if (doName) {
                orders.push({
                    doName: String(doName).trim(),
                    completedAt: completedAt ? String(completedAt).trim() : null,
                });
            }
        }

        console.log(`[Google Sheets] Berhasil mengambil ${orders.length} baris dari sheet.`);
        return orders;
    } catch (error: any) {
        console.error('[Google Sheets] Fetch Error:', error.message);
        return [];
    }
}

// ─── NEW: Fetch Dispatch Orders from TMS ─────────────────────

// Column header mappings (case-insensitive matching)
const DISPATCH_COLUMN_MAP: Record<keyof Omit<DispatchRecord, 'isDeparted' | 'isCompleted' | 'durationMinutes'>, string[]> = {
    scheduledDate: ['dijadwalkan tanggal', 'tanggal'],
    customerName: ['nama pelanggan', 'customer'],
    customerCode: ['kode pelanggan', 'kode customer'],
    taskNumber: ['nomor tugas', 'no tugas', 'no do'],
    taskType: ['jenis tugas', 'tipe tugas'],
    destination: ['lokasi tujuan', 'tujuan', 'alamat'],
    officeLocation: ['lokasi kantor', 'kantor'],
    assignmentStatus: ['status penugasan', 'status'],
    driver: ['driver bertugas', 'driver', 'nama driver'],
    coDriver: ['co-driver', 'co driver', 'codriver'],
    proofOfDelivery: ['bukti selesai', 'bukti'],
    completionDetails: ['rincian penyelesaian', 'rincian', 'catatan'],
    taskCreatedAt: ['waktu tugas dibuat', 'dibuat'],
    assignedAt: ['waktu penugasan', 'penugasan'],
    taskStartedAt: ['waktu tugas dijalankan', 'dijalankan'],
    taskCompletedAt: ['waktu tugas diselesaikan', 'diselesaikan'],
};

function findColumnIndex(headers: string[], aliases: string[]): number {
    const headerLower = headers.map(h => h ? String(h).toLowerCase().trim() : '');
    for (const alias of aliases) {
        const idx = headerLower.findIndex(h => h === alias || h.includes(alias));
        if (idx !== -1) return idx;
    }
    return -1;
}

function parseDispatchDatetime(val: string): Date | null {
    if (!val) return null;
    // Try formats: "14/05/2025 11:20", "5/14/2025 11:20:00", "2025-05-14T11:20:00"
    const trimmed = val.trim();
    
    // dd/mm/yyyy HH:mm or dd/mm/yyyy HH:mm:ss
    const dmyMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (dmyMatch) {
        const [, d, m, y, hh, mm, ss] = dmyMatch;
        return new Date(parseInt(y), parseInt(m) - 1, parseInt(d), parseInt(hh), parseInt(mm), parseInt(ss || '0'));
    }

    // mm/dd/yyyy HH:mm (US format — Google Sheets default)
    const mdyMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (mdyMatch) {
        const [, m, d, y, hh, mm, ss] = mdyMatch;
        const date = new Date(parseInt(y), parseInt(m) - 1, parseInt(d), parseInt(hh), parseInt(mm), parseInt(ss || '0'));
        if (!isNaN(date.getTime())) return date;
    }

    // ISO format
    const iso = new Date(trimmed);
    if (!isNaN(iso.getTime())) return iso;

    return null;
}

function calcDurationMinutes(startStr: string, endStr: string): number | null {
    const start = parseDispatchDatetime(startStr);
    const end = parseDispatchDatetime(endStr);
    if (!start || !end) return null;
    const diff = (end.getTime() - start.getTime()) / 60000;
    return diff > 0 ? Math.round(diff) : null;
}

/**
 * Fetch dispatch/fleet data from TMS Google Sheets.
 * Sheet: "Delivery Orders"
 * Spreadsheet: DISPATCH_SPREADSHEET_ID
 */
export let lastDispatchError: string | null = null;
export let lastDispatchSheetNames: string[] = [];
export let lastDispatchHeaders: string[] = [];
export let lastDispatchColIdx: Record<string, number> = {};
export let lastDispatchRowCount: number = 0;

export async function fetchDispatchOrders(): Promise<DispatchRecord[]> {
    lastDispatchError = null;
    lastDispatchSheetNames = [];
    lastDispatchHeaders = [];
    lastDispatchColIdx = {};
    lastDispatchRowCount = 0;
    try {
        const auth = getGoogleAuth();
        const spreadsheetId = process.env.DISPATCH_SPREADSHEET_ID;

        if (!auth) {
            console.warn('[Dispatch Sheets] Google credentials tidak ditemukan');
            return [];
        }
        if (!spreadsheetId) {
            console.warn('[Dispatch Sheets] DISPATCH_SPREADSHEET_ID tidak diset di .env');
            return [];
        }

        const sheets = google.sheets({ version: 'v4', auth });

        // First: auto-discover sheet names
        try {
            const meta = await sheets.spreadsheets.get({ spreadsheetId });
            lastDispatchSheetNames = (meta.data.sheets || []).map(s => s.properties?.title || '').filter(Boolean);
            console.log(`[Dispatch Sheets] Available sheets: ${lastDispatchSheetNames.join(', ')}`);
        } catch (e: any) {
            console.warn(`[Dispatch Sheets] Could not list sheets: ${e.message}`);
            lastDispatchError = `Failed to list sheets: ${e.message}`;
        }

        // Try exact name first, then fallback to first sheet
        let sheetName = 'Delivery Orders';
        if (lastDispatchSheetNames.length > 0 && !lastDispatchSheetNames.includes(sheetName)) {
            // Try case-insensitive match
            const match = lastDispatchSheetNames.find(s => s.toLowerCase() === sheetName.toLowerCase());
            if (match) {
                sheetName = match;
            } else {
                // Use first sheet as fallback
                sheetName = lastDispatchSheetNames[0];
                console.warn(`[Dispatch Sheets] Sheet "Delivery Orders" not found. Using "${sheetName}" instead.`);
            }
        }

        console.log(`[Dispatch Sheets] Reading sheet: "${sheetName}"`);

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `'${sheetName}'!A:Z`,
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0) {
            console.log('[Dispatch Sheets] Sheet kosong.');
            lastDispatchError = 'Sheet kosong (0 rows)';
            return [];
        }

        // Auto-detect header row: scan first 20 rows for one containing known column names
        let headerRowIdx = -1;
        const HEADER_MARKERS = ['nomor tugas', 'driver bertugas', 'status penugasan', 'jenis tugas', 'nama pelanggan'];
        
        for (let i = 0; i < Math.min(rows.length, 20); i++) {
            const row = rows[i];
            if (!row || row.length === 0) continue;
            const rowLower = row.map((c: any) => c ? String(c).toLowerCase().trim() : '');
            const matchCount = HEADER_MARKERS.filter(marker => rowLower.some((cell: string) => cell.includes(marker))).length;
            if (matchCount >= 2) {
                headerRowIdx = i;
                console.log(`[Dispatch Sheets] Header row found at index ${i} (row ${i + 1})`);
                break;
            }
        }

        if (headerRowIdx === -1) {
            const sample = rows.slice(0, 5).map((r: any[], idx: number) => `Row ${idx + 1}: [${(r || []).slice(0, 5).join(', ')}]`).join(' | ');
            lastDispatchError = `Header row not found in first 20 rows. Sample: ${sample}`;
            lastDispatchHeaders = rows[0] || [];
            lastDispatchRowCount = rows.length;
            return [];
        }

        const headers: string[] = rows[headerRowIdx];
        lastDispatchHeaders = headers;
        const dataStartIdx = headerRowIdx + 1;
        lastDispatchRowCount = rows.length - dataStartIdx;
        console.log(`[Dispatch Sheets] Headers (row ${headerRowIdx + 1}): ${headers.join(' | ')}`);
        console.log(`[Dispatch Sheets] Data rows: ${lastDispatchRowCount}`);

        // Map column indices
        const colIdx: Record<string, number> = {};
        for (const [field, aliases] of Object.entries(DISPATCH_COLUMN_MAP)) {
            colIdx[field] = findColumnIndex(headers, aliases);
        }
        lastDispatchColIdx = colIdx;

        // Log unmapped columns
        const unmapped = Object.entries(colIdx).filter(([, idx]) => idx === -1).map(([k]) => k);
        if (unmapped.length > 0) {
            console.warn(`[Dispatch Sheets] Kolom tidak ditemukan: ${unmapped.join(', ')}`);
        }

        // Must have taskNumber at minimum
        if (colIdx.taskNumber === -1) {
            lastDispatchError = `Kolom "Nomor Tugas" tidak ditemukan. Headers: ${headers.join(', ')}`;
            return [];
        }

        const records: DispatchRecord[] = [];

        for (let i = dataStartIdx; i < rows.length; i++) {
            const row = rows[i];
            const taskNumber = row[colIdx.taskNumber] ? String(row[colIdx.taskNumber]).trim() : '';
            if (!taskNumber) continue;

            const get = (field: string): string => {
                const idx = colIdx[field];
                if (idx === -1 || idx === undefined) return '';
                return row[idx] ? String(row[idx]).trim() : '';
            };

            const taskStartedAt = get('taskStartedAt');
            const taskCompletedAt = get('taskCompletedAt');

            records.push({
                scheduledDate: get('scheduledDate'),
                customerName: get('customerName'),
                customerCode: get('customerCode'),
                taskNumber,
                taskType: get('taskType'),
                destination: get('destination'),
                officeLocation: get('officeLocation'),
                assignmentStatus: get('assignmentStatus'),
                driver: get('driver'),
                coDriver: get('coDriver'),
                proofOfDelivery: get('proofOfDelivery'),
                completionDetails: get('completionDetails'),
                taskCreatedAt: get('taskCreatedAt'),
                assignedAt: get('assignedAt'),
                taskStartedAt,
                taskCompletedAt,
                // Derived fields
                isDeparted: !!taskStartedAt,
                isCompleted: !!taskCompletedAt,
                durationMinutes: calcDurationMinutes(taskStartedAt, taskCompletedAt),
            });
        }

        console.log(`[Dispatch Sheets] Berhasil fetch ${records.length} dispatch records dari TMS.`);
        return records;
    } catch (error: any) {
        lastDispatchError = error.message;
        console.error('[Dispatch Sheets] Fetch Error:', error.message);
        return [];
    }
}

/**
 * Build a lookup map: DO number → DispatchRecord
 * Used by Kontrol SO and Delivery Routing to show departure status
 */
export function buildDispatchLookup(records: DispatchRecord[]): Map<string, DispatchRecord> {
    const map = new Map<string, DispatchRecord>();
    for (const r of records) {
        // Key: full DO number (e.g., "DO.645.2025.05.00513")
        map.set(r.taskNumber, r);
    }
    return map;
}
