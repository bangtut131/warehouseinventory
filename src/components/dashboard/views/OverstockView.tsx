'use client';

import React, { useState } from 'react';
import { InventoryItem } from '@/lib/types';
import { useTableControls } from '@/lib/useTableControls';
import { TableToolbar, SortableHead } from '../TableToolbar';
import { UnitToggle, QtyUnit, formatQty } from '../UnitToggle';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";

interface OverstockViewProps {
    items: InventoryItem[];
}

export const OverstockView: React.FC<OverstockViewProps> = ({ items }) => {
    const [qtyUnit, setQtyUnit] = useState<QtyUnit>('pcs');
    const overstockItems = items
        .filter(i => i.status === 'OVERSTOCK' || (i.daysOfSupply > 90 && i.stock > 0))
        .sort((a, b) => b.stockValue - a.stockValue);

    const { search, setSearch, sort, toggleSort, filters, setFilter, clearAll, filtered, activeFilterCount } = useTableControls(
        overstockItems,
        ['itemNo', 'name'],
        [
            { key: 'demandCategory', label: 'Demand', options: ['FAST', 'SLOW', 'NON-MOVING', 'DEAD'] },
            { key: 'abcClass', label: 'ABC', options: ['A', 'B', 'C'] },
        ]
    );

    const formatIDR = (num: number) =>
        new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(num);

    const fq = (qty: number, item: InventoryItem) => formatQty(qty, item.unitConversion, qtyUnit);

    const totalExcessValue = filtered.reduce((s, i) => s + Math.max(0, i.stock - i.maxStock) * i.cost, 0);

    return (
        <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
                <Card className="bg-gradient-to-br from-blue-600 to-blue-700 text-white">
                    <CardContent className="p-4">
                        <div className="text-3xl font-bold">{filtered.length}</div>
                        <p className="text-xs opacity-80">Item Overstock</p>
                    </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-amber-500 to-amber-600 text-white">
                    <CardContent className="p-4">
                        <div className="text-3xl font-bold">{formatIDR(totalExcessValue)}</div>
                        <p className="text-xs opacity-80">Nilai Excess Stock</p>
                    </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-red-500 to-red-600 text-white">
                    <CardContent className="p-4">
                        <div className="text-3xl font-bold">{filtered.filter(i => i.demandCategory === 'DEAD').length}</div>
                        <p className="text-xs opacity-80">Dead Stock (prioritas liquidasi)</p>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                        <CardTitle>Overstock Items</CardTitle>
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
                        totalItems={overstockItems.length} filteredItems={filtered.length}
                    />
                    <div className="rounded-md border max-h-[500px] overflow-auto">
                        <Table>
                            <thead className="bg-blue-600 sticky top-0 z-10">
                                <tr>
                                    <SortableHead label="No" sortKey="_index" sort={sort} onSort={toggleSort} className="text-white w-[50px]" />
                                    <SortableHead label="Kode" sortKey="itemNo" sort={sort} onSort={toggleSort} className="text-white" />
                                    <SortableHead label="Nama Barang" sortKey="name" sort={sort} onSort={toggleSort} className="text-white" />
                                    <SortableHead label="Stock" sortKey="stock" sort={sort} onSort={toggleSort} className="text-white text-right" />
                                    <SortableHead label="Max" sortKey="maxStock" sort={sort} onSort={toggleSort} className="text-white text-right" />
                                    <th className="h-12 px-4 text-white font-bold text-right">Excess</th>
                                    <SortableHead label="DoS" sortKey="daysOfSupply" sort={sort} onSort={toggleSort} className="text-white text-right" />
                                    <SortableHead label="Avg/Hari" sortKey="averageDailyUsage" sort={sort} onSort={toggleSort} className="text-white text-right" />
                                    <SortableHead label="Nilai Stock" sortKey="stockValue" sort={sort} onSort={toggleSort} className="text-white text-right" />
                                    <SortableHead label="Demand" sortKey="demandCategory" sort={sort} onSort={toggleSort} className="text-white text-center" />
                                    <th className="h-12 px-4 text-white font-bold text-center">Rekomendasi</th>
                                </tr>
                            </thead>
                            <TableBody>
                                {filtered.map((item, index) => {
                                    const excess = Math.max(0, item.stock - item.maxStock);
                                    const recommendation = item.demandCategory === 'DEAD'
                                        ? '🔴 Liquidasi'
                                        : item.daysOfSupply > 365
                                            ? '🟡 Promo'
                                            : '🟢 Monitor';
                                    return (
                                        <TableRow key={item.id} className={index % 2 === 0 ? 'bg-white' : 'bg-blue-50'}>
                                            <TableCell>{index + 1}</TableCell>
                                            <TableCell className="font-medium text-blue-600">{item.itemNo}</TableCell>
                                            <TableCell className="max-w-[200px] truncate" title={item.name}>{item.name}</TableCell>
                                            <TableCell className="text-right font-bold">{fq(item.stock, item)}</TableCell>
                                            <TableCell className="text-right">{fq(item.maxStock, item)}</TableCell>
                                            <TableCell className="text-right text-red-600 font-bold">{excess > 0 ? `+${fq(excess, item)}` : '-'}</TableCell>
                                            <TableCell className="text-right">{isFinite(item.daysOfSupply) ? `${Math.min(Math.round(item.daysOfSupply), 99999)} d` : '∞'}</TableCell>
                                            <TableCell className="text-right">{fq(item.averageDailyUsage, item)}</TableCell>
                                            <TableCell className="text-right">{formatIDR(item.stockValue)}</TableCell>
                                            <TableCell className="text-center">
                                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${item.demandCategory === 'FAST' ? 'bg-green-100 text-green-800' : item.demandCategory === 'SLOW' ? 'bg-yellow-100 text-yellow-800' : item.demandCategory === 'DEAD' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'}`}>{item.demandCategory}</span>
                                            </TableCell>
                                            <TableCell className="text-center text-sm">{recommendation}</TableCell>
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
