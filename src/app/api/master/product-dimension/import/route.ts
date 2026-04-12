export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import * as XLSX from 'xlsx';

export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();
        const file = formData.get('file') as File;
        if (!file) return NextResponse.json({ error: 'File wajib diupload' }, { status: 400 });

        const buffer = Buffer.from(await file.arrayBuffer());
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows: any[] = XLSX.utils.sheet_to_json(sheet);

        if (rows.length === 0) {
            return NextResponse.json({ error: 'File kosong' }, { status: 400 });
        }

        let imported = 0;
        let skipped = 0;
        const errors: string[] = [];

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const keys = Object.keys(row);
            const getVal = (possibleNames: string[]) => {
                const foundKey = keys.find(k => possibleNames.some(p => k.toLowerCase().includes(p.toLowerCase())));
                return foundKey ? row[foundKey] : undefined;
            };

            const itemNo = getVal(['kode', 'no', 'code', 'itemno']);
            const itemName = getVal(['nama', 'name', 'itemname', 'deskripsi']);
            const weightKg = getVal(['berat', 'weight']);
            const lengthCm = getVal(['panjang', 'length']);
            const widthCm = getVal(['lebar', 'width']);
            const heightCm = getVal(['tinggi', 'height']);

            if (!itemNo) {
                skipped++;
                errors.push(`Baris ${i + 2}: Kolom Kode Barang tidak ditemukan`);
                if (i === 0) {
                    errors.push(`Info: Nama kolom yang terdeteksi di Excel Anda adalah: [${keys.join(', ')}]`);
                }
                continue;
            }

            try {
                await prisma.productDimension.upsert({
                    where: { itemNo: String(itemNo).trim() },
                    update: {
                        itemName: itemName ? String(itemName).trim() : null,
                        weightKg: weightKg != null ? parseFloat(weightKg) : null,
                        lengthCm: lengthCm != null ? parseFloat(lengthCm) : null,
                        widthCm: widthCm != null ? parseFloat(widthCm) : null,
                        heightCm: heightCm != null ? parseFloat(heightCm) : null,
                    },
                    create: {
                        itemNo: String(itemNo).trim(),
                        itemName: itemName ? String(itemName).trim() : null,
                        weightKg: weightKg != null ? parseFloat(weightKg) : null,
                        lengthCm: lengthCm != null ? parseFloat(lengthCm) : null,
                        widthCm: widthCm != null ? parseFloat(widthCm) : null,
                        heightCm: heightCm != null ? parseFloat(heightCm) : null,
                    },
                });
                imported++;
            } catch (e: any) {
                errors.push(`Baris ${i + 2}: "${itemNo}" - ${e.message}`);
                skipped++;
            }
        }

        return NextResponse.json({
            success: true,
            imported,
            skipped,
            total: rows.length,
            errors: errors.slice(0, 10),
        });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
