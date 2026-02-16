import React from 'react';
import { InventoryItem } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, Box, DollarSign, Package, TrendingDown, TrendingUp, Zap, Skull } from 'lucide-react';
import { InventoryChart } from '@/components/dashboard/InventoryChart';

interface DashboardViewProps {
    items: InventoryItem[];
}

export const DashboardView: React.FC<DashboardViewProps> = ({ items }) => {
    const totalItems = items.length;
    const totalStockValue = items.reduce((acc, item) => acc + item.stockValue, 0);
    const totalRevenue = items.reduce((acc, item) => acc + item.annualRevenue, 0);
    const criticalItems = items.filter(i => i.status === 'CRITICAL');
    const reorderItems = items.filter(i => i.status === 'REORDER');
    const overstockItems = items.filter(i => i.status === 'OVERSTOCK');
    const deadStockItems = items.filter(i => i.demandCategory === 'DEAD');
    const fastMoving = items.filter(i => i.demandCategory === 'FAST');
    const deadStockValue = deadStockItems.reduce((acc, i) => acc + i.stockValue, 0);

    // Average turnover
    const itemsWithTurnover = items.filter(i => i.turnoverRate > 0);
    const avgTurnover = itemsWithTurnover.length > 0
        ? itemsWithTurnover.reduce((acc, i) => acc + i.turnoverRate, 0) / itemsWithTurnover.length
        : 0;

    const formatIDR = (num: number) => {
        if (num >= 1e9) return `Rp ${(num / 1e9).toFixed(1)}M`;
        if (num >= 1e6) return `Rp ${(num / 1e6).toFixed(0)}jt`;
        return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(num);
    };

    return (
        <div className="space-y-6">
            <h2 className="text-3xl font-bold tracking-tight">Executive Summary</h2>

            {/* Row 1: Main KPIs */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card className="bg-gradient-to-br from-blue-600 to-blue-700 text-white shadow-lg">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium opacity-90">Total SKU</CardTitle>
                        <Package className="h-5 w-5 opacity-75" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-4xl font-bold">{totalItems}</div>
                        <p className="text-xs opacity-75 mt-1">Item aktif di warehouse</p>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-emerald-600 to-emerald-700 text-white shadow-lg">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium opacity-90">Nilai Stok</CardTitle>
                        <DollarSign className="h-5 w-5 opacity-75" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold tracking-tight">{formatIDR(totalStockValue)}</div>
                        <p className="text-xs opacity-75 mt-1">Total aset inventory</p>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-violet-600 to-violet-700 text-white shadow-lg">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium opacity-90">Total Revenue</CardTitle>
                        <TrendingUp className="h-5 w-5 opacity-75" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold tracking-tight">{formatIDR(totalRevenue)}</div>
                        <p className="text-xs opacity-75 mt-1">Penjualan periode analisa</p>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-cyan-600 to-cyan-700 text-white shadow-lg">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium opacity-90">Avg Turnover</CardTitle>
                        <TrendingUp className="h-5 w-5 opacity-75" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-4xl font-bold">{avgTurnover.toFixed(1)}×</div>
                        <p className="text-xs opacity-75 mt-1">Rata-rata perputaran stok/tahun</p>
                    </CardContent>
                </Card>
            </div>

            {/* Row 2: Action KPIs */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
                <Card className="bg-red-600 text-white shadow-lg">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium opacity-90">⚠️ Critical</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold">{criticalItems.length}</div>
                        <p className="text-xs opacity-75">Di bawah safety stock</p>
                    </CardContent>
                </Card>

                <Card className="bg-orange-500 text-white shadow-lg">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium opacity-90">🔔 Reorder</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold">{reorderItems.length}</div>
                        <p className="text-xs opacity-75">Perlu order segera</p>
                    </CardContent>
                </Card>

                <Card className="bg-purple-600 text-white shadow-lg">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium opacity-90">📋 PO Outstanding</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold">{items.filter(i => i.poOutstanding > 0).length}</div>
                        <p className="text-xs opacity-75">Item dengan PO aktif</p>
                    </CardContent>
                </Card>

                <Card className="bg-blue-500 text-white shadow-lg">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium opacity-90">📦 Overstock</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold">{overstockItems.length}</div>
                        <p className="text-xs opacity-75">Stok berlebih (&gt;90 hari)</p>
                    </CardContent>
                </Card>

                <Card className="bg-slate-700 text-white shadow-lg">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium opacity-90">💀 Dead Stock</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold">{deadStockItems.length}</div>
                        <p className="text-xs opacity-75">{formatIDR(deadStockValue)} terikat</p>
                    </CardContent>
                </Card>
            </div>

            <InventoryChart items={items} />
        </div>
    );
};
