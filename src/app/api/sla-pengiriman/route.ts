import { NextRequest, NextResponse } from 'next/server';
import { fetchDOList, fetchDODetailsInBatch, loadSOCache } from '@/lib/accurate';
import { SLADetail, SLASummary } from '@/lib/types';
import { prisma } from '@/lib/prisma';

// Parse dd/mm/yyyy to Date
function parseDate(dateStr: string): Date {
    if (!dateStr) return new Date(0);
    const parts = dateStr.split('/');
    if (parts.length === 3) {
        return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
    }
    // Try ISO format fallback
    return new Date(dateStr);
}

// Diff in calendar days
function daysBetween(dateA: Date, dateB: Date): number {
    const msPerDay = 24 * 60 * 60 * 1000;
    return Math.round((dateB.getTime() - dateA.getTime()) / msPerDay);
}

const SLA_TARGET_DAYS = 3;

// DO detail cache
const DO_DETAIL_CACHE_KEY = 'do-detail-map-cache';
const DO_DETAIL_CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

interface DODetailMapEntry {
    soNumber: string;
    doNumber: string;
    doDate: string;
    customerName: string;
    branchId?: number;
}

interface CachedDODetailMap {
    timestamp: number;
    data: Record<string, DODetailMapEntry>; // keyed by DO number
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const fromParam = searchParams.get('from');  // yyyy-mm-dd
        const toParam = searchParams.get('to');      // yyyy-mm-dd
        const branchParam = searchParams.get('branch');

        // Convert to dd/mm/yyyy for Accurate API
        const fromDate = fromParam
            ? (() => { const d = new Date(fromParam); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`; })()
            : '01/01/2025';
        const toDate = toParam
            ? (() => { const d = new Date(toParam); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`; })()
            : undefined;
        const branchId = branchParam ? parseInt(branchParam) : undefined;

        console.log(`[SLA] Fetching SLA data from=${fromDate} to=${toDate || 'now'} branch=${branchId || 'all'}`);

        // 1. Get SO data (from existing cache)
        const soCache = await loadSOCache();
        if (!soCache || soCache.length === 0) {
            return NextResponse.json({
                error: 'No SO data available. Please sync first.',
                summary: { totalSO: 0, delivered: 0, onTime: 0, late: 0, pending: 0, avgLeadTime: 0, slaPercentage: 0 },
                details: [],
            });
        }

        // Filter SOs: include all "active/approved" statuses
        // SO cache already excludes: draf, draft, ditutup, closed, void, batal
        // Valid statuses for SLA: disetujui, approved, terproses, menunggu diproses, diajukan
        const excludeFromSLA = ['draf', 'draft', 'ditutup', 'closed', 'void', 'batal'];
        let approvedSOs = soCache.filter(so => {
            const status = (so.statusName || '').toLowerCase().trim();
            return status.length > 0 && !excludeFromSLA.includes(status);
        });

        // Debug: log unique statuses found
        const uniqueStatuses = [...new Set(approvedSOs.map(so => so.statusName))];
        console.log(`[SLA] SO statuses found: ${uniqueStatuses.join(', ')} (total ${soCache.length} SOs in cache)`);

        // Filter by branch if specified
        if (branchId) {
            approvedSOs = approvedSOs.filter(so => so.branchId === branchId);
        }

        // Filter by date range
        const fromDateObj = parseDate(fromDate);
        const toDateObj = toDate ? parseDate(toDate) : new Date();
        approvedSOs = approvedSOs.filter(so => {
            const soDateObj = parseDate(so.transDate);
            return soDateObj >= fromDateObj && soDateObj <= toDateObj;
        });

        console.log(`[SLA] Found ${approvedSOs.length} SOs in date range (after branch/date filter)`);

        // 2. Get DO data
        const doList = await fetchDOList(fromDate, toDate, branchId);
        console.log(`[SLA] Got ${doList.length} DOs`);

        // 3. Get DO details (to match DO → SO)
        // Try cache first
        let doDetailMap = new Map<string, DODetailMapEntry>();
        let needFetchDetail = true;

        try {
            const cached = await prisma.dataCache.findUnique({ where: { key: DO_DETAIL_CACHE_KEY } });
            if (cached?.data) {
                const c = cached.data as unknown as CachedDODetailMap;
                const age = Date.now() - (c.timestamp || 0);
                if (age < DO_DETAIL_CACHE_TTL_MS && c.data) {
                    const entries = Object.entries(c.data);
                    entries.forEach(([k, v]) => doDetailMap.set(k, v));
                    console.log(`[SLA] Loaded ${doDetailMap.size} DO details from cache (${Math.round(age / 60000)} min old)`);
                    // Check if we have all DOs
                    const missingDOs = doList.filter(d => !doDetailMap.has(d.number));
                    if (missingDOs.length === 0) {
                        needFetchDetail = false;
                    } else {
                        console.log(`[SLA] ${missingDOs.length} DOs missing from cache, fetching details...`);
                        // Fetch only missing ones
                        const missingDetails = await fetchDODetailsInBatch(
                            missingDOs.map(d => d.id), 15,
                            (done, total) => {
                                if (done % 100 === 0 || done === total) {
                                    console.log(`[SLA] DO detail progress: ${done}/${total}`);
                                }
                            }
                        );
                        missingDetails.forEach(d => {
                            doDetailMap.set(d.doNumber, d);
                        });
                        needFetchDetail = false;
                    }
                }
            }
        } catch { }

