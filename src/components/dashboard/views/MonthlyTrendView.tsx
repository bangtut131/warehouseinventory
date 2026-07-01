'use client';

import React, { useState } from 'react';
import { InventoryItem } from '@/lib/types';
import { useTableControls } from '@/lib/useTableControls';
import { TableToolbar, SortableHead } from '../TableToolbar';
import { UnitToggle, QtyUnit } from '../UnitToggle';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";

interface MonthlyTrendViewProps {
    items: InventoryItem[];
}

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

    // Helper: get display qty based on unit toggle
    const getQty = (qty: number, qtyBox: number): number => {
        return qtyUnit === 'pcs' ? qty : qtyBox;
    };

    // Helper: format qty for display
    const fmtQty = (qty: number, qtyBox: number): string => {
        const val = getQty(qty, qtyBox);
        if (val === 0) return '-';
        if (qtyUnit === 'box' && !Number.isInteger(val)) {
            return val.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
        }
        return Math.round(val).toLocaleString('id-ID');
    };

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
                                    <SortableHead
                                        label={qtyUnit === 'pcs' ? 'Total (Pcs)' : 'Total (Box)'}
                                        sortKey={qtyUnit === 'pcs' ? 'totalSalesQty' : 'totalSalesQtyBox'}
                                        sort={sort} onSort={toggleSort}
                                        className="text-white text-right"
                                    />
                                    <th className="h-12 px-2 text-white font-bold text-center">Trend</th>
                                    {dateHeaders.map((h, idx) => (
                                        <th key={idx} className="h-12 px-2 text-white font-bold text-center text-xs min-w-[60px]">
                                            {h.month}<br />{h.year}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <TableBody>
                                {sortedItems.map((item, index) => {
                                    const salesData = item.monthlySales.map(m => getQty(m.qty, m.qtyBox));
                                    const maxQty = Math.max(...salesData, 1);
                                    // Trend: compare last 3 vs first 3
                                    const firstHalf = salesData.slice(0, 3).reduce((s, v) => s + v, 0);
                                    const lastHalf = salesData.slice(-3).reduce((s, v) => s + v, 0);
                                    const trend = lastHalf > firstHalf * 1.1 ? '📈' : lastHalf < firstHalf * 0.9 ? '📉' : '➡️';

                                    const totalDisplay = qtyUnit === 'pcs'
                                        ? item.totalSalesQty.toLocaleString('id-ID')
                                        : (item.totalSalesQtyBox > 0
                                            ? `${item.totalSalesQtyBox.toLocaleString('id-ID')} ${item.salesUnitName || 'Box'}`
                                            : '-');

                                    return (
                                        <TableRow key={item.id} className={index % 2 === 0 ? 'bg-white' : 'bg-emerald-50'}>
                                            <TableCell className="freeze-col-1">{index + 1}</TableCell>
                                            <TableCell className="font-medium text-blue-600 text-xs freeze-col-2">{item.itemNo}</TableCell>
                                            <TableCell className="max-w-[150px] truncate text-xs freeze-col-3" title={item.name}>{item.name}</TableCell>
                                            <TableCell className="text-right font-bold">{totalDisplay}</TableCell>
                                            <TableCell className="text-center">{trend}</TableCell>
                                            {item.monthlySales.map((m, idx) => {
                                                const val = getQty(m.qty, m.qtyBox);
                                                const intensity = maxQty > 0 ? val / maxQty : 0;
                                                const bg = val === 0 ? 'bg-gray-100'
                                                    : intensity > 0.7 ? 'bg-emerald-600 text-white'
                                                        : intensity > 0.4 ? 'bg-emerald-300'
                                                            : 'bg-emerald-100';
                                                return (
                                                    <TableCell key={idx} className={`text-center text-xs font-medium px-1 ${bg}`}>
                                                        {fmtQty(m.qty, m.qtyBox)}
                                                    </TableCell>
                                                );
                                            })}
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
