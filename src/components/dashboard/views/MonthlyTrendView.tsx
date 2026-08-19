'use client';

import React, { useState, useMemo } from 'react';
import { InventoryItem } from '@/lib/types';
import { useTableControls } from '@/lib/useTableControls';
import { TableToolbar, SortableHead } from '../TableToolbar';
import { UnitToggle, QtyUnit, getSalesQtyBox } from '../UnitToggle';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";

interface MonthlyTrendViewProps {
    items: InventoryItem[];
}

const MONTH_NAMES_ID: Record<string, string> = {
    'Jan': 'Januari', 'Feb': 'Februari', 'Mar': 'Maret', 'Apr': 'April',
    'May': 'Mei', 'Jun': 'Juni', 'Jul': 'Juli', 'Aug': 'Agustus',
    'Sep': 'September', 'Oct': 'Oktober', 'Nov': 'November', 'Dec': 'Desember',
    'January': 'Januari', 'February': 'Februari', 'March': 'Maret', 'April': 'April',
    'May': 'Mei', 'June': 'Juni', 'July': 'Juli', 'August': 'Agustus',
    'September': 'September', 'October': 'Oktober', 'November': 'November', 'December': 'Desember',
};

export const MonthlyTrendView: React.FC<MonthlyTrendViewProps> = ({ items }) => {
    const [qtyUnit, setQtyUnit] = useState<QtyUnit>('pcs');
    const trendItems = items.filter(i => i.totalSalesQty > 0);

    const { search, setSearch, sort, toggleSort, filters, setFilter, clearAll, filtered, activeFilterCount } = useTableControls(
        trendItems,
        ['itemNo', 'name'],
        [
            { key: 'demandCategory', label: 'Demand', options: ['FAST', 'SLOW', 'NON-MOVING', 'DEAD'] },
            { key: 'abcClass', label: 'ABC', options: ['A', 'B', 'C'] },
        ]
    );

    // Sort filtered by totalSalesQty by default (if no explicit sort)
    const sortedItems = sort.key
        ? filtered
        : [...filtered].sort((a, b) => b.totalSalesQty - a.totalSalesQty);

    const dateHeaders = sortedItems.length > 0 ? sortedItems[0].monthlySales : [];

    // Determine the last 2 complete months (exclude current month)
    const last2MonthIndices = useMemo(() => {
        if (dateHeaders.length < 2) return [];
        const now = new Date();
        const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        // Find indices of last 2 complete months (not current month)
        const indices: number[] = [];
        for (let i = dateHeaders.length - 1; i >= 0 && indices.length < 2; i--) {
            const h = dateHeaders[i];
            const monthKey = `${h.year}-${String(new Date(`${h.month} 1, ${h.year}`).getMonth() + 1).padStart(2, '0')}`;
            if (monthKey !== currentMonthKey) {
                indices.unshift(i);
            }
        }
        return indices;
    }, [dateHeaders]);

    // Helper: get display qty based on unit toggle
    // Uses getSalesQtyBox to fix: items always sold in base unit had qtyBox === qty (bug)
    const getQty = (qty: number, qtyBox: number, itemUnitConversion: number): number => {
        if (qtyUnit === 'pcs') return qty;
        return getSalesQtyBox(qty, qtyBox, itemUnitConversion);
    };

    // Helper: format qty for display
    const fmtQty = (qty: number, qtyBox: number, itemUnitConversion: number): string => {
        const val = getQty(qty, qtyBox, itemUnitConversion);
        if (val === 0) return '-';
        if (qtyUnit === 'box' && !Number.isInteger(val)) {
            return val.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
        }
        return Math.round(val).toLocaleString('id-ID');
    };

    // Helper: format number
    const fmtNum = (val: number): string => {
        if (val === 0) return '-';
        if (!Number.isInteger(val)) {
            return val.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
        }
        return Math.round(val).toLocaleString('id-ID');
    };

    // Compute avg2m for an item
    const getAvg2m = (item: InventoryItem): number => {
        if (last2MonthIndices.length < 2) return 0;
        const vals = last2MonthIndices.map(idx => {
            const m = item.monthlySales[idx];
            if (!m) return 0;
            return getQty(m.qty, m.qtyBox, item.unitConversion);
        });
        const sum = vals.reduce((a, b) => a + b, 0);
        return sum / 2;
    };

    // Get avg2m month labels for header — full month names in Indonesian
    const avg2mLabel = useMemo(() => {
        if (last2MonthIndices.length < 2) return 'Avg 2 Bln';
        const m1 = dateHeaders[last2MonthIndices[0]];
        const m2 = dateHeaders[last2MonthIndices[1]];
        const name1 = MONTH_NAMES_ID[m1?.month] || m1?.month || '?';
        const name2 = MONTH_NAMES_ID[m2?.month] || m2?.month || '?';
        return `Avg ${name1} & ${name2}`;
    }, [last2MonthIndices, dateHeaders]);

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                        <CardTitle>📈 Monthly Sales Trend</CardTitle>
                        <UnitToggle unit={qtyUnit} onChange={setQtyUnit} />
                    </div>
                </CardHeader>
                <CardContent>
                    <TableToolbar
                        search={search} onSearchChange={setSearch}
                        filterOptions={[
                            { key: 'demandCategory', label: 'Demand', options: ['FAST', 'SLOW', 'NON-MOVING', 'DEAD'] },
                            { key: 'abcClass', label: 'ABC', options: ['A', 'B', 'C'] },
                        ]}
                        filters={filters} onFilterChange={setFilter}
                        onClearAll={clearAll} activeFilterCount={activeFilterCount}
                        totalItems={trendItems.length} filteredItems={filtered.length}
                    />
                    <div className="freeze-table-wrapper" style={{ maxHeight: '600px' }}>
                        <Table className="freeze-table">
                            <thead className="bg-emerald-700 sticky top-0 z-10">
                                <tr>
                                    <SortableHead label="No" sortKey="_index" sort={sort} onSort={toggleSort} className="text-white w-[40px] freeze-col-1 bg-emerald-700" />
                                    <SortableHead label="Kode" sortKey="itemNo" sort={sort} onSort={toggleSort} className="text-white freeze-col-2 bg-emerald-700" />
                                    <SortableHead label="Nama" sortKey="name" sort={sort} onSort={toggleSort} className="text-white freeze-col-3 bg-emerald-700" />
                                    <th className="h-12 px-2 text-white font-bold text-center">Trend</th>
                                    {dateHeaders.map((h, idx) => (
                                        <th key={idx} className="h-12 px-2 text-white font-bold text-center text-xs min-w-[60px]">
                                            {h.month}<br />{h.year}
                                        </th>
                                    ))}
                                    <SortableHead
                                        label="Stock"
                                        sortKey="stock"
                                        sort={sort} onSort={toggleSort}
                                        className="text-white text-right bg-emerald-800"
                                    />
                                    <th className="h-12 px-2 text-white font-bold text-center text-xs min-w-[90px] bg-amber-600">
                                        {avg2mLabel}
                                    </th>
                                </tr>
                            </thead>
                            <TableBody>
                                {sortedItems.map((item, index) => {
                                    const salesData = item.monthlySales.map(m => getQty(m.qty, m.qtyBox, item.unitConversion));
                                    const maxQty = Math.max(...salesData, 1);
                                    // Trend: compare last 3 vs first 3
                                    const firstHalf = salesData.slice(0, 3).reduce((s, v) => s + v, 0);
                                    const lastHalf = salesData.slice(-3).reduce((s, v) => s + v, 0);
                                    const trend = lastHalf > firstHalf * 1.1 ? '📈' : lastHalf < firstHalf * 0.9 ? '📉' : '➡️';

                                    const avg2m = getAvg2m(item);

                                    // Stock in display unit
                                    const isSakUnit = item.unit.toLowerCase() === 'sak';
                                    const displayStock = (qtyUnit === 'box' && !isSakUnit && item.unitConversion > 1)
                                        ? parseFloat((item.stock / item.unitConversion).toFixed(1))
                                        : item.stock;

                                    // Stock vs Avg2m ratio for color coding
                                    const stockRatio = avg2m > 0 ? displayStock / avg2m : 999;

                                    return (
                                        <TableRow key={item.id} className={index % 2 === 0 ? 'bg-white' : 'bg-emerald-50'}>
                                            <TableCell className="freeze-col-1">{index + 1}</TableCell>
                                            <TableCell className="font-medium text-blue-600 text-xs freeze-col-2">{item.itemNo}</TableCell>
                                            <TableCell className="max-w-[150px] truncate text-xs freeze-col-3" title={item.name}>{item.name}</TableCell>
                                            <TableCell className="text-center">{trend}</TableCell>
                                            {item.monthlySales.map((m, idx) => {
                                                const val = getQty(m.qty, m.qtyBox, item.unitConversion);
                                                const intensity = maxQty > 0 ? val / maxQty : 0;
                                                const isLast2 = last2MonthIndices.includes(idx);
                                                const bg = val === 0 ? 'bg-gray-100'
                                                    : intensity > 0.7 ? 'bg-emerald-600 text-white'
                                                        : intensity > 0.4 ? 'bg-emerald-300'
                                                            : 'bg-emerald-100';
                                                return (
                                                    <TableCell key={idx} className={`text-center text-xs font-medium px-1 ${bg} ${isLast2 ? 'ring-1 ring-amber-400 ring-inset' : ''}`}>
                                                        {fmtQty(m.qty, m.qtyBox, item.unitConversion)}
                                                    </TableCell>
                                                );
                                            })}
                                            {/* Stock column — far right */}
                                            <TableCell className="text-right text-xs font-semibold">
                                                <span className={
                                                    stockRatio < 1 ? 'text-red-600' :
                                                    stockRatio < 2 ? 'text-orange-600' :
                                                    'text-gray-800'
                                                }>
                                                    {fmtNum(displayStock)}
                                                </span>
                                            </TableCell>
                                            {/* Avg 2 bulan column — far right */}
                                            <TableCell className="text-center text-xs font-bold bg-amber-50">
                                                {fmtNum(avg2m)}
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};
