export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
    // 1. Sales cache keys
    const keys = await prisma.dataCache.findMany({
        where: { key: { startsWith: 'sales-cache-' } },
        select: { key: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: 5,
    });

    let salesCacheInfo: any = { keys: keys.map(k => ({ key: k.key, updatedAt: k.updatedAt })) };
    let itemsWithConversion: any[] = [];
    let totalItems = 0;
    let totalWithConversion = 0;

    if (keys.length > 0) {
        const entry = await prisma.dataCache.findUnique({ where: { key: keys[0].key } });
        const data = (entry?.data as any)?.data || {};
        totalItems = Object.keys(data).length;
        for (const [itemNo, val] of Object.entries(data)) {
            const v = val as any;
            if (v.unitConversion > 0) {
                totalWithConversion++;
                if (itemsWithConversion.length < 15) {
                    itemsWithConversion.push({ itemNo, unitConversion: v.unitConversion, salesUnitName: v.salesUnitName });
                }
            }
        }
    }
    salesCacheInfo.totalItems = totalItems;
    salesCacheInfo.totalWithConversion = totalWithConversion;
    salesCacheInfo.samples = itemsWithConversion;

    // 2. SO cache unitName distribution
    const soCacheEntry = await prisma.dataCache.findUnique({ where: { key: 'so-outstanding-cache' } });
    const unitDist: Record<string, number> = {};
    let soCount = 0;
    if (soCacheEntry?.data) {
        const soList = (soCacheEntry.data as any)?.items || [];
        soCount = soList.length;
        for (const so of soList) {
            for (const item of (so.detailItems || [])) {
                const u = item.unitName || '(empty)';
                unitDist[u] = (unitDist[u] || 0) + 1;
            }
        }
    }

    // 3. All DataCache keys
    const allKeys = await prisma.dataCache.findMany({ select: { key: true } });

    return NextResponse.json({
        salesCache: salesCacheInfo,
        soCache: { soCount, unitDistribution: unitDist },
        allCacheKeys: allKeys.map(k => k.key),
    });
}
