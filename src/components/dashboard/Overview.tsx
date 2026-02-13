'use client';

import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { InventoryItem } from '@/lib/types';
import { useTableControls } from '@/lib/useTableControls';
import { TableToolbar, SortableHead } from '@/components/dashboard/TableToolbar';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";

export default function Overview() {
    const [items, setItems] = useState<InventoryItem[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        axios.get('/api/inventory').then(res => {
            if (Array.isArray(res.data)) setItems(res.data);
        }).catch(err => console.error(err))
            .finally(() => setLoading(false));
    }, []);

    const { search, setSearch, sort, toggleSort, filters, setFilter, clearAll, filtered, activeFilterCount } = useTableControls(
        items,
        ['itemNo', 'name', 'category'],
        [
            { key: 'status', label: 'Status', options: ['CRITICAL', 'REORDER', 'OK', 'OVERSTOCK'] },
            { key: 'demandCategory', label: 'Demand', options: ['FAST', 'SLOW', 'NON-MOVING', 'DEAD'] },
            { key: 'abcClass', label: 'ABC', options: ['A', 'B', 'C'] },
        ]
    );

    const formatIDR = (num: number) =>
        new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(num);

    if (loading) {
        return (
            <div className="p-12 text-center">
                <div className="inline-block w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4" />
                <p className="text-muted-foreground">Loading inventory data...</p>
            </div>
        );
    }

    const totalValue = filtered.reduce((s, i) => s + i.stockValue, 0);
    const deadCount = filtered.filter(i => i.demandCategory === 'DEAD').length;

    return (
        <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-4">
                <Card className="bg-gradient-to-br from-blue-600 to-blue-700 text-white">
                    <CardContent className="p-4">
                        <div className="text-3xl font-bold">{filtered.length}</div>
                        <p className="text-xs opacity-80">📦 Total SKU</p>
                    </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-emerald-600 to-emerald-700 text-white">
                    <CardContent className="p-4">
                        <div className="text-2xl font-bold">{formatIDR(totalValue)}</div>
                        <p className="text-xs opacity-80">💰 Nilai Stock</p>
                    </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-red-600 to-red-700 text-white">
                    <CardContent className="p-4">
                        <div className="text-3xl font-bold">{filtered.filter(i => i.status === 'CRITICAL').length}</div>
                        <p className="text-xs opacity-80">🚨 Critical</p>
                    </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-gray-600 to-gray-700 text-white">
                    <CardContent className="p-4">
                        <div className="text-3xl font-bold">{deadCount}</div>
                        <p className="text-xs opacity-80">💀 Dead Stock</p>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle>Inventory List</CardTitle>
                </CardHeader>
                <CardContent>
                    <TableToolbar
                        search={search} onSearchChange={setSearch}
                        filterOptions={[
                            { key: 'status', label: 'Status', options: ['CRITICAL', 'REORDER', 'OK', 'OVERSTOCK'] },
                            { key: 'demandCategory', label: 'Demand', options: ['FAST', 'SLOW', 'NON-MOVING', 'DEAD'] },
                            { key: 'abcClass', label: 'ABC', options: ['A', 'B', 'C'] },
                        ]}
                        filters={filters} onFilterChange={setFilter}
                        onClearAll={clearAll} activeFilterCount={activeFilterCount}
                        totalItems={items.length} filteredItems={filtered.length}
                    />
                    <div className="rounded-md border max-h-[500px] overflow-auto">
                        <Table>
                            <thead className="bg-slate-700 sticky top-0 z-10">
                                <tr>
                                    <SortableHead label="No" sortKey="_index" sort={sort} onSort={toggleSort} className="text-white w-[50px]" />
                                    <SortableHead label="Kode" sortKey="itemNo" sort={sort} onSort={toggleSort} className="text-white" />
                                    <SortableHead label="Nama Barang" sortKey="name" sort={sort} onSort={toggleSort} className="text-white" />
                                    <SortableHead label="Stock" sortKey="stock" sort={sort} onSort={toggleSort} className="text-white text-right" />
                                    <th className="h-12 px-4 text-white font-bold">Unit</th>
                                    <SortableHead label="Harga" sortKey="price" sort={sort} onSort={toggleSort} className="text-white text-right" />
                                    <SortableHead label="Nilai Stock" sortKey="stockValue" sort={sort} onSort={toggleSort} className="text-white text-right" />
                                    <SortableHead label="Demand" sortKey="demandCategory" sort={sort} onSort={toggleSort} className="text-white text-center" />
                                    <SortableHead label="Status" sortKey="status" sort={sort} onSort={toggleSort} className="text-white text-center" />
                                </tr>
                            </thead>
                            <TableBody>
                                {filtered.map((item, index) => (
                                    <TableRow key={item.id} className={index % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                                        <TableCell>{index + 1}</TableCell>
                                        <TableCell className="font-medium text-blue-600">{item.itemNo}</TableCell>
                                        <TableCell className="max-w-[200px] truncate">{item.name}</TableCell>
                                        <TableCell className="text-right font-bold">{item.stock}</TableCell>
                                        <TableCell>{item.unit}</TableCell>
                                        <TableCell className="text-right">{formatIDR(item.price)}</TableCell>
                                        <TableCell className="text-right">{formatIDR(item.stockValue)}</TableCell>
                                        <TableCell className="text-center">
                                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${item.demandCategory === 'FAST' ? 'bg-green-100 text-green-800' : item.demandCategory === 'SLOW' ? 'bg-yellow-100 text-yellow-800' : item.demandCategory === 'DEAD' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'}`}>{item.demandCategory}</span>
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${item.status === 'CRITICAL' ? 'bg-red-100 text-red-800' : item.status === 'REORDER' ? 'bg-orange-100 text-orange-800' : item.status === 'OVERSTOCK' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'}`}>{item.status}</span>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
