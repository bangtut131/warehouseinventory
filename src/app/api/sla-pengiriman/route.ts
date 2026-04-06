import { NextRequest, NextResponse } from 'next/server';
import { fetchDOList, fetchDODetailsInBatch, loadSOCache, loadSLASOCache } from '@/lib/accurate';
import { SLADetail, SLASummary } from '@/lib/types';
import { prisma } from '@/lib/prisma';
import { fetchSpreadsheetOrders } from '@/lib/google-sheets';

// Parse dd/mm/yyyy from Accurate to Date (midnight local time)
function parseDate(dateStr: string): Date {
    if (!dateStr) return new Date(0);
    const parts = dateStr.split('/');
    if (parts.length === 3) {
        return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
    }
    return new Date(dateStr);
}

// Parse yyyy-mm-dd from URL to Date (midnight local time)
function parseUrlDate(dateStr: string | null, isEndDate: boolean = false): Date {
    if (!dateStr) {
        if (isEndDate) return new Date(); // now
        return new Date(2025, 0, 1); // Jan 1, 2025 fallback
    }
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        if (isEndDate) {
            // Include the whole end day (23:59:59)
            d.setHours(23, 59, 59, 999);
        }
        return d;
    }
    return new Date(dateStr);
}

// Format Date to dd/mm/yyyy for Accurate API
function formatToAccurateDate(d: Date): string {
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

// Diff in calendar days (ignoring time)
function daysBetween(dateA: Date, dateB: Date): number {
    // Reset time to midnight for pure day comparison
    const a = new Date(dateA.getFullYear(), dateA.getMonth(), dateA.getDate());
    const b = new Date(dateB.getFullYear(), dateB.getMonth(), dateB.getDate());
    const msPerDay = 24 * 60 * 60 * 1000;
    return Math.round((b.getTime() - a.getTime()) / msPerDay);
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
        const forceRefresh = searchParams.get('force') === 'true';

        // Date objects for filtering
        const fromDateObj = parseUrlDate(fromParam, false);
        const toDateObj = parseUrlDate(toParam, true);

        // Strings for Accurate DO API request
        const fromDateStr = formatToAccurateDate(fromDateObj);
        const toDateStr = formatToAccurateDate(toDateObj);
        const branchId = branchParam ? parseInt(branchParam) : undefined;

        console.log(`[SLA] Fetching SLA data from=${fromDateStr} to=${toDateStr} branch=${branchId || 'all'} (force=${forceRefresh})`);

        // 1. Get ALL SO data for SLA (using specialized lightweight cache)
        const soCache = await loadSLASOCache(forceRefresh);
        if (!soCache || soCache.length === 0) {
            return NextResponse.json({
                error: 'No SO data available.',
                summary: { totalSO: 0, delivered: 0, onTime: 0, late: 0, pending: 0, avgLeadTime: 0, slaPercentage: 0 },
                details: [],
            });
        }

        // Filter SOs: include all "active/approved" statuses
        // The loadSLASOCache already excludes draf/batal/void
        let approvedSOs = soCache;

        // Debug: log unique statuses found
        const uniqueStatuses = [...new Set(approvedSOs.map(so => so.statusName))];
        console.log(`[SLA] SO statuses found: ${uniqueStatuses.join(', ')} (total ${soCache.length} SOs in cache)`);

        // Filter by branch if specified
        if (branchId) {
            approvedSOs = approvedSOs.filter(so => so.branchId === branchId);
        }

        // Filter by date range
        approvedSOs = approvedSOs.filter(so => {
            if (!so.transDate) return false;
            const soDateObj = parseDate(so.transDate);
            return soDateObj >= fromDateObj && soDateObj <= toDateObj;
        });

        console.log(`[SLA] Found ${approvedSOs.length} SOs in date range (after branch/date filter)`);

        // 2. Get DO data
        const doList = await fetchDOList(fromDateStr, toDateStr, branchId);
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

        // 4.5 Fetch Google Sheets Delivery Status
        const sheetOrders = await fetchSpreadsheetOrders();
        // Map by DO Name (ignoring case/whitespace for robust matching)
        const sheetOrderMap = new Map<string, string>();
        for (const order of sheetOrders) {
            if (order.completedAt) {
                // In Accurate, DO usually prefix 'DO.', but user said they match by DO Name
                sheetOrderMap.set(order.doName.trim().toLowerCase(), order.completedAt);
            }
        }
        console.log(`[SLA] Fetched ${sheetOrderMap.size} completed orders from Sheets`);

        // Helper to parse Sheet datetime (e.g. "4/6/2026 10:15:00" or "06/04/2026")
        function parseSheetDate(dateStr: string): Date {
            // Remove time part if it exists
            const datePart = dateStr.split(' ')[0];
            const parts = datePart.split('/');
            
            if (parts.length === 3) {
                // If year is the third part (e.g., DD/MM/YYYY or MM/DD/YYYY)
                if (parts[2].length === 4) {
                    // Try to guess if first part is month or day. If parts[1] > 12, parts[0] is month.
                    // For safety, assume DD/MM/YYYY if typical Indonesian format.
                    return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
                }
            }
            return new Date(datePart);
        }

        // 5. Calculate SLA for each SO
        const slaDetails: SLADetail[] = [];
        let totalLeadTime = 0;
        let deliveredCount = 0;
        let onTimeCount = 0;
        let lateCount = 0;
        let pendingCount = 0;
        let inTransitCount = 0;

        for (const so of approvedSOs) {
            const doInfo = soToDO.get(so.number);
            const soDateObj = parseDate(so.transDate);

            if (doInfo && doInfo.doDate) {
                // DO was created in Accurate. Check if it's in Spreadsheet.
                const sheetCompletedAt = sheetOrderMap.get(doInfo.doNumber.toLowerCase());

                if (sheetCompletedAt) {
                    // Received by customer
                    const receivedDateObj = parseSheetDate(sheetCompletedAt);
                    const leadTime = daysBetween(soDateObj, receivedDateObj);
                    const status = leadTime <= SLA_TARGET_DAYS ? 'ON_TIME' : 'LATE';

                    slaDetails.push({
                        soNumber: so.number,
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
                    // In Transit
                    slaDetails.push({
                        soNumber: so.number,
                        soDate: so.transDate,
                        doNumber: doInfo.doNumber,
                        doDate: doInfo.doDate,
                        customerName: so.customerName,
                        branchId: so.branchId,
                        leadTimeDays: null,
                        status: 'IN_TRANSIT',
                    });
                    inTransitCount++;
                }
            } else {
                // No DO yet
                slaDetails.push({
                    soNumber: so.number,
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
            inTransit: inTransitCount,
            pending: pendingCount,
            avgLeadTime: deliveredCount > 0 ? parseFloat((totalLeadTime / deliveredCount).toFixed(1)) : 0,
            slaPercentage: deliveredCount > 0 ? parseFloat(((onTimeCount / deliveredCount) * 100).toFixed(1)) : 0,
        };

        console.log(`[SLA] Result: ${summary.totalSO} SOs | ${summary.delivered} delivered (${summary.onTime} on-time, ${summary.late} late) | ${summary.inTransit} in-transit | ${summary.pending} pending | SLA=${summary.slaPercentage}%`);

        return NextResponse.json({ summary, details: slaDetails });
    } catch (error: any) {
        console.error('[SLA] Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
