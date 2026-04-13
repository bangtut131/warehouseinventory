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
        const { id, city, province, area, cluster, subCluster } = body;

        if (!city || !area) {
            return NextResponse.json({ error: 'Kota dan Area wajib diisi' }, { status: 400 });
        }

        const normalized = city.trim().replace(/^(Kab\.\s*|Kab\s+|Kabupaten\s+|Kota\s+)/i, '');
        const cityName = normalized.charAt(0).toUpperCase() + normalized.slice(1);

        let result;
        if (id) {
            result = await prisma.cityCluster.update({
                where: { id: Number(id) },
                data: {
                    city: cityName,
                    province: province?.trim() || null,
                    area: area.trim(),
                    cluster: cluster?.trim() || null,
                    subCluster: subCluster?.trim() || null,
                }
            });
        } else {
            result = await prisma.cityCluster.upsert({
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
        }

        return NextResponse.json(result);
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

// DELETE: Remove a city-cluster mapping by id or multiple ids
export async function DELETE(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');
        const idsParam = searchParams.get('ids');

        if (idsParam) {
            const ids = idsParam.split(',').map(id => parseInt(id)).filter(id => !isNaN(id));
            if (ids.length > 0) {
                await prisma.cityCluster.deleteMany({ where: { id: { in: ids } } });
            }
            return NextResponse.json({ success: true, deletedCount: ids.length });
        } else if (id) {
            await prisma.cityCluster.delete({ where: { id: parseInt(id) } });
            return NextResponse.json({ success: true });
        }

        return NextResponse.json({ error: 'id or ids required' }, { status: 400 });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
