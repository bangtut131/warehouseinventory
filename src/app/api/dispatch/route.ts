export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { fetchDispatchOrders, DispatchRecord, buildDispatchLookup, lastDispatchError, lastDispatchSheetNames, lastDispatchHeaders, lastDispatchColIdx, lastDispatchRowCount } from '@/lib/google-sheets';
import { prisma } from '@/lib/prisma';

const CACHE_KEY = 'dispatch-tms-cache';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CachedDispatch {
    timestamp: number;
    data: DispatchRecord[];
}

// ─── GET: Fetch dispatch data (cached from Google Sheets) ────

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const dateFilter = searchParams.get('date'); // yyyy-mm-dd
        const driverFilter = searchParams.get('driver');
        const statusFilter = searchParams.get('status'); // departed, completed, pending
        const forceRefresh = searchParams.get('refresh') === 'true';

        // Try cache first
        let records: DispatchRecord[] | null = null;

        if (!forceRefresh) {
            try {
                const cached = await prisma.dataCache.findUnique({ where: { key: CACHE_KEY } });
                if (cached?.data) {
                    const c = cached.data as unknown as CachedDispatch;
                    const age = Date.now() - (c.timestamp || 0);
                    if (age < CACHE_TTL_MS && c.data?.length > 0) {
                        console.log(`[Dispatch API] Cache hit (${Math.round(age / 60000)}m old, ${c.data.length} records)`);
                        records = c.data;
                    }
                }
            } catch { }
        }

        // Fetch from Google Sheets if no cache
        if (!records) {
            console.log('[Dispatch API] Fetching from Google Sheets...');
            console.log('[Dispatch API] DISPATCH_SPREADSHEET_ID:', process.env.DISPATCH_SPREADSHEET_ID ? 'SET' : 'NOT SET');
            console.log('[Dispatch API] GOOGLE_CLIENT_EMAIL:', process.env.GOOGLE_CLIENT_EMAIL ? 'SET' : 'NOT SET');
            console.log('[Dispatch API] GOOGLE_PRIVATE_KEY:', process.env.GOOGLE_PRIVATE_KEY ? 'SET (' + process.env.GOOGLE_PRIVATE_KEY.length + ' chars)' : 'NOT SET');
            records = await fetchDispatchOrders();
            console.log('[Dispatch API] Fetched records:', records.length);

            // Save cache (only if we got data)
            if (records.length > 0) {
                try {
                    const cacheData: CachedDispatch = { timestamp: Date.now(), data: records };
                    await prisma.dataCache.upsert({
                        where: { key: CACHE_KEY },
                        update: { data: cacheData as any },
                        create: { key: CACHE_KEY, data: cacheData as any },
                    });
                } catch (e: any) {
                    console.warn('[Dispatch API] Cache save failed:', e.message);
                }
            }
        }

        // Debug info for troubleshooting
        const debug = {
            envDispatchId: process.env.DISPATCH_SPREADSHEET_ID ? 'SET' : 'NOT SET',
            envGoogleEmail: process.env.GOOGLE_CLIENT_EMAIL ? 'SET' : 'NOT SET',
            envGoogleKey: process.env.GOOGLE_PRIVATE_KEY ? 'SET' : 'NOT SET',
            rawFetchCount: records.length,
            lastError: lastDispatchError,
            sheetNames: lastDispatchSheetNames,
            headers: lastDispatchHeaders,
            colIdx: lastDispatchColIdx,
            dataRowCount: lastDispatchRowCount,
        };

        // Apply filters
        let filtered = records;

        if (dateFilter) {
            // Filter by scheduled date (compare yyyy-mm-dd)
            filtered = filtered.filter(r => {
                if (!r.scheduledDate) return false;
                // Parse various date formats
                const parts = r.scheduledDate.split('/');
                if (parts.length === 3) {
                    // Could be m/d/yyyy or d/m/yyyy — normalize
                    const [a, b, c] = parts.map(Number);
                    // Assume m/d/yyyy (Google Sheets US default)
                    const dateStr = `${c}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`;
                    return dateStr === dateFilter;
                }
                return r.scheduledDate.includes(dateFilter);
            });
        }

        if (driverFilter) {
            const dl = driverFilter.toLowerCase();
            filtered = filtered.filter(r =>
                r.driver.toLowerCase().includes(dl) || r.coDriver.toLowerCase().includes(dl)
            );
        }

        if (statusFilter) {
            switch (statusFilter) {
                case 'completed':
                    filtered = filtered.filter(r => r.isCompleted);
                    break;
                case 'departed':
                    filtered = filtered.filter(r => r.isDeparted && !r.isCompleted);
                    break;
                case 'pending':
                    filtered = filtered.filter(r => !r.isDeparted);
                    break;
            }
        }

        // Compute summary stats
        const totalTasks = filtered.length;
        const completed = filtered.filter(r => r.isCompleted).length;
        const departed = filtered.filter(r => r.isDeparted && !r.isCompleted).length;
        const pending = filtered.filter(r => !r.isDeparted).length;

        // Driver summary
        const driverMap = new Map<string, { count: number; completed: number; totalDuration: number; trips: number }>();
        filtered.forEach(r => {
            if (!r.driver) return;
            const d = driverMap.get(r.driver) || { count: 0, completed: 0, totalDuration: 0, trips: 0 };
            d.count++;
            if (r.isCompleted) d.completed++;
            if (r.durationMinutes && r.durationMinutes > 0) {
                d.totalDuration += r.durationMinutes;
                d.trips++;
            }
            driverMap.set(r.driver, d);
        });

        const drivers = Array.from(driverMap.entries()).map(([name, stats]) => ({
            name,
            totalTasks: stats.count,
            completedTasks: stats.completed,
            avgDurationMin: stats.trips > 0 ? Math.round(stats.totalDuration / stats.trips) : null,
        })).sort((a, b) => b.totalTasks - a.totalTasks);

        // All unique drivers for filter dropdown
        const allDrivers = [...new Set(records.map(r => r.driver).filter(Boolean))].sort();

        return NextResponse.json({
            records: filtered,
            summary: { totalTasks, completed, departed, pending },
            drivers,
            allDrivers,
            totalRecords: records.length,
            debug,
        });
    } catch (err: any) {
        console.error('[Dispatch API] Error:', err.message);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

// ─── POST: Manual upload Excel/CSV dispatch data ─────────────

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { records } = body;

        if (!Array.isArray(records) || records.length === 0) {
            return NextResponse.json({ error: 'Data records wajib (array)' }, { status: 400 });
        }

        // Merge with existing cache
        let existing: DispatchRecord[] = [];
        try {
            const cached = await prisma.dataCache.findUnique({ where: { key: CACHE_KEY } });
            if (cached?.data) {
                const c = cached.data as unknown as CachedDispatch;
                existing = c.data || [];
            }
        } catch { }

        // Build lookup of existing by taskNumber
        const lookup = buildDispatchLookup(existing);

        // Merge: new records override existing by taskNumber
        let added = 0;
        let updated = 0;
        for (const r of records) {
            if (!r.taskNumber) continue;
            if (lookup.has(r.taskNumber)) {
                updated++;
            } else {
                added++;
            }
            lookup.set(r.taskNumber, {
                ...r,
                isDeparted: !!r.taskStartedAt,
                isCompleted: !!r.taskCompletedAt,
                durationMinutes: r.taskStartedAt && r.taskCompletedAt ? null : null, // let client compute
            });
        }

        const merged = Array.from(lookup.values());

        // Save to cache
        const cacheData: CachedDispatch = { timestamp: Date.now(), data: merged };
        await prisma.dataCache.upsert({
            where: { key: CACHE_KEY },
            update: { data: cacheData as any },
            create: { key: CACHE_KEY, data: cacheData as any },
        });

        return NextResponse.json({
            message: `Upload berhasil: ${added} baru, ${updated} diperbarui`,
            totalRecords: merged.length,
        });
    } catch (err: any) {
        console.error('[Dispatch API] Upload error:', err.message);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
