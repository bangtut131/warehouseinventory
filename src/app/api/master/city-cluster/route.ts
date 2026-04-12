export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET: List all city-cluster mappings
export async function GET() {
    try {
        const data = await prisma.cityCluster.findMany({
            orderBy: [{ area: 'asc' }, { cluster: 'asc' }, { city: 'asc' }],
        });
        return NextResponse.json(data);
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

// POST: Upsert a city-cluster mapping
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { city, province, area, cluster, subCluster } = body;

        if (!city || !area) {
            return NextResponse.json({ error: 'Kota dan Area wajib diisi' }, { status: 400 });
        }

        const normalized = city.trim().replace(/^(Kab\.\s*|Kab\s+|Kabupaten\s+|Kota\s+)/i, '');
        const cityName = normalized.charAt(0).toUpperCase() + normalized.slice(1);

        const result = await prisma.cityCluster.upsert({
            where: { city: cityName },
            update: {
                province: province?.trim() || null,
                area: area.trim(),
                cluster: cluster?.trim() || null,
                subCluster: subCluster?.trim() || null,
            },
            create: {
                city: cityName,
                province: province?.trim() || null,
                area: area.trim(),
                cluster: cluster?.trim() || null,
                subCluster: subCluster?.trim() || null,
            },
        });

        return NextResponse.json(result);
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

// DELETE: Remove a city-cluster mapping by id
export async function DELETE(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');
        if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

        await prisma.cityCluster.delete({ where: { id: parseInt(id) } });
        return NextResponse.json({ success: true });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
