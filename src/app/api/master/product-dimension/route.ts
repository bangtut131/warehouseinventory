export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET: List all product dimensions
export async function GET() {
    try {
        const data = await prisma.productDimension.findMany({
            orderBy: { itemNo: 'asc' },
        });
        return NextResponse.json(data);
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

// POST: Upsert a product dimension
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { id, itemNo, itemName, weightKg, lengthCm, widthCm, heightCm } = body;

        if (!itemNo) {
            return NextResponse.json({ error: 'Kode Barang wajib diisi' }, { status: 400 });
        }

        let result;
        if (id) {
            result = await prisma.productDimension.update({
                where: { id: Number(id) },
                data: {
                    itemNo: itemNo.trim(),
                    itemName: itemName ? itemName.trim() : null,
                    weightKg: weightKg != null ? Number(weightKg) : null,
                    lengthCm: lengthCm != null ? Number(lengthCm) : null,
                    widthCm: widthCm != null ? Number(widthCm) : null,
                    heightCm: heightCm != null ? Number(heightCm) : null,
                }
            });
        } else {
            result = await prisma.productDimension.upsert({
                where: { itemNo: itemNo.trim() },
                update: {
                    itemName: itemName ? itemName.trim() : null,
                    weightKg: weightKg != null ? Number(weightKg) : null,
                    lengthCm: lengthCm != null ? Number(lengthCm) : null,
                    widthCm: widthCm != null ? Number(widthCm) : null,
                    heightCm: heightCm != null ? Number(heightCm) : null,
                },
                create: {
                    itemNo: itemNo.trim(),
                    itemName: itemName ? itemName.trim() : null,
                    weightKg: weightKg != null ? Number(weightKg) : null,
                    lengthCm: lengthCm != null ? Number(lengthCm) : null,
                    widthCm: widthCm != null ? Number(widthCm) : null,
                    heightCm: heightCm != null ? Number(heightCm) : null,
                },
            });
        }

        return NextResponse.json(result);
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

// DELETE: Remove a product dimension by id or multiple ids
export async function DELETE(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');
        const idsParam = searchParams.get('ids');

        if (idsParam) {
            const ids = idsParam.split(',').map(id => parseInt(id)).filter(id => !isNaN(id));
            if (ids.length > 0) {
                await prisma.productDimension.deleteMany({ where: { id: { in: ids } } });
            }
            return NextResponse.json({ success: true, deletedCount: ids.length });
        } else if (id) {
            await prisma.productDimension.delete({ where: { id: parseInt(id) } });
            return NextResponse.json({ success: true });
        }

        return NextResponse.json({ error: 'id or ids required' }, { status: 400 });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
