import { google } from 'googleapis';

export interface SheetOrder {
    doName: string;
    completedAt: string | null;
}

export async function fetchSpreadsheetOrders(): Promise<SheetOrder[]> {
    try {
        const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
        const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
        const spreadsheetId = process.env.SPREADSHEET_ID;

        if (!clientEmail || !privateKey || !spreadsheetId) {
            console.warn('[Google Sheets] Kredensial tidak lengkap di .env, mode sheets di-skip');
            return [];
        }

        const auth = new google.auth.GoogleAuth({
            credentials: {
                client_email: clientEmail,
                private_key: privateKey,
            },
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        });

        const sheets = google.sheets({ version: 'v4', auth });
        
        // Fetch data dari sheet "Orders"
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
        
        // Cari index kolom "Nama Tugas" atau "DO Name" yang relevan.
        // Berdasarkan info dari user: "menggunakan data nama DO" dan "Waktu Tugas Diselesaikan"
        const doColumnIndex = headers.findIndex(h => 
            h.toLowerCase().includes('do') || h.toLowerCase().includes('nama do') || h.toLowerCase().includes('tugas') || h.toLowerCase().includes('order')
        ); // You might need to adjust this depending on exact header, assuming we just try to find it or we can check exact match
        
        // Let's do exact match or includes based on common terms.
        // For DO, user said "di spreadsheet menggunakan data nama DO", so header might just be "Nama DO".
        // Let's search broadly just in case.
        const headerLower = headers.map(h => h ? String(h).toLowerCase().trim() : '');
        
        let idxDO = headerLower.findIndex(h => h === 'nama do' || h === 'no do' || h === 'do' || h === 'nomor tugas');
        if (idxDO === -1) {
             // Fallback
             idxDO = headerLower.findIndex(h => h.includes('do') || h.includes('tugas'));
        }

        const idxTime = headerLower.findIndex(h => h === 'waktu tugas diselesaikan' || h.includes('waktu tugas diselesaikan'));

        if (idxDO === -1 || idxTime === -1) {
            console.log(`[Google Sheets] Kolom tidak ditemukan. DO Index: ${idxDO}, Time Index: ${idxTime}. Headers: ${headers.join(', ')}`);
            return [];
        }

        const orders: SheetOrder[] = [];

        // Loop dari row ke-2 (index 1) sampai akhir
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
