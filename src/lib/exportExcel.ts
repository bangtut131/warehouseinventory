import * as XLSX from 'xlsx';
import { InventoryItem } from './types';

const formatIDR = (num: number) => Math.round(num);

export function exportAllAnalysis(items: InventoryItem[]) {
    const wb = XLSX.utils.book_new();

    // ===== Sheet 1: All Inventory =====
    const allData = items.map((item, i) => ({
        'No': i + 1,
        'Kode': item.itemNo,
        'Nama Barang': item.name,
        'Kategori': item.category,
        'Stock': item.stock,
        'Unit': item.unit,
        'Harga Jual': formatIDR(item.price),
        'Harga Pokok': formatIDR(item.cost),
        'Nilai Stock': formatIDR(item.stockValue),
        'ROP': item.reorderPoint,
        'Safety Stock': item.safetyStock,
        'Min Stock': item.minStock,
        'Max Stock': item.maxStock,
        'Avg/Hari': item.averageDailyUsage,
        'Std Dev': item.standardDeviation,
        'Days of Supply': isFinite(item.daysOfSupply) ? Math.min(Math.round(item.daysOfSupply), 99999) : 99999,
        'Status': item.status,
        'ABC': item.abcClass,
        'XYZ': item.xyzClass,
        'EOQ': item.eoq,
        'Turnover Rate': item.turnoverRate,
        'Demand Category': item.demandCategory,
        'Stock Age (hari)': item.stockAgeDays,
        'Total Qty Terjual': item.totalSalesQty,
        'Total Revenue': formatIDR(item.annualRevenue),
        'Data Source': item.dataSource,
    }));
    const ws1 = XLSX.utils.json_to_sheet(allData);
    autoWidth(ws1, allData);
    XLSX.utils.book_append_sheet(wb, ws1, 'All Inventory');

    // ===== Sheet 2: Dashboard Summary =====
    const totalValue = items.reduce((s, i) => s + i.stockValue, 0);
    const totalRevenue = items.reduce((s, i) => s + i.annualRevenue, 0);
    const avgTurnover = items.filter(i => i.turnoverRate > 0);
    const summaryData = [
        { 'Metrik': 'Total SKU', 'Nilai': items.length },
        { 'Metrik': 'Total Nilai Stock', 'Nilai': formatIDR(totalValue) },
        { 'Metrik': 'Total Revenue', 'Nilai': formatIDR(totalRevenue) },
        { 'Metrik': 'Avg Turnover', 'Nilai': avgTurnover.length > 0 ? (avgTurnover.reduce((s, i) => s + i.turnoverRate, 0) / avgTurnover.length).toFixed(2) : 0 },
        { 'Metrik': 'CRITICAL', 'Nilai': items.filter(i => i.status === 'CRITICAL').length },
        { 'Metrik': 'REORDER', 'Nilai': items.filter(i => i.status === 'REORDER').length },
        { 'Metrik': 'OK', 'Nilai': items.filter(i => i.status === 'OK').length },
        { 'Metrik': 'OVERSTOCK', 'Nilai': items.filter(i => i.status === 'OVERSTOCK').length },
        { 'Metrik': 'FAST Moving', 'Nilai': items.filter(i => i.demandCategory === 'FAST').length },
        { 'Metrik': 'SLOW Moving', 'Nilai': items.filter(i => i.demandCategory === 'SLOW').length },
        { 'Metrik': 'NON-MOVING', 'Nilai': items.filter(i => i.demandCategory === 'NON-MOVING').length },
        { 'Metrik': 'DEAD Stock', 'Nilai': items.filter(i => i.demandCategory === 'DEAD').length },
    ];
    const ws2 = XLSX.utils.json_to_sheet(summaryData);
    autoWidth(ws2, summaryData);
    XLSX.utils.book_append_sheet(wb, ws2, 'Dashboard Summary');

    // ===== Sheet 3: ROP Analysis =====
    const ropData = items
        .filter(i => i.averageDailyUsage > 0)
        .sort((a, b) => {
            const order: Record<string, number> = { CRITICAL: 0, REORDER: 1, OK: 2, OVERSTOCK: 3 };
            return (order[a.status] ?? 2) - (order[b.status] ?? 2);
        })
        .map((item, i) => ({
            'No': i + 1,
            'Kode': item.itemNo,
            'Nama Barang': item.name,
            'Stock': item.stock,
            'Unit': item.unit,
            'ROP': item.reorderPoint,
            'Safety Stock': item.safetyStock,
            'Min Stock': item.minStock,
            'Max Stock': item.maxStock,
            'Avg/Hari': item.averageDailyUsage,
            'Std Dev': item.standardDeviation,
            'Days of Supply': isFinite(item.daysOfSupply) ? Math.min(Math.round(item.daysOfSupply), 99999) : 99999,
            'Nilai Stock': formatIDR(item.stockValue),
            'Status': item.status,
        }));
    const ws3 = XLSX.utils.json_to_sheet(ropData);
    autoWidth(ws3, ropData);
    XLSX.utils.book_append_sheet(wb, ws3, 'ROP Analysis');

    // ===== Sheet 4: ABC-XYZ Matrix =====
    const abcData = [...items]
        .sort((a, b) => b.annualRevenue - a.annualRevenue)
        .map((item, i) => {
            const totalRev = items.reduce((s, x) => s + x.annualRevenue, 0);
            const revPct = totalRev > 0 ? ((item.annualRevenue / totalRev) * 100).toFixed(2) : '0';
            return {
                'No': i + 1,
                'Kode': item.itemNo,
                'Nama Barang': item.name,
                'ABC Class': item.abcClass,
                'XYZ Class': item.xyzClass,
                'Matrix': `${item.abcClass}${item.xyzClass}`,
                'Revenue': formatIDR(item.annualRevenue),
                'Revenue %': revPct,
                'Stock': item.stock,
                'Nilai Stock': formatIDR(item.stockValue),
                'Turnover': item.turnoverRate,
                'Demand Category': item.demandCategory,
            };
        });
    const ws4 = XLSX.utils.json_to_sheet(abcData);
    autoWidth(ws4, abcData);
    XLSX.utils.book_append_sheet(wb, ws4, 'ABC-XYZ Matrix');

    // ===== Sheet 5: EOQ Analysis =====
    const eoqData = items
        .filter(i => i.averageDailyUsage > 0 && i.eoq > 0)
        .sort((a, b) => b.eoq - a.eoq)
        .map((item, i) => {
            const annualDemand = Math.round(item.averageDailyUsage * 365);
            const ordersPerYear = item.eoq > 0 ? (annualDemand / item.eoq).toFixed(1) : '-';
            return {
                'No': i + 1,
                'Kode': item.itemNo,
                'Nama Barang': item.name,
                'Stock': item.stock,
                'Avg/Hari': item.averageDailyUsage,
                'Annual Demand': annualDemand,
                'EOQ': item.eoq,
                'Orders/Year': ordersPerYear,
                'Harga Pokok': formatIDR(item.cost),
                'Turnover': item.turnoverRate,
            };
        });
    const ws5 = XLSX.utils.json_to_sheet(eoqData);
    autoWidth(ws5, eoqData);
    XLSX.utils.book_append_sheet(wb, ws5, 'EOQ Analysis');

    // ===== Sheet 6: Monthly Trends =====
    const trendItems = items.filter(i => i.totalSalesQty > 0).sort((a, b) => b.totalSalesQty - a.totalSalesQty);
    if (trendItems.length > 0) {
        const headers = trendItems[0].monthlySales.map(m => `${m.month} ${m.year}`);
        const trendData = trendItems.map((item, i) => {
            const row: Record<string, any> = {
                'No': i + 1,
                'Kode': item.itemNo,
                'Nama Barang': item.name,
                'Total Qty': item.totalSalesQty,
            };
            item.monthlySales.forEach((m, idx) => {
                row[headers[idx]] = m.qty;
            });
            return row;
        });
        const ws6 = XLSX.utils.json_to_sheet(trendData);
        autoWidth(ws6, trendData);
        XLSX.utils.book_append_sheet(wb, ws6, 'Monthly Trends');
    }

    // ===== Sheet 7: Alerts =====
    const alertData = items
        .filter(i => i.status === 'CRITICAL' || i.status === 'REORDER')
        .sort((a, b) => {
            if (a.status === 'CRITICAL' && b.status !== 'CRITICAL') return -1;
            if (a.status !== 'CRITICAL' && b.status === 'CRITICAL') return 1;
            return a.daysOfSupply - b.daysOfSupply;
        })
        .map((item, i) => ({
            'No': i + 1,
            'Alert': item.status,
            'Kode': item.itemNo,
            'Nama Barang': item.name,
            'Stock': item.stock,
            'Unit': item.unit,
            'Safety Stock': item.safetyStock,
            'ROP': item.reorderPoint,
            'Kekurangan': Math.max(0, item.reorderPoint - item.stock),
            'Days of Supply': isFinite(item.daysOfSupply) ? Math.min(Math.round(item.daysOfSupply), 99999) : 0,
            'Avg/Hari': item.averageDailyUsage,
            'EOQ': item.eoq,
            'ABC': item.abcClass,
            'Demand': item.demandCategory,
        }));
    const ws7 = XLSX.utils.json_to_sheet(alertData);
    autoWidth(ws7, alertData);
    XLSX.utils.book_append_sheet(wb, ws7, 'Alerts');

    // ===== Sheet 8: Overstock =====
    const overstockData = items
        .filter(i => i.status === 'OVERSTOCK' || (i.daysOfSupply > 90 && i.stock > 0))
        .sort((a, b) => b.stockValue - a.stockValue)
        .map((item, i) => ({
            'No': i + 1,
            'Kode': item.itemNo,
            'Nama Barang': item.name,
            'Stock': item.stock,
            'Unit': item.unit,
            'Max Stock': item.maxStock,
            'Excess': Math.max(0, item.stock - item.maxStock),
            'Days of Supply': isFinite(item.daysOfSupply) ? Math.min(Math.round(item.daysOfSupply), 99999) : 99999,
            'Avg/Hari': item.averageDailyUsage,
            'Nilai Stock': formatIDR(item.stockValue),
            'Demand': item.demandCategory,
            'Rekomendasi': item.demandCategory === 'DEAD' ? 'Liquidasi' : item.daysOfSupply > 365 ? 'Promo' : 'Monitor',
        }));
    const ws8 = XLSX.utils.json_to_sheet(overstockData);
    autoWidth(ws8, overstockData);
    XLSX.utils.book_append_sheet(wb, ws8, 'Overstock');

    // ===== Sheet 9: Dead Stock =====
    const deadData = items
        .filter(i => i.demandCategory === 'DEAD' && i.stock > 0)
        .sort((a, b) => b.stockValue - a.stockValue)
        .map((item, i) => ({
            'No': i + 1,
            'Kode': item.itemNo,
            'Nama Barang': item.name,
            'Stock': item.stock,
            'Unit': item.unit,
            'Nilai Stock': formatIDR(item.stockValue),
            'Stock Age (hari)': item.stockAgeDays,
            'ABC': item.abcClass,
        }));
    const ws9 = XLSX.utils.json_to_sheet(deadData);
    autoWidth(ws9, deadData);
    XLSX.utils.book_append_sheet(wb, ws9, 'Dead Stock');

    // ===== Sheet 10: Top Items =====
    const topData = [...items]
        .sort((a, b) => b.annualRevenue - a.annualRevenue)
        .slice(0, 30)
        .map((item, i) => ({
            'Rank': i + 1,
            'Kode': item.itemNo,
            'Nama Barang': item.name,
            'ABC': item.abcClass,
            'Revenue': formatIDR(item.annualRevenue),
            'Total Terjual': item.totalSalesQty,
            'Stock': item.stock,
            'Unit': item.unit,
            'Turnover': item.turnoverRate,
            'Demand': item.demandCategory,
            'Status': item.status,
        }));
    const ws10 = XLSX.utils.json_to_sheet(topData);
    autoWidth(ws10, topData);
    XLSX.utils.book_append_sheet(wb, ws10, 'Top 30 Revenue');

    // Generate file
    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    XLSX.writeFile(wb, `Inventory_Analysis_${dateStr}.xlsx`);
}

// Auto-fit column widths based on content
function autoWidth(ws: XLSX.WorkSheet, data: Record<string, any>[]) {
    if (data.length === 0) return;
    const keys = Object.keys(data[0]);
    ws['!cols'] = keys.map(key => {
        const maxLen = Math.max(
            key.length,
            ...data.map(row => String(row[key] ?? '').length)
        );
        return { wch: Math.min(maxLen + 2, 40) };
    });
}
