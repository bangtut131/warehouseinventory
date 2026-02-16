'use client';

import React from 'react';
import { InventoryItem } from '@/lib/types';
import { useTableControls } from '@/lib/useTableControls';
import { TableToolbar, SortableHead } from '../TableToolbar';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";

interface MonthlyTrendViewProps {
    items: InventoryItem[];
}

export const MonthlyTrendView: React.FC<MonthlyTrendViewProps> = ({ items }) => {
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

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle>📈 Monthly Sales Trend</CardTitle>
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
                    <div className="rounded-md border max-h-[600px] overflow-auto">
                        <Table>
                            <thead className="bg-emerald-700 sticky top-0 z-10">
                                <tr>
                                    <SortableHead label="No" sortKey="_index" sort={sort} onSort={toggleSort} className="text-white w-[40px]" />
                                    <SortableHead label="Kode" sortKey="itemNo" sort={sort} onSort={toggleSort} className="text-white" />
                                    <SortableHead label="Nama" sortKey="name" sort={sort} onSort={toggleSort} className="text-white" />
                                    <SortableHead label="Total (Pcs)" sortKey="totalSalesQty" sort={sort} onSort={toggleSort} className="text-white text-right" />
                                    <SortableHead label="Total (Box)" sortKey="totalSalesQtyBox" sort={sort} onSort={toggleSort} className="text-white text-right" />
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
                                    const maxQty = Math.max(...item.monthlySales.map(m => m.qty), 1);
                                    // Trend: compare last 3 vs first 3
                                    const sales = item.monthlySales.map(m => m.qty);
                                    const firstHalf = sales.slice(0, 3).reduce((s, v) => s + v, 0);
                                    const lastHalf = sales.slice(-3).reduce((s, v) => s + v, 0);
                                    const trend = lastHalf > firstHalf * 1.1 ? '📈' : lastHalf < firstHalf * 0.9 ? '📉' : '➡️';
                                    return (
                                        <TableRow key={item.id} className={index % 2 === 0 ? 'bg-white' : 'bg-emerald-50'}>
                                            <TableCell>{index + 1}</TableCell>
                                            <TableCell className="font-medium text-blue-600 text-xs">{item.itemNo}</TableCell>
                                            <TableCell className="max-w-[150px] truncate text-xs" title={item.name}>{item.name}</TableCell>
                                            <TableCell className="text-right font-bold">{item.totalSalesQty}</TableCell>
                                            <TableCell className="text-right text-xs">
                                                {item.totalSalesQtyBox > 0 ? (
                                                    <div className="flex flex-col items-end">
                                                        <span>{item.totalSalesQtyBox} {item.salesUnitName}</span>
                                                    </div>
                                                ) : '-'}
                                            </TableCell>
                                            <TableCell className="text-center">{trend}</TableCell>
                                            {item.monthlySales.map((m, idx) => {
                                                const intensity = maxQty > 0 ? m.qty / maxQty : 0;
                                                const bg = m.qty === 0 ? 'bg-gray-100'
                                                    : intensity > 0.7 ? 'bg-emerald-600 text-white'
                                                        : intensity > 0.4 ? 'bg-emerald-300'
                                                            : 'bg-emerald-100';
                                                return (
                                                    <TableCell key={idx} className={`text-center text-xs font-medium px-1 ${bg}`}>
                                                        {m.qty || '-'}
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
