'use client';

import React from 'react';
import { InventoryItem } from '@/lib/types';
import { useTableControls } from '@/lib/useTableControls';
import { TableToolbar, SortableHead } from '../TableToolbar';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";

interface EOQViewProps {
    items: InventoryItem[];
}

export const EOQView: React.FC<EOQViewProps> = ({ items }) => {
    const activeItems = items.filter(i => i.eoq > 0 && i.averageDailyUsage > 0);

    const { search, setSearch, sort, toggleSort, filters, setFilter, clearAll, filtered, activeFilterCount } = useTableControls(
        activeItems,
        ['itemNo', 'name'],
        [
            { key: 'abcClass', label: 'ABC', options: ['A', 'B', 'C'] },
            { key: 'status', label: 'Status', options: ['CRITICAL', 'REORDER', 'OK', 'OVERSTOCK'] },
        ]
    );

    const formatIDR = (num: number) =>
        new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(num);

    const totalItems = filtered.length;
    const avgEOQ = totalItems > 0 ? filtered.reduce((s, i) => s + i.eoq, 0) / totalItems : 0;

    // Potential savings
    const totalCurrentCost = filtered.reduce((sum, item) => {
        const annualDemand = item.averageDailyUsage * 365;
        if (annualDemand <= 0 || item.eoq <= 0) return sum;
        const currentOrderQty = Math.max(item.maxStock - item.stock, item.eoq);
        const currentOrders = annualDemand / currentOrderQty;
        return sum + currentOrders * 150000 + (currentOrderQty / 2) * item.cost * 0.25;
    }, 0);
    const totalOptimalCost = filtered.reduce((sum, item) => {
        const annualDemand = item.averageDailyUsage * 365;
        if (annualDemand <= 0 || item.eoq <= 0) return sum;
        const optimalOrders = annualDemand / item.eoq;
        return sum + optimalOrders * 150000 + (item.eoq / 2) * item.cost * 0.25;
    }, 0);
    const potentialSavings = totalCurrentCost - totalOptimalCost;

    return (
        <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
                <Card className="bg-gradient-to-br from-indigo-600 to-indigo-700 text-white">
                    <CardContent className="p-4">
                        <div className="text-3xl font-bold">{totalItems}</div>
                        <p className="text-xs opacity-80">Item dengan EOQ</p>
                    </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-teal-600 to-teal-700 text-white">
                    <CardContent className="p-4">
                        <div className="text-3xl font-bold">{Math.round(avgEOQ)} unit</div>
                        <p className="text-xs opacity-80">Rata-rata EOQ</p>
                    </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-green-600 to-green-700 text-white">
                    <CardContent className="p-4">
                        <div className="text-3xl font-bold">{formatIDR(Math.max(0, potentialSavings))}</div>
                        <p className="text-xs opacity-80">Potensi Penghematan</p>
                    </CardContent>
                </Card>
            </div>

            <Card className="bg-indigo-50 border-indigo-200">
                <CardContent className="p-4 text-sm text-indigo-900 space-y-1">
                    <p className="font-bold">📐 EOQ = √(2 × D × S / H)</p>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                        <div><strong>D</strong> = Annual Demand</div>
                        <div><strong>S</strong> = Rp 150.000/order</div>
                        <div><strong>H</strong> = 25% × Unit Cost</div>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle>EOQ Analysis Table</CardTitle>
                </CardHeader>
                <CardContent>
                    <TableToolbar
                        search={search} onSearchChange={setSearch}
                        filterOptions={[
                            { key: 'abcClass', label: 'ABC', options: ['A', 'B', 'C'] },
                            { key: 'status', label: 'Status', options: ['CRITICAL', 'REORDER', 'OK', 'OVERSTOCK'] },
                        ]}
                        filters={filters} onFilterChange={setFilter}
                        onClearAll={clearAll} activeFilterCount={activeFilterCount}
                        totalItems={activeItems.length} filteredItems={filtered.length}
                    />
                    <div className="rounded-md border max-h-[500px] overflow-auto">
                        <Table>
                            <thead className="bg-indigo-600 sticky top-0 z-10">
                                <tr>
                                    <SortableHead label="No" sortKey="_index" sort={sort} onSort={toggleSort} className="text-white w-[50px]" />
                                    <SortableHead label="Kode" sortKey="itemNo" sort={sort} onSort={toggleSort} className="text-white" />
                                    <SortableHead label="Nama Barang" sortKey="name" sort={sort} onSort={toggleSort} className="text-white" />
                                    <SortableHead label="ABC" sortKey="abcClass" sort={sort} onSort={toggleSort} className="text-white text-center" />
                                    <SortableHead label="Avg/Hari" sortKey="averageDailyUsage" sort={sort} onSort={toggleSort} className="text-white text-right" />
                                    <SortableHead label="Demand/Thn" sortKey="_annualDemand" sort={sort} onSort={toggleSort} className="text-white text-right" />
                                    <SortableHead label="Unit Cost" sortKey="cost" sort={sort} onSort={toggleSort} className="text-white text-right" />
                                    <SortableHead label="EOQ" sortKey="eoq" sort={sort} onSort={toggleSort} className="text-white text-right bg-indigo-800" />
                                    <SortableHead label="Orders/Thn" sortKey="_orders" sort={sort} onSort={toggleSort} className="text-white text-right" />
                                    <SortableHead label="Stock" sortKey="stock" sort={sort} onSort={toggleSort} className="text-white text-right" />
                                    <SortableHead label="PO Outst." sortKey="poOutstanding" sort={sort} onSort={toggleSort} className="text-white text-right" />
                                    <SortableHead label="ROP" sortKey="reorderPoint" sort={sort} onSort={toggleSort} className="text-white text-right" />
                                    <SortableHead label="Saran Order" sortKey="suggestedOrder" sort={sort} onSort={toggleSort} className="text-white text-right bg-indigo-800" />
                                    <SortableHead label="Status" sortKey="status" sort={sort} onSort={toggleSort} className="text-white text-center" />
                                </tr>
                            </thead>
                            <TableBody>
                                {filtered.map((item, index) => {
                                    const annualDemand = Math.round(item.averageDailyUsage * 365);
                                    const ordersPerYear = item.eoq > 0 ? (annualDemand / item.eoq).toFixed(1) : '-';
                                    return (
                                        <TableRow key={item.id} className={index % 2 === 0 ? 'bg-white' : 'bg-indigo-50'}>
                                            <TableCell>{index + 1}</TableCell>
                                            <TableCell className="font-medium text-blue-600">{item.itemNo}</TableCell>
                                            <TableCell className="max-w-[200px] truncate">{item.name}</TableCell>
                                            <TableCell className="text-center">
                                                <span className={`px-2 py-1 rounded text-white font-bold text-xs ${item.abcClass === 'A' ? 'bg-red-600' : item.abcClass === 'B' ? 'bg-orange-500' : 'bg-slate-500'}`}>{item.abcClass}</span>
                                            </TableCell>
                                            <TableCell className="text-right">{item.averageDailyUsage}</TableCell>
                                            <TableCell className="text-right">{annualDemand.toLocaleString()}</TableCell>
                                            <TableCell className="text-right">{formatIDR(item.cost)}</TableCell>
                                            <TableCell className="text-right font-bold text-indigo-700 bg-indigo-50">{item.eoq.toLocaleString()}</TableCell>
                                            <TableCell className="text-right">{ordersPerYear}</TableCell>
                                            <TableCell className="text-right">{item.stock}</TableCell>
                                            <TableCell className={`text-right font-medium ${item.poOutstanding > 0 ? 'text-purple-700' : 'text-gray-400'}`}>
                                                {item.poOutstanding > 0 ? `+${item.poOutstanding}` : '-'}
                                            </TableCell>
                                            <TableCell className="text-right">{item.reorderPoint}</TableCell>
                                            <TableCell className="text-right font-bold bg-indigo-50">
                                                {item.suggestedOrder > 0 ? (
                                                    <span className="text-indigo-700">{item.suggestedOrder.toLocaleString()}</span>
                                                ) : (
                                                    <span className="text-green-600">✅</span>
                                                )}
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
