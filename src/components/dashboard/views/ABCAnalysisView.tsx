'use client';

import React from 'react';
import { InventoryItem } from '@/lib/types';
import { useTableControls } from '@/lib/useTableControls';
import { TableToolbar, SortableHead } from '../TableToolbar';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";

interface ABCAnalysisViewProps {
    items: InventoryItem[];
}

export const ABCAnalysisView: React.FC<ABCAnalysisViewProps> = ({ items }) => {
    const totalRev = items.reduce((s, i) => s + i.annualRevenue, 0);

    // ABC-XYZ Matrix counts
    const matrix: Record<string, number> = {};
    const classes = ['A', 'B', 'C'];
    const xClasses = ['X', 'Y', 'Z'];
    classes.forEach(a => xClasses.forEach(x => { matrix[`${a}${x}`] = 0; }));
    items.forEach(i => { matrix[`${i.abcClass}${i.xyzClass}`] = (matrix[`${i.abcClass}${i.xyzClass}`] || 0) + 1; });

    const strategies: Record<string, string> = {
        AX: '🟢 Tight control, JIT delivery',
        AY: '🟡 Buffer stock, frequent review',
        AZ: '🔴 High value, unpredictable — strategic stock',
        BX: '🟢 Automated reorder',
        BY: '🟡 Periodic review, moderate buffer',
        BZ: '🟠 Flexible ordering, larger safety stock',
        CX: '🟢 Standard reorder, low attention',
        CY: '🟡 Periodic review, bulk ordering',
        CZ: '⚪ Minimal attention, order on demand',
    };

    // Build Pareto data
    const sortedItems = [...items].sort((a, b) => b.annualRevenue - a.annualRevenue);
    let runningCum = 0;
    const paretoData = sortedItems.map((item, index) => {
        const revPct = totalRev > 0 ? (item.annualRevenue / totalRev) * 100 : 0;
        runningCum += revPct;
        return { ...item, rank: index + 1, revPct, cumPct: runningCum };
    });

    const { search, setSearch, sort, toggleSort, filters, setFilter, clearAll, filtered, activeFilterCount } = useTableControls(
        paretoData,
        ['itemNo', 'name'],
        [
            { key: 'abcClass', label: 'ABC', options: ['A', 'B', 'C'] },
            { key: 'xyzClass', label: 'XYZ', options: ['X', 'Y', 'Z'] },
            { key: 'demandCategory', label: 'Demand', options: ['FAST', 'SLOW', 'NON-MOVING', 'DEAD'] },
        ]
    );

    const formatIDR = (num: number) =>
        new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(num);

    const matrixColor = (a: string, x: string) => {
        const m: Record<string, string> = {
            AX: 'bg-red-600 text-white', AY: 'bg-red-400 text-white', AZ: 'bg-red-300 text-white',
            BX: 'bg-orange-400 text-white', BY: 'bg-orange-300 text-black', BZ: 'bg-yellow-300 text-black',
            CX: 'bg-green-300 text-black', CY: 'bg-green-200 text-black', CZ: 'bg-gray-200 text-black',
        };
        return m[`${a}${x}`] || 'bg-gray-100';
    };

    return (
        <div className="space-y-4">
            {/* ABC-XYZ Matrix Heatmap */}
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle>ABC-XYZ Matrix</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="overflow-auto">
                        <table className="text-sm border-collapse">
                            <thead>
                                <tr>
                                    <th className="border p-2 bg-gray-100 w-20">ABC \ XYZ</th>
                                    {xClasses.map(x => (
                                        <th key={x} className="border p-2 bg-gray-100 text-center w-32">
                                            {x} ({x === 'X' ? 'Stabil' : x === 'Y' ? 'Variabel' : 'Unpredictable'})
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {classes.map(a => (
                                    <tr key={a}>
                                        <td className="border p-2 font-bold bg-gray-50 text-center">{a}</td>
                                        {xClasses.map(x => (
                                            <td key={`${a}${x}`} className={`border p-3 text-center ${matrixColor(a, x)}`}>
                                                <div className="text-2xl font-bold">{matrix[`${a}${x}`]}</div>
                                                <div className="text-xs mt-1 opacity-80">{strategies[`${a}${x}`]}</div>
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>

            {/* Pareto Table */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle>Pareto Analysis (All Items)</CardTitle>
                </CardHeader>
                <CardContent>
                    <TableToolbar
                        search={search} onSearchChange={setSearch}
                        filterOptions={[
                            { key: 'abcClass', label: 'ABC', options: ['A', 'B', 'C'] },
                            { key: 'xyzClass', label: 'XYZ', options: ['X', 'Y', 'Z'] },
                            { key: 'demandCategory', label: 'Demand', options: ['FAST', 'SLOW', 'NON-MOVING', 'DEAD'] },
                        ]}
                        filters={filters} onFilterChange={setFilter}
                        onClearAll={clearAll} activeFilterCount={activeFilterCount}
                        totalItems={paretoData.length} filteredItems={filtered.length}
                    />
                    <div className="rounded-md border max-h-[500px] overflow-auto">
                        <Table>
                            <thead className="bg-purple-600 sticky top-0 z-10">
                                <tr>
                                    <SortableHead label="#" sortKey="rank" sort={sort} onSort={toggleSort} className="text-white w-[50px]" />
                                    <SortableHead label="Kode" sortKey="itemNo" sort={sort} onSort={toggleSort} className="text-white" />
                                    <SortableHead label="Nama Barang" sortKey="name" sort={sort} onSort={toggleSort} className="text-white" />
                                    <SortableHead label="ABC" sortKey="abcClass" sort={sort} onSort={toggleSort} className="text-white text-center" />
                                    <SortableHead label="XYZ" sortKey="xyzClass" sort={sort} onSort={toggleSort} className="text-white text-center" />
                                    <SortableHead label="Revenue" sortKey="annualRevenue" sort={sort} onSort={toggleSort} className="text-white text-right" />
                                    <SortableHead label="Rev %" sortKey="revPct" sort={sort} onSort={toggleSort} className="text-white text-right" />
                                    <SortableHead label="Cum %" sortKey="cumPct" sort={sort} onSort={toggleSort} className="text-white text-right" />
                                    <SortableHead label="Turnover" sortKey="turnoverRate" sort={sort} onSort={toggleSort} className="text-white text-right" />
                                    <SortableHead label="Demand" sortKey="demandCategory" sort={sort} onSort={toggleSort} className="text-white text-center" />
                                </tr>
                            </thead>
                            <TableBody>
                                {filtered.map((item: any, index: number) => (
                                    <TableRow key={item.id} className={
                                        item.abcClass === 'A' ? 'bg-red-50' :
                                            item.abcClass === 'B' ? 'bg-orange-50' :
                                                index % 2 === 0 ? 'bg-white' : 'bg-slate-50'
                                    }>
                                        <TableCell>{item.rank}</TableCell>
                                        <TableCell className="font-medium text-blue-600">{item.itemNo}</TableCell>
                                        <TableCell className="max-w-[200px] truncate">{item.name}</TableCell>
                                        <TableCell className="text-center">
                                            <span className={`px-2 py-1 rounded text-white font-bold text-xs ${item.abcClass === 'A' ? 'bg-red-600' : item.abcClass === 'B' ? 'bg-orange-500' : 'bg-slate-500'}`}>{item.abcClass}</span>
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${item.xyzClass === 'X' ? 'bg-green-100 text-green-800' : item.xyzClass === 'Y' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}`}>{item.xyzClass}</span>
                                        </TableCell>
                                        <TableCell className="text-right">{formatIDR(item.annualRevenue)}</TableCell>
                                        <TableCell className="text-right">{item.revPct.toFixed(2)}%</TableCell>
                                        <TableCell className="text-right font-medium">{item.cumPct.toFixed(1)}%</TableCell>
                                        <TableCell className="text-right">{item.turnoverRate}×</TableCell>
                                        <TableCell className="text-center">
                                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${item.demandCategory === 'FAST' ? 'bg-green-100 text-green-800' : item.demandCategory === 'SLOW' ? 'bg-yellow-100 text-yellow-800' : item.demandCategory === 'DEAD' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'}`}>{item.demandCategory}</span>
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
};
