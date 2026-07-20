export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import * as XLSX from 'xlsx';

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const file = formData.get('file') as File;
        if (!file) {
            return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
        }

        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(Buffer.from(buffer), { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        
        // Parse raw data
        const rows = XLSX.utils.sheet_to_json(sheet) as Record<string, any>[];
        
        let createdCount = 0;
        let updatedCount = 0;

        for (const row of rows) {
            let itemNo, itemName, unit1Name, displayUnit, conversionRatio, shouldConvert, category, notes;
            
            for (const key of Object.keys(row)) {
                const lowerKey = key.toLowerCase().trim();
                const value = row[key];
                
                if (lowerKey === 'kode barang' || lowerKey === 'itemno') itemNo = String(value);
                else if (lowerKey === 'nama barang' || lowerKey === 'itemname') itemName = String(value);
                else if (lowerKey === 'unit asli' || lowerKey === 'unit1name') unit1Name = String(value);
                else if (lowerKey === 'unit tampilan' || lowerKey === 'displayunit') displayUnit = String(value);
                else if (lowerKey === 'rasio konversi' || lowerKey === 'conversionratio') conversionRatio = Number(value);
                else if (lowerKey === 'konversi aktif' || lowerKey === 'shouldconvert') {
                    const strVal = String(value).toLowerCase().trim();
                    shouldConvert = (strVal === 'ya' || strVal === 'true' || value === true);
                }
                else if (lowerKey === 'kategori' || lowerKey === 'category') category = String(value);
                else if (lowerKey === 'catatan' || lowerKey === 'notes') notes = String(value);
            }

            if (!itemNo) continue;

            const existing = await prisma.productMaster.findUnique({
                where: { itemNo: itemNo.trim() }
            });

            const dataToSave = {
                itemName: itemName?.trim(),
                unit1Name: unit1Name?.trim(),
                displayUnit: displayUnit?.trim(),
                conversionRatio: conversionRatio != null && !isNaN(conversionRatio) ? conversionRatio : null,
                shouldConvert: Boolean(shouldConvert),
                category: category?.trim(),
                notes: notes?.trim()
            };

            if (existing) {
                await prisma.productMaster.update({
                    where: { itemNo: itemNo.trim() },
                    data: dataToSave
                });
                updatedCount++;
            } else {
                await prisma.productMaster.create({
                    data: {
                        itemNo: itemNo.trim(),
                        ...dataToSave
                    }
                });
                createdCount++;
            }
        }

        return NextResponse.json({ 
            success: true, 
            created: createdCount, 
            updated: updatedCount, 
            total: createdCount + updatedCount 
        });

    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