        if (needFetchDetail && doList.length > 0) {
            console.log(`[SLA] Fetching DO details for ${doList.length} DOs...`);
            const details = await fetchDODetailsInBatch(
                doList.map(d => d.id), 15,
                (done, total) => {
                    if (done % 100 === 0 || done === total) {
                        console.log(`[SLA] DO detail progress: ${done}/${total}`);
                    }
                }
            );
            details.forEach(d => {
                doDetailMap.set(d.doNumber, d);
            });
        }

        // Save DO detail cache
        if (doDetailMap.size > 0) {
            try {
                const cacheData: CachedDODetailMap = {
                    timestamp: Date.now(),
                    data: Object.fromEntries(doDetailMap),
                };
                await prisma.dataCache.upsert({
                    where: { key: DO_DETAIL_CACHE_KEY },
                    update: { data: cacheData as any },
                    create: { key: DO_DETAIL_CACHE_KEY, data: cacheData as any },
                });
            } catch { }
        }

        // 4. Build SO → DO mapping
        const soToDO = new Map<string, { doNumber: string; doDate: string }>();
        for (const [doNumber, detail] of doDetailMap) {
            if (detail.soNumber) {
                // A SO can have multiple DOs, take the FIRST (earliest) DO date
                const existing = soToDO.get(detail.soNumber);
                if (!existing) {
                    soToDO.set(detail.soNumber, { doNumber, doDate: detail.doDate });
                } else {
                    // Compare dates — keep the earliest DO
                    const existingDate = parseDate(existing.doDate);
                    const thisDate = parseDate(detail.doDate);
                    if (thisDate < existingDate) {
                        soToDO.set(detail.soNumber, { doNumber, doDate: detail.doDate });
                    }
                }
            }
        }

        console.log(`[SLA] Matched ${soToDO.size} SOs to DOs`);

        // 5. Calculate SLA for each SO
        const slaDetails: SLADetail[] = [];
        let totalLeadTime = 0;
        let deliveredCount = 0;
        let onTimeCount = 0;
        let lateCount = 0;
        let pendingCount = 0;

        for (const so of approvedSOs) {
            const doInfo = soToDO.get(so.soNumber);
            const soDateObj = parseDate(so.transDate);

            if (doInfo && doInfo.doDate) {
                const doDateObj = parseDate(doInfo.doDate);
                const leadTime = daysBetween(soDateObj, doDateObj);
                const status = leadTime <= SLA_TARGET_DAYS ? 'ON_TIME' : 'LATE';

                slaDetails.push({
                    soNumber: so.soNumber,
                    soDate: so.transDate,
                    doNumber: doInfo.doNumber,
                    doDate: doInfo.doDate,
                    customerName: so.customerName,
                    branchId: so.branchId,
                    leadTimeDays: leadTime,
                    status,
                });

                totalLeadTime += leadTime;
                deliveredCount++;
                if (status === 'ON_TIME') onTimeCount++;
                else lateCount++;
            } else {
                slaDetails.push({
                    soNumber: so.soNumber,
                    soDate: so.transDate,
                    doNumber: null,
                    doDate: null,
                    customerName: so.customerName,
                    branchId: so.branchId,
                    leadTimeDays: null,
                    status: 'PENDING',
                });
                pendingCount++;
            }
        }

        // Sort by SO date descending
        slaDetails.sort((a, b) => {
            const dateA = parseDate(a.soDate);
            const dateB = parseDate(b.soDate);
            return dateB.getTime() - dateA.getTime();
        });

        const summary: SLASummary = {
            totalSO: approvedSOs.length,
            delivered: deliveredCount,
            onTime: onTimeCount,
            late: lateCount,
            pending: pendingCount,
            avgLeadTime: deliveredCount > 0 ? parseFloat((totalLeadTime / deliveredCount).toFixed(1)) : 0,
            slaPercentage: deliveredCount > 0 ? parseFloat(((onTimeCount / deliveredCount) * 100).toFixed(1)) : 0,
        };

        console.log(`[SLA] Result: ${summary.totalSO} SOs | ${summary.delivered} delivered (${summary.onTime} on-time, ${summary.late} late) | ${summary.pending} pending | SLA=${summary.slaPercentage}%`);

        return NextResponse.json({ summary, details: slaDetails });
    } catch (error: any) {
        console.error('[SLA] Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
