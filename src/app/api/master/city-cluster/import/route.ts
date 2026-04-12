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
            // Support flexible column names
            const rawCity = row['Kota'] || row['City'] || row['kota'] || row['city'] || '';
            const province = row['Provinsi'] || row['Province'] || row['provinsi'] || '';
            const area = row['Area'] || row['area'] || '';
            const cluster = row['Cluster'] || row['cluster'] || '';
            const subCluster = row['Sub Cluster'] || row['SubCluster'] || row['sub_cluster'] || row['Sub cluster'] || '';

            if (!rawCity || !area || !cluster) {
                skipped++;
                if (rawCity) errors.push(`Baris ${i + 2}: "${rawCity}" - area/cluster kosong`);
                continue;
            }

            // Normalize city name
            const normalized = rawCity.trim().replace(/^(Kab\.\s*|Kab\s+|Kabupaten\s+|Kota\s+)/i, '');
            const cityName = normalized.charAt(0).toUpperCase() + normalized.slice(1);

            try {
                await prisma.cityCluster.upsert({
                    where: { city: cityName },
                    update: {
                        province: province?.trim() || null,
                        area: area.trim(),
                        cluster: cluster.trim(),
                        subCluster: subCluster?.trim() || null,
                    },
                    create: {
                        city: cityName,
                        province: province?.trim() || null,
                        area: area.trim(),
                        cluster: cluster.trim(),
                        subCluster: subCluster?.trim() || null,
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
