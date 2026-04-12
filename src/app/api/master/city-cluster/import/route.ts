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
            
            // Normalize keys to lowercase for flexible matching
            const keys = Object.keys(row);
            const getVal = (possibleNames: string[]) => {
                const foundKey = keys.find(k => possibleNames.some(p => k.toLowerCase().includes(p.toLowerCase())));
                return foundKey ? row[foundKey] : undefined;
            };

            const rawCity = getVal(['kota', 'city', 'kab']) || getVal(['regency', 'daerah']);
            const province = getVal(['provinsi', 'province', 'prov']);
            const area = getVal(['area', 'wilayah']);
            const cluster = getVal(['cluster', 'klaster']);
            const subCluster = getVal(['sub cluster', 'subcluster', 'sub_cluster', 'sub-cluster']);

            if (!rawCity || !area) {
                skipped++;
                errors.push(`Baris ${i + 2}: Kolom wajib tidak ditemukan. Kota/Kab: ${rawCity || 'Kosong'}, Area: ${area || 'Kosong'}`);
                if (i === 0) {
                    errors.push(`Info: Nama kolom yang terdeteksi di Excel Anda adalah: [${keys.join(', ')}]`);
                }
                continue;
            }

            // Normalize city name
            const normalized = String(rawCity).trim().replace(/^(Kab\.\s*|Kab\s+|Kabupaten\s+|Kota\s+)/i, '');
            const cityName = normalized.charAt(0).toUpperCase() + normalized.slice(1);

            try {
                await prisma.cityCluster.upsert({
                    where: { city: cityName },
                    update: {
                        province: province ? String(province).trim() : null,
                        area: String(area).trim(),
                        cluster: cluster ? String(cluster).trim() : null,
                        subCluster: subCluster ? String(subCluster).trim() : null,
                    },
                    create: {
                        city: cityName,
                        province: province ? String(province).trim() : null,
                        area: String(area).trim(),
                        cluster: cluster ? String(cluster).trim() : null,
                        subCluster: subCluster ? String(subCluster).trim() : null,
                    },
                });
                imported++;
            } catch (e: any) {
                errors.push(`Baris ${i + 2}: "${cityName}" - ${e.message}`);
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
