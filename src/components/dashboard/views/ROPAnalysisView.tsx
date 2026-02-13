'use client';

import React from 'react';
import { InventoryItem } from '@/lib/types';
import { useTableControls } from '@/lib/useTableControls';
import { TableToolbar, SortableHead } from '../TableToolbar';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";

interface ROPAnalysisViewProps {
    items: InventoryItem[];
}

export const ROPAnalysisView: React.FC<ROPAnalysisViewProps> = ({ items }) => {
    const ropItems = items.filter(i => i.averageDailyUsage > 0);

    const { search, setSearch, sort, toggleSort, filters, setFilter, clearAll, filtered, activeFilterCount } = useTableControls(
        ropItems,
        ['itemNo', 'name'],
        [
            { key: 'status', label: 'Status', options: ['CRITICAL', 'REORDER', 'OK', 'OVERSTOCK'] },
            { key: 'demandCategory', label: 'Demand', options: ['FAST', 'SLOW', 'NON-MOVING', 'DEAD'] },
        ]
    );

    const formatIDR = (num: number) =>
        new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(num);

    // Summary cards
    const critical = filtered.filter(i => i.status === 'CRITICAL').length;
    const reorder = filtered.filter(i => i.status === 'REORDER').length;
    const ok = filtered.filter(i => i.status === 'OK').length;
    const overstock = filtered.filter(i => i.status === 'OVERSTOCK').length;

    return (
        <div className="space-y-4">
            {/* Summary */}
            <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
                <Card className="bg-gradient-to-br from-red-600 to-red-700 text-white">
                    <CardContent className="p-4">
                        <div className="text-2xl font-bold">{critical}</div>
                        <p className="text-xs opacity-80">🚨 CRITICAL</p>
                    </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-orange-500 to-orange-600 text-white">
                    <CardContent className="p-4">
                        <div className="text-2xl font-bold">{reorder}</div>
                        <p className="text-xs opacity-80">⚠️ REORDER</p>
                    </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-green-600 to-green-700 text-white">
                    <CardContent className="p-4">
                        <div className="text-2xl font-bold">{ok}</div>
                        <p className="text-xs opacity-80">✅ OK</p>
                    </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-blue-600 to-blue-700 text-white">
                    <CardContent className="p-4">
                        <div className="text-2xl font-bold">{overstock}</div>
                        <p className="text-xs opacity-80">📦 OVERSTOCK</p>
                    </CardContent>
                </Card>
            </div>

            {/* Table */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle>ROP Analysis Table</CardTitle>
                </CardHeader>
                <CardContent>
                    <TableToolbar
                        search={search} onSearchChange={setSearch}
                        filterOptions={[
                            { key: 'status', label: 'Status', options: ['CRITICAL', 'REORDER', 'OK', 'OVERSTOCK'] },
                            { key: 'demandCategory', label: 'Demand', options: ['FAST', 'SLOW', 'NON-MOVING', 'DEAD'] },
                        ]}
                        filters={filters} onFilterChange={setFilter}
                        onClearAll={clearAll} activeFilterCount={activeFilterCount}
                        totalItems={ropItems.length} filteredItems={filtered.length}
                    />
                    <div className="rounded-md border max-h-[500px] overflow-auto">
                        <Table>
                            <thead className="bg-blue-600 sticky top-0 z-10">
                                <tr>
                                    <SortableHead label="No" sortKey="_index" sort={sort} onSort={toggleSort} className="text-white w-[50px]" />
                                    <SortableHead label="Kode" sortKey="itemNo" sort={sort} onSort={toggleSort} className="text-white" />
                                    <SortableHead label="Nama Barang" sortKey="name" sort={sort} onSort={toggleSort} className="text-white" />
                                    <SortableHead label="Stock" sortKey="stock" sort={sort} onSort={toggleSort} className="text-white text-right" />
                                    <th className="h-12 px-4 text-white font-bold">Unit</th>
                                    <SortableHead label="ROP" sortKey="reorderPoint" sort={sort} onSort={toggleSort} className="text-white text-right" />
                                    <SortableHead label="Safety" sortKey="safetyStock" sort={sort} onSort={toggleSort} className="text-white text-right" />
                                    <SortableHead label="Min" sortKey="minStock" sort={sort} onSort={toggleSort} className="text-white text-right" />
                                    <SortableHead label="Max" sortKey="maxStock" sort={sort} onSort={toggleSort} className="text-white text-right" />
                                    <SortableHead label="Avg/Hari" sortKey="averageDailyUsage" sort={sort} onSort={toggleSort} className="text-white text-right" />
                                    <SortableHead label="StdDev" sortKey="standardDeviation" sort={sort} onSort={toggleSort} className="text-white text-right" />
                                    <SortableHead label="DoS" sortKey="daysOfSupply" sort={sort} onSort={toggleSort} className="text-white text-right" />
                                    <SortableHead label="Nilai Stock" sortKey="stockValue" sort={sort} onSort={toggleSort} className="text-white text-right" />
                                    <SortableHead label="Status" sortKey="status" sort={sort} onSort={toggleSort} className="text-white text-center" />
                                </tr>
                            </thead>
                            <TableBody>
                                {filtered.map((item, index) => {
                                    const stockRatio = item.reorderPoint > 0 ? item.stock / item.reorderPoint : 999;
                                    const rowColor = item.status === 'CRITICAL' ? 'bg-red-50' :
                                        item.status === 'REORDER' ? 'bg-orange-50' :
                                            item.status === 'OVERSTOCK' ? 'bg-blue-50' : index % 2 === 0 ? 'bg-white' : 'bg-slate-50';
                                    return (
                                        <TableRow key={item.id} className={rowColor}>
                                            <TableCell>{index + 1}</TableCell>
                                            <TableCell className="font-medium text-blue-600">{item.itemNo}</TableCell>
                                            <TableCell className="max-w-[200px] truncate">{item.name}</TableCell>
                                            <TableCell className={`text-right font-bold ${item.stock <= item.safetyStock ? 'text-red-600' : ''}`}>
                                                {item.stock} {item.unit}
                                            </TableCell>
                                            <TableCell>{item.unit}</TableCell>
                                            <TableCell className="text-right font-bold text-blue-700">{item.reorderPoint}</TableCell>
                                            <TableCell className="text-right">{item.safetyStock}</TableCell>
                                            <TableCell className="text-right">{item.minStock}</TableCell>
                                            <TableCell className="text-right">{item.maxStock}</TableCell>
                                            <TableCell className="text-right">{item.averageDailyUsage}</TableCell>
                                            <TableCell className="text-right">{item.standardDeviation}</TableCell>
                                            <TableCell className="text-right">{isFinite(item.daysOfSupply) ? `${Math.min(Math.round(item.daysOfSupply), 99999)} d` : '∞'}</TableCell>
                                            <TableCell className="text-right">{formatIDR(item.stockValue)}</TableCell>
                                            <TableCell className="text-center">
                                                <span className={`px-2 py-0.5 rounded text-xs font-bold ${item.status === 'CRITICAL' ? 'bg-red-600 text-white' :
                                                    item.status === 'REORDER' ? 'bg-orange-500 text-white' :
                                                        item.status === 'OVERSTOCK' ? 'bg-blue-500 text-white' :
                                                            'bg-green-500 text-white'
                                                    }`}>{item.status}</span>
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
