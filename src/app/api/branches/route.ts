import { NextResponse } from 'next/server';
import { accurateClient } from '@/lib/accurate';

// ─── In-memory cache (branches don't change often) ───────────
interface Branch {
    id: number;
    name: string;
    defaultBranch: boolean;
}

interface Warehouse {
    id: number;
    name: string;
    defaultWarehouse: boolean;
    description?: string;
}

let cachedBranches: Branch[] | null = null;
let cachedWarehouses: Warehouse[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

export async function GET() {
    try {
        const now = Date.now();

        // Return from cache if fresh
        if (cachedBranches && cachedWarehouses && (now - cacheTimestamp) < CACHE_TTL) {
            return NextResponse.json({
                branches: cachedBranches,
                warehouses: cachedWarehouses,
            });
        }

        // Fetch branches
        const branchRes = await accurateClient.get('/branch/list.do', {
            params: { 'sp.pageSize': 100 }
        });
        const branches: Branch[] = (branchRes.data?.d || []).map((b: any) => ({
            id: b.id,
            name: b.name,
            defaultBranch: b.defaultBranch || false,
        }));

        // Fetch warehouses (may be multi-page)
        const allWarehouses: Warehouse[] = [];
        let page = 1;
        let hasMore = true;
        while (hasMore) {
            const whRes = await accurateClient.get('/warehouse/list.do', {
                params: { 'sp.pageSize': 100, 'sp.page': page }
            });
            const list = whRes.data?.d || [];
            list.forEach((w: any) => {
                allWarehouses.push({
                    id: w.id,
                    name: w.name,
                    defaultWarehouse: w.defaultWarehouse || false,
                    description: w.description || undefined,
                });
            });
            hasMore = list.length >= 100;
            page++;
        }

        // Cache
        cachedBranches = branches;
        cachedWarehouses = allWarehouses;
        cacheTimestamp = now;

        console.log(`[API/branches] Loaded ${branches.length} branches, ${allWarehouses.length} warehouses`);

        return NextResponse.json({
            branches,
            warehouses: allWarehouses,
        });
    } catch (error: any) {
        console.error('[API/branches] Error:', error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
