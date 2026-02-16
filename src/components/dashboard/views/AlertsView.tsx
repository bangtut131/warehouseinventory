'use client';

import React from 'react';
import { InventoryItem } from '@/lib/types';
import { useTableControls } from '@/lib/useTableControls';
import { TableToolbar, SortableHead } from '../TableToolbar';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";

interface AlertsViewProps {
    items: InventoryItem[];
}

export const AlertsView: React.FC<AlertsViewProps> = ({ items }) => {
    const criticalItems = items.filter(i => i.status === 'CRITICAL').sort((a, b) => a.daysOfSupply - b.daysOfSupply);
    const reorderItems = items.filter(i => i.status === 'REORDER').sort((a, b) => a.daysOfSupply - b.daysOfSupply);
    const deadItems = items.filter(i => i.demandCategory === 'DEAD' && i.stock > 0).sort((a, b) => b.stockValue - a.stockValue);

    const formatIDR = (num: number) =>
        new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(num);

    // Critical search/filter
    const critical = useTableControls(criticalItems, ['itemNo', 'name'], [
        { key: 'demandCategory', label: 'Demand', options: ['FAST', 'SLOW', 'NON-MOVING', 'DEAD'] },
    ]);

    // Reorder search/filter
    const reord = useTableControls(reorderItems, ['itemNo', 'name'], [
        { key: 'abcClass', label: 'ABC', options: ['A', 'B', 'C'] },
    ]);

    // Dead stock search/filter
    const dead = useTableControls(deadItems, ['itemNo', 'name'], [
        { key: 'abcClass', label: 'ABC', options: ['A', 'B', 'C'] },
    ]);

    const totalDeadValue = dead.filtered.reduce((s, i) => s + i.stockValue, 0);

    return (
        <div className="space-y-6">
            {/* Critical Alerts */}
            <Card className="border-red-200">
                <CardHeader className="pb-2">
                    <CardTitle className="text-red-700">🚨 Critical Stock ({critical.filtered.length})</CardTitle>
                    <p className="text-sm text-muted-foreground">Item yang perlu segera di-restock</p>
                </CardHeader>
                <CardContent>
                    {criticalItems.length === 0 ? (
                        <p className="text-green-600 text-center py-4">✅ Tidak ada item dalam kondisi critical</p>
                    ) : (
                        <>
                            <TableToolbar
                                search={critical.search} onSearchChange={critical.setSearch}
                                filterOptions={[{ key: 'demandCategory', label: 'Demand', options: ['FAST', 'SLOW', 'NON-MOVING', 'DEAD'] }]}
                                filters={critical.filters} onFilterChange={critical.setFilter}
                                onClearAll={critical.clearAll} activeFilterCount={critical.activeFilterCount}
                                totalItems={criticalItems.length} filteredItems={critical.filtered.length}
                            />
                            <div className="rounded-md border max-h-[350px] overflow-auto">
                                <Table>
                                    <thead className="bg-red-600 sticky top-0 z-10">
                                        <tr>
                                            <SortableHead label="Kode" sortKey="itemNo" sort={critical.sort} onSort={critical.toggleSort} className="text-white" />
                                            <SortableHead label="Nama Barang" sortKey="name" sort={critical.sort} onSort={critical.toggleSort} className="text-white" />
                                            <SortableHead label="Stock" sortKey="stock" sort={critical.sort} onSort={critical.toggleSort} className="text-white text-right" />
                                            <SortableHead label="Safety" sortKey="safetyStock" sort={critical.sort} onSort={critical.toggleSort} className="text-white text-right" />
                                            <SortableHead label="PO Outst." sortKey="poOutstanding" sort={critical.sort} onSort={critical.toggleSort} className="text-white text-right" />
                                            <th className="h-12 px-4 text-white font-bold text-right">Net Shortage</th>
                                            <SortableHead label="DoS" sortKey="daysOfSupply" sort={critical.sort} onSort={critical.toggleSort} className="text-white text-right" />
                                            <SortableHead label="Demand" sortKey="demandCategory" sort={critical.sort} onSort={critical.toggleSort} className="text-white text-center" />
                                        </tr>
                                    </thead>
                                    <TableBody>
                                        {critical.filtered.map((item, index) => (
                                            <TableRow key={item.id} className={index % 2 === 0 ? 'bg-red-50' : 'bg-white'}>
                                                <TableCell className="font-medium text-blue-600">{item.itemNo}</TableCell>
                                                <TableCell className="max-w-[250px] truncate">{item.name}</TableCell>
                                                <TableCell className="text-right font-bold text-red-600">{item.stock} {item.unit}</TableCell>
                                                <TableCell className="text-right">{item.safetyStock}</TableCell>
                                                <TableCell className={`text-right font-medium ${item.poOutstanding > 0 ? 'text-purple-700' : 'text-gray-400'}`}>
                                                    {item.poOutstanding > 0 ? `+${item.poOutstanding}` : '-'}
                                                </TableCell>
                                                <TableCell className="text-right font-bold">
                                                    {item.netShortage > 0 ? (
                                                        <span className="text-red-700">-{item.netShortage}</span>
                                                    ) : (
                                                        <span className="text-green-600">✅ Covered</span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right">{isFinite(item.daysOfSupply) ? `${Math.min(Math.round(item.daysOfSupply), 99999)} d` : '0 d'}</TableCell>
                                                <TableCell className="text-center">
                                                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${item.demandCategory === 'FAST' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>{item.demandCategory}</span>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        </>
                    )}
                </CardContent>
            </Card>

            {/* Reorder Alerts */}
            <Card className="border-orange-200">
                <CardHeader className="pb-2">
                    <CardTitle className="text-orange-700">⚠️ Reorder Needed ({reord.filtered.length})</CardTitle>
                    <p className="text-sm text-muted-foreground">Item mendekati titik reorder</p>
                </CardHeader>
                <CardContent>
                    {reorderItems.length === 0 ? (
                        <p className="text-green-600 text-center py-4">✅ Semua item di atas ROP</p>
                    ) : (
                        <>
                            <TableToolbar
                                search={reord.search} onSearchChange={reord.setSearch}
                                filterOptions={[{ key: 'abcClass', label: 'ABC', options: ['A', 'B', 'C'] }]}
                                filters={reord.filters} onFilterChange={reord.setFilter}
                                onClearAll={reord.clearAll} activeFilterCount={reord.activeFilterCount}
                                totalItems={reorderItems.length} filteredItems={reord.filtered.length}
                            />
                            <div className="rounded-md border max-h-[350px] overflow-auto">
                                <Table>
                                    <thead className="bg-orange-500 sticky top-0 z-10">
                                        <tr>
                                            <SortableHead label="Kode" sortKey="itemNo" sort={reord.sort} onSort={reord.toggleSort} className="text-white" />
                                            <SortableHead label="Nama Barang" sortKey="name" sort={reord.sort} onSort={reord.toggleSort} className="text-white" />
                                            <SortableHead label="Stock" sortKey="stock" sort={reord.sort} onSort={reord.toggleSort} className="text-white text-right" />
                                            <SortableHead label="ROP" sortKey="reorderPoint" sort={reord.sort} onSort={reord.toggleSort} className="text-white text-right" />
                                            <SortableHead label="PO Outst." sortKey="poOutstanding" sort={reord.sort} onSort={reord.toggleSort} className="text-white text-right" />
                                            <SortableHead label="Saran Order" sortKey="suggestedOrder" sort={reord.sort} onSort={reord.toggleSort} className="text-white text-right" />
                                            <SortableHead label="ABC" sortKey="abcClass" sort={reord.sort} onSort={reord.toggleSort} className="text-white text-center" />
                                            <SortableHead label="DoS" sortKey="daysOfSupply" sort={reord.sort} onSort={reord.toggleSort} className="text-white text-right" />
                                        </tr>
                                    </thead>
                                    <TableBody>
                                        {reord.filtered.map((item, index) => (
                                            <TableRow key={item.id} className={index % 2 === 0 ? 'bg-orange-50' : 'bg-white'}>
                                                <TableCell className="font-medium text-blue-600">{item.itemNo}</TableCell>
                                                <TableCell className="max-w-[250px] truncate">{item.name}</TableCell>
                                                <TableCell className="text-right font-bold text-orange-600">{item.stock} {item.unit}</TableCell>
                                                <TableCell className="text-right">{item.reorderPoint}</TableCell>
                                                <TableCell className={`text-right font-medium ${item.poOutstanding > 0 ? 'text-purple-700' : 'text-gray-400'}`}>
                                                    {item.poOutstanding > 0 ? `+${item.poOutstanding}` : '-'}
                                                </TableCell>
                                                <TableCell className="text-right font-bold">
                                                    {item.suggestedOrder > 0 ? (
                                                        <span className="text-indigo-700">{item.suggestedOrder}</span>
                                                    ) : (
                                                        <span className="text-green-600">✅ Covered</span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <span className={`px-2 py-1 rounded text-white font-bold text-xs ${item.abcClass === 'A' ? 'bg-red-600' : item.abcClass === 'B' ? 'bg-orange-500' : 'bg-slate-500'}`}>{item.abcClass}</span>
                                                </TableCell>
                                                <TableCell className="text-right">{isFinite(item.daysOfSupply) ? `${Math.min(Math.round(item.daysOfSupply), 99999)} d` : '∞'}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        </>
                    )}
                </CardContent>
            </Card>

            {/* Dead Stock */}
            <Card className="border-gray-300">
                <CardHeader className="pb-2">
                    <CardTitle className="text-gray-700">💀 Dead Stock ({dead.filtered.length})</CardTitle>
                    <p className="text-sm text-muted-foreground">
                        Item tanpa pergerakan — Total nilai terikat: <strong className="text-red-600">{formatIDR(totalDeadValue)}</strong>
                    </p>
                </CardHeader>
                <CardContent>
                    {deadItems.length === 0 ? (
                        <p className="text-green-600 text-center py-4">✅ Tidak ada dead stock</p>
                    ) : (
                        <>
                            <TableToolbar
                                search={dead.search} onSearchChange={dead.setSearch}
                                filterOptions={[{ key: 'abcClass', label: 'ABC', options: ['A', 'B', 'C'] }]}
                                filters={dead.filters} onFilterChange={dead.setFilter}
                                onClearAll={dead.clearAll} activeFilterCount={dead.activeFilterCount}
                                totalItems={deadItems.length} filteredItems={dead.filtered.length}
                            />
                            <div className="rounded-md border max-h-[300px] overflow-auto">
                                <Table>
                                    <thead className="bg-gray-600 sticky top-0 z-10">
                                        <tr>
                                            <SortableHead label="Kode" sortKey="itemNo" sort={dead.sort} onSort={dead.toggleSort} className="text-white" />
                                            <SortableHead label="Nama" sortKey="name" sort={dead.sort} onSort={dead.toggleSort} className="text-white" />
                                            <SortableHead label="Stock" sortKey="stock" sort={dead.sort} onSort={dead.toggleSort} className="text-white text-right" />
                                            <th className="h-12 px-4 text-white font-bold">Unit</th>
                                            <SortableHead label="Nilai Stock" sortKey="stockValue" sort={dead.sort} onSort={dead.toggleSort} className="text-white text-right" />
                                            <SortableHead label="Umur (hari)" sortKey="stockAgeDays" sort={dead.sort} onSort={dead.toggleSort} className="text-white text-right" />
                                            <SortableHead label="ABC" sortKey="abcClass" sort={dead.sort} onSort={dead.toggleSort} className="text-white text-center" />
                                        </tr>
                                    </thead>
                                    <TableBody>
                                        {dead.filtered.map((item, index) => (
                                            <TableRow key={item.id} className={index % 2 === 0 ? 'bg-gray-50' : 'bg-white'}>
                                                <TableCell className="font-medium">{item.itemNo}</TableCell>
                                                <TableCell className="max-w-[250px] truncate">{item.name}</TableCell>
                                                <TableCell className="text-right font-bold">{item.stock}</TableCell>
                                                <TableCell>{item.unit}</TableCell>
                                                <TableCell className="text-right text-red-600 font-bold">{formatIDR(item.stockValue)}</TableCell>
                                                <TableCell className="text-right">{item.stockAgeDays} d</TableCell>
                                                <TableCell className="text-center">
                                                    <span className={`px-2 py-1 rounded text-white font-bold text-xs ${item.abcClass === 'A' ? 'bg-red-600' : item.abcClass === 'B' ? 'bg-orange-500' : 'bg-slate-500'}`}>{item.abcClass}</span>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        </>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};
