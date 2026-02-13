'use client';

import React from 'react';
import { InventoryItem } from '@/lib/types';
import { useTableControls } from '@/lib/useTableControls';
import { TableToolbar, SortableHead } from '../TableToolbar';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";

interface TopItemsViewProps {
    items: InventoryItem[];
}

export const TopItemsView: React.FC<TopItemsViewProps> = ({ items }) => {
    const top30 = [...items].sort((a, b) => b.annualRevenue - a.annualRevenue).slice(0, 30);

    const formatIDR = (num: number) =>
        new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(num);

    const { search, setSearch, sort, toggleSort, filters, setFilter, clearAll, filtered, activeFilterCount } = useTableControls(
        top30,
        ['itemNo', 'name'],
        [
            { key: 'abcClass', label: 'ABC', options: ['A', 'B', 'C'] },
            { key: 'demandCategory', label: 'Demand', options: ['FAST', 'SLOW', 'NON-MOVING', 'DEAD'] },
        ]
    );

    const totalRevenue = filtered.reduce((s, i) => s + i.annualRevenue, 0);
    const totalUnits = filtered.reduce((s, i) => s + i.totalSalesQty, 0);

    return (
        <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
                <Card className="bg-gradient-to-br from-amber-500 to-amber-600 text-white">
                    <CardContent className="p-4">
                        <div className="text-3xl font-bold">{formatIDR(totalRevenue)}</div>
                        <p className="text-xs opacity-80">🏆 Total Revenue Top 30</p>
                    </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-green-600 to-green-700 text-white">
                    <CardContent className="p-4">
                        <div className="text-3xl font-bold">{totalUnits.toLocaleString()}</div>
                        <p className="text-xs opacity-80">📦 Total Units Terjual</p>
                    </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-blue-600 to-blue-700 text-white">
                    <CardContent className="p-4">
                        <div className="text-3xl font-bold">{filtered.filter(i => i.turnoverRate >= 6).length} / {filtered.length}</div>
                        <p className="text-xs opacity-80">🔄 High Turnover (≥6×/yr)</p>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle>🏆 Top 30 Items by Revenue</CardTitle>
                </CardHeader>
                <CardContent>
                    <TableToolbar
                        search={search} onSearchChange={setSearch}
                        filterOptions={[
                            { key: 'abcClass', label: 'ABC', options: ['A', 'B', 'C'] },
                            { key: 'demandCategory', label: 'Demand', options: ['FAST', 'SLOW', 'NON-MOVING', 'DEAD'] },
                        ]}
                        filters={filters} onFilterChange={setFilter}
                        onClearAll={clearAll} activeFilterCount={activeFilterCount}
                        totalItems={top30.length} filteredItems={filtered.length}
                    />
                    <div className="rounded-md border max-h-[500px] overflow-auto">
                        <Table>
                            <thead className="bg-amber-600 sticky top-0 z-10">
                                <tr>
                                    <SortableHead label="Rank" sortKey="_index" sort={sort} onSort={toggleSort} className="text-white w-[50px]" />
                                    <SortableHead label="Kode" sortKey="itemNo" sort={sort} onSort={toggleSort} className="text-white" />
                                    <SortableHead label="Nama Barang" sortKey="name" sort={sort} onSort={toggleSort} className="text-white" />
                                    <SortableHead label="ABC" sortKey="abcClass" sort={sort} onSort={toggleSort} className="text-white text-center" />
                                    <SortableHead label="Revenue" sortKey="annualRevenue" sort={sort} onSort={toggleSort} className="text-white text-right" />
                                    <SortableHead label="Terjual" sortKey="totalSalesQty" sort={sort} onSort={toggleSort} className="text-white text-right" />
                                    <SortableHead label="Stock" sortKey="stock" sort={sort} onSort={toggleSort} className="text-white text-right" />
                                    <SortableHead label="Turnover" sortKey="turnoverRate" sort={sort} onSort={toggleSort} className="text-white text-right" />
                                    <SortableHead label="Demand" sortKey="demandCategory" sort={sort} onSort={toggleSort} className="text-white text-center" />
                                    <SortableHead label="Status" sortKey="status" sort={sort} onSort={toggleSort} className="text-white text-center" />
                                </tr>
                            </thead>
                            <TableBody>
                                {filtered.map((item, index) => {
                                    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}`;
                                    return (
                                        <TableRow key={item.id} className={index < 3 ? 'bg-amber-50' : index % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                                            <TableCell className="text-center font-bold">{medal}</TableCell>
                                            <TableCell className="font-medium text-blue-600">{item.itemNo}</TableCell>
                                            <TableCell className="max-w-[200px] truncate">{item.name}</TableCell>
                                            <TableCell className="text-center">
                                                <span className={`px-2 py-1 rounded text-white font-bold text-xs ${item.abcClass === 'A' ? 'bg-red-600' : item.abcClass === 'B' ? 'bg-orange-500' : 'bg-slate-500'}`}>{item.abcClass}</span>
                                            </TableCell>
                                            <TableCell className="text-right font-bold">{formatIDR(item.annualRevenue)}</TableCell>
                                            <TableCell className="text-right">{item.totalSalesQty.toLocaleString()}</TableCell>
                                            <TableCell className="text-right">{item.stock} {item.unit}</TableCell>
                                            <TableCell className="text-right">{item.turnoverRate}×</TableCell>
                                            <TableCell className="text-center">
                                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${item.demandCategory === 'FAST' ? 'bg-green-100 text-green-800' : item.demandCategory === 'SLOW' ? 'bg-yellow-100 text-yellow-800' : item.demandCategory === 'DEAD' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'}`}>{item.demandCategory}</span>
                                            </TableCell>
                                            <TableCell className="text-center">
                                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${item.status === 'CRITICAL' ? 'bg-red-100 text-red-800' : item.status === 'REORDER' ? 'bg-orange-100 text-orange-800' : item.status === 'OVERSTOCK' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'}`}>{item.status}</span>
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
