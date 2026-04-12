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
        const { itemNo, itemName, weightKg, lengthCm, widthCm, heightCm } = body;

        if (!itemNo) {
            return NextResponse.json({ error: 'itemNo (kode barang) wajib diisi' }, { status: 400 });
        }

        const result = await prisma.productDimension.upsert({
            where: { itemNo: itemNo.trim() },
            update: {
                itemName: itemName?.trim() || null,
                weightKg: weightKg != null ? parseFloat(weightKg) : null,
                lengthCm: lengthCm != null ? parseFloat(lengthCm) : null,
                widthCm: widthCm != null ? parseFloat(widthCm) : null,
                heightCm: heightCm != null ? parseFloat(heightCm) : null,
            },
            create: {
                itemNo: itemNo.trim(),
                itemName: itemName?.trim() || null,
                weightKg: weightKg != null ? parseFloat(weightKg) : null,
                lengthCm: lengthCm != null ? parseFloat(lengthCm) : null,
                widthCm: widthCm != null ? parseFloat(widthCm) : null,
                heightCm: heightCm != null ? parseFloat(heightCm) : null,
            },
        });

        return NextResponse.json(result);
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

// DELETE: Remove a product dimension by id
export async function DELETE(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');
        if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

        await prisma.productDimension.delete({ where: { id: parseInt(id) } });
        return NextResponse.json({ success: true });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
