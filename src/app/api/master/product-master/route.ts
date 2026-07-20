export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

let schemaMigrated = false;
async function ensureSchema() {
    if (schemaMigrated) return;
    try {
        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "ProductMaster" (
                "id" SERIAL PRIMARY KEY,
                "itemNo" TEXT UNIQUE NOT NULL,
                "itemName" TEXT,
                "unit1Name" TEXT,
                "displayUnit" TEXT,
                "conversionRatio" DOUBLE PRECISION,
                "shouldConvert" BOOLEAN DEFAULT false,
                "category" TEXT,
                "notes" TEXT,
                "createdAt" TIMESTAMP DEFAULT NOW(),
                "updatedAt" TIMESTAMP DEFAULT NOW()
            )
        `);
        schemaMigrated = true;
    } catch (e: any) {
        console.log('[Migration] ProductMaster table check:', e.message);
        schemaMigrated = true;
    }
}

export async function GET() {
    try {
        await ensureSchema();
        const data = await prisma.productMaster.findMany({
            orderBy: { itemNo: 'asc' },
        });
        return NextResponse.json(data);
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        await ensureSchema();
        const body = await request.json();
        const { id, itemNo, itemName, unit1Name, displayUnit, conversionRatio, shouldConvert, category, notes } = body;

        if (!itemNo) {
            return NextResponse.json({ error: 'Kode Barang wajib diisi' }, { status: 400 });
        }

        let result;
        if (id) {
            result = await prisma.productMaster.update({
                where: { id: Number(id) },
                data: {
                    itemNo: itemNo.trim(),
                    itemName: itemName ? itemName.trim() : null,
                    unit1Name: unit1Name ? unit1Name.trim() : null,
                    displayUnit: displayUnit ? displayUnit.trim() : null,
                    conversionRatio: conversionRatio != null ? Number(conversionRatio) : null,
                    shouldConvert: Boolean(shouldConvert),
                    category: category ? category.trim() : null,
                    notes: notes ? notes.trim() : null,
                }
            });
        } else {
            result = await prisma.productMaster.upsert({
                where: { itemNo: itemNo.trim() },
                update: {
                    itemName: itemName ? itemName.trim() : null,
                    unit1Name: unit1Name ? unit1Name.trim() : null,
                    displayUnit: displayUnit ? displayUnit.trim() : null,
                    conversionRatio: conversionRatio != null ? Number(conversionRatio) : null,
                    shouldConvert: Boolean(shouldConvert),
                    category: category ? category.trim() : null,
                    notes: notes ? notes.trim() : null,
                },
                create: {
                    itemNo: itemNo.trim(),
                    itemName: itemName ? itemName.trim() : null,
                    unit1Name: unit1Name ? unit1Name.trim() : null,
                    displayUnit: displayUnit ? displayUnit.trim() : null,
                    conversionRatio: conversionRatio != null ? Number(conversionRatio) : null,
                    shouldConvert: Boolean(shouldConvert),
                    category: category ? category.trim() : null,
                    notes: notes ? notes.trim() : null,
                },
            });
        }

        return NextResponse.json(result);
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        await ensureSchema();
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');
        const idsParam = searchParams.get('ids');

        if (idsParam) {
            const ids = idsParam.split(',').map(id => parseInt(id)).filter(id => !isNaN(id));
            if (ids.length > 0) {
                await prisma.productMaster.deleteMany({ where: { id: { in: ids } } });
            }
            return NextResponse.json({ success: true, deletedCount: ids.length });
        } else if (id) {
            await prisma.productMaster.delete({ where: { id: parseInt(id) } });
            return NextResponse.json({ success: true });
        }

        return NextResponse.json({ error: 'id or ids required' }, { status: 400 });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
