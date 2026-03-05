export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
    const entry = await prisma.dataCache.findUnique({ where: { key: 'so-outstanding-cache' } });
    if (!entry?.data) return NextResponse.json({ error: 'No cache' });

    const soList = (entry.data as any)?.data || [];
    const target = soList.find((so: any) => so.soNumber === 'SO.2026.03.00215');

    const unitStats: Record<string, number> = {};
    soList.forEach((so: any) => {
        (so.detailItems || []).forEach((item: any) => {
            const u = item.unitName || '(empty)';
            unitStats[u] = (unitStats[u] || 0) + 1;
        });
    });

    return NextResponse.json({
        totalSOs: soList.length,
        unitStats,
        targetSO: target?.detailItems || 'Not found'
    });
}
