'use client';

import React from 'react';
import { InventoryItem } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';

interface InventoryChartProps {
    items: InventoryItem[];
}

const STATUS_COLORS = {
    'OK': '#22c55e',
    'REORDER': '#f97316',
    'CRITICAL': '#ef4444',
    'OVERSTOCK': '#3b82f6',
};

const DEMAND_COLORS = {
    'FAST': '#22c55e',
    'SLOW': '#eab308',
    'NON-MOVING': '#f97316',
    'DEAD': '#6b7280',
};

const formatIDR = (num: number) => {
    if (num >= 1e9) return `Rp ${(num / 1e9).toFixed(1)}M`;
    if (num >= 1e6) return `Rp ${(num / 1e6).toFixed(0)}jt`;
    return `Rp ${num.toLocaleString()}`;
};

export const InventoryChart: React.FC<InventoryChartProps> = ({ items }) => {
    // Status distribution
    const statusData = Object.entries(
        items.reduce((acc, item) => {
            acc[item.status] = (acc[item.status] || 0) + 1;
            return acc;
        }, {} as Record<string, number>)
    ).map(([name, value]) => ({ name, value }));

    // Demand category distribution
    const demandData = Object.entries(
        items.reduce((acc, item) => {
            acc[item.demandCategory] = (acc[item.demandCategory] || 0) + 1;
            return acc;
        }, {} as Record<string, number>)
    ).map(([name, value]) => ({ name, value }));

    // ABC class stock value
    const abcData = ['A', 'B', 'C'].map(cls => {
        const group = items.filter(i => i.abcClass === cls);
        return {
            name: `Kelas ${cls}`,
            'Nilai Stok': group.reduce((s, i) => s + i.stockValue, 0),
            'Revenue': group.reduce((s, i) => s + i.annualRevenue, 0),
            count: group.length,
        };
    });

    // Category stock value (top 10 categories)
    const categoryMap: Record<string, number> = {};
    items.forEach(item => {
        categoryMap[item.category] = (categoryMap[item.category] || 0) + item.stockValue;
    });
    const categoryData = Object.entries(categoryMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([name, value]) => ({ name: name.length > 15 ? name.slice(0, 12) + '...' : name, value }));

    return (
        <div className="grid gap-6 md:grid-cols-2">
            {/* Status Distribution */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Status Inventory</CardTitle>
                </CardHeader>
                <CardContent>
                    <ResponsiveContainer width="100%" height={250}>
                        <PieChart>
                            <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, value }) => `${name}: ${value}`}>
                                {statusData.map((entry) => (
                                    <Cell key={entry.name} fill={STATUS_COLORS[entry.name as keyof typeof STATUS_COLORS] || '#94a3b8'} />
                                ))}
                            </Pie>
                            <Tooltip />
                            <Legend />
                        </PieChart>
                    </ResponsiveContainer>
                </CardContent>
            </Card>

            {/* Demand Category */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Demand Category</CardTitle>
                </CardHeader>
                <CardContent>
                    <ResponsiveContainer width="100%" height={250}>
                        <PieChart>
                            <Pie data={demandData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, value }) => `${name}: ${value}`}>
                                {demandData.map((entry) => (
                                    <Cell key={entry.name} fill={DEMAND_COLORS[entry.name as keyof typeof DEMAND_COLORS] || '#94a3b8'} />
                                ))}
                            </Pie>
                            <Tooltip />
                            <Legend />
                        </PieChart>
                    </ResponsiveContainer>
                </CardContent>
            </Card>

            {/* ABC Value Comparison */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">ABC Class — Nilai Stok vs Revenue</CardTitle>
                </CardHeader>
                <CardContent>
                    <ResponsiveContainer width="100%" height={250}>
                        <BarChart data={abcData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="name" />
                            <YAxis tickFormatter={(v) => formatIDR(v)} />
                            <Tooltip formatter={(v: any) => formatIDR(Number(v))} />
                            <Legend />
                            <Bar dataKey="Nilai Stok" fill="#3b82f6" />
                            <Bar dataKey="Revenue" fill="#22c55e" />
                        </BarChart>
                    </ResponsiveContainer>
                </CardContent>
            </Card>

            {/* Category Stock Value */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Top 10 Category by Nilai Stok</CardTitle>
                </CardHeader>
                <CardContent>
                    <ResponsiveContainer width="100%" height={250}>
                        <BarChart data={categoryData} layout="vertical">
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis type="number" tickFormatter={(v) => formatIDR(v)} />
                            <YAxis type="category" dataKey="name" width={100} />
                            <Tooltip formatter={(v: any) => formatIDR(Number(v))} />
                            <Bar dataKey="value" fill="#8b5cf6" name="Nilai Stok" />
                        </BarChart>
                    </ResponsiveContainer>
                </CardContent>
            </Card>
        </div>
    );
};
