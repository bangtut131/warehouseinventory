'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import axios from 'axios';
import { InventoryItem } from '@/lib/types';
import { DashboardView } from './views/DashboardView';
import { ROPAnalysisView } from './views/ROPAnalysisView';
import { ABCAnalysisView } from './views/ABCAnalysisView';
import { MonthlyTrendView } from './views/MonthlyTrendView';
import { AlertsView } from './views/AlertsView';
import { OverstockView } from './views/OverstockView';
import { TopItemsView } from './views/TopItemsView';
import { EOQView } from './views/EOQView';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { exportAllAnalysis } from '@/lib/exportExcel';
import { SchedulerPanel } from './SchedulerPanel';
import { BroadcastPanel } from './BroadcastPanel';

function formatDateParam(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

interface SyncStatus {
    status: 'idle' | 'running' | 'done' | 'error';
    progress: number;
    phase: string;
    message: string;
    elapsedSec?: number;
    itemCount?: number;
    invoiceCount?: number;
}

interface Branch {
    id: number;
    name: string;
    defaultBranch: boolean;
}

interface Warehouse {
    id: number;
    name: string;
    defaultWarehouse: boolean;
}

export default function InventoryDashboard() {
    const [items, setItems] = useState<InventoryItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('dashboard');
    const [dataSource, setDataSource] = useState<'API' | 'ESTIMATED'>('ESTIMATED');

    // Date range state
    const [fromDate, setFromDate] = useState('2025-01-01');
    const [toDate, setToDate] = useState(formatDateParam(new Date()));

    // Branch & warehouse state
    const [branches, setBranches] = useState<Branch[]>([]);
    const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
    const [selectedBranch, setSelectedBranch] = useState<string>('');  // '' = all
    const [selectedWarehouse, setSelectedWarehouse] = useState<string>(''); // '' = all
    const [loadingLocations, setLoadingLocations] = useState(true);

    // Sync state
    const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
    const pollRef = useRef<NodeJS.Timeout | null>(null);

    // ─── Fetch branch & warehouse lists ──────────────────────────
    useEffect(() => {
        async function loadLocations() {
            try {
                const res = await axios.get('/api/branches');
                if (res.data) {
                    setBranches(res.data.branches || []);
                    setWarehouses(res.data.warehouses || []);
                }
            } catch (err) {
                console.error('Failed to load branches/warehouses', err);
            } finally {
                setLoadingLocations(false);
            }
        }
        loadLocations();
    }, []);

    // ─── Fetch inventory data ────────────────────────────────────
    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (fromDate) params.set('from', fromDate);
            if (toDate) params.set('to', toDate);
            if (selectedBranch) params.set('branch', selectedBranch);
            if (selectedWarehouse) params.set('warehouse', selectedWarehouse);
            const url = `/api/inventory?${params.toString()}`;
            const res = await axios.get(url);
            if (Array.isArray(res.data)) {
                setItems(res.data);
                if (res.data.length > 0) {
                    setDataSource(res.data[0].dataSource || 'ESTIMATED');
                }
            }
        } catch (error) {
            console.error('Failed to fetch inventory data', error);
        } finally {
            setLoading(false);
        }
    }, [fromDate, toDate, selectedBranch, selectedWarehouse]);

    // Poll sync status
    const pollSyncStatus = useCallback(async () => {
        try {
            const res = await axios.get('/api/sync');
            const state: SyncStatus = res.data;
            setSyncStatus(state);

            if (state.status === 'done') {
                if (pollRef.current) clearInterval(pollRef.current);
                pollRef.current = null;
                await fetchData();
            } else if (state.status === 'error') {
                if (pollRef.current) clearInterval(pollRef.current);
                pollRef.current = null;
            }
        } catch {
            // ignore poll errors
        }
    }, [fetchData]);

    // Start force sync
    const startForceSync = useCallback(async () => {
        const branchName = selectedBranch
            ? branches.find(b => b.id === parseInt(selectedBranch))?.name || `Branch ${selectedBranch}`
            : 'Semua Cabang';
        if (!confirm(`Force Sync akan fetch ulang data penjualan dari Accurate.\nCabang: ${branchName}\nProses ini membutuhkan waktu beberapa menit.\n\nLanjutkan?`)) {
            return;
        }

        try {
            setSyncStatus({ status: 'running', progress: 0, phase: 'starting', message: 'Memulai...' });
            const body: any = { from: fromDate };
            if (selectedBranch) body.branch = selectedBranch;
            await axios.post('/api/sync', body);

            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = setInterval(pollSyncStatus, 3000);
        } catch (err: any) {
            if (err.response?.status === 409) {
                if (pollRef.current) clearInterval(pollRef.current);
                pollRef.current = setInterval(pollSyncStatus, 3000);
            } else {
                setSyncStatus({ status: 'error', progress: 0, phase: 'error', message: err.message });
            }
        }
    }, [fromDate, selectedBranch, branches, pollSyncStatus]);

    // Cleanup polling on unmount
    useEffect(() => {
        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, []);

    useEffect(() => {
        fetchData();
    }, []);

    // Format elapsed time
    const formatElapsed = (sec?: number) => {
        if (!sec) return '';
        const min = Math.floor(sec / 60);
        const s = sec % 60;
        return min > 0 ? `${min}m ${s}s` : `${s}s`;
    };

    if (loading && items.length === 0 && !syncStatus) {
        return (
            <div className="p-12 text-center">
                <div className="inline-block w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4" />
                <p className="text-muted-foreground text-lg">Mengambil data dari Accurate API...</p>
                <p className="text-sm text-muted-foreground mt-1">Memproses 800+ item inventory</p>
            </div>
        );
    }

    const tabs = [
        { id: 'dashboard', label: '📊 Dashboard', color: '' },
        { id: 'rop', label: '🎯 ROP Analysis', color: '' },
        { id: 'abc', label: '🔠 ABC-XYZ Matrix', color: '' },
        { id: 'eoq', label: '📦 EOQ Analysis', color: '' },
        { id: 'trends', label: '📈 Trends', color: '' },
        { id: 'alerts', label: '🚨 Alerts', color: 'text-red-600 border-red-200 hover:bg-red-50' },
        { id: 'overstock', label: '📦 Overstock', color: 'text-blue-600 border-blue-200 hover:bg-blue-50' },
        { id: 'top', label: '🏆 Top Items', color: '' },
    ];

    const renderContent = () => {
        switch (activeTab) {
            case 'dashboard': return <DashboardView items={items} />;
            case 'rop': return <ROPAnalysisView items={items} />;
            case 'abc': return <ABCAnalysisView items={items} />;
            case 'eoq': return <EOQView items={items} />;
            case 'trends': return <MonthlyTrendView items={items} />;
            case 'alerts': return <AlertsView items={items} />;
            case 'overstock': return <OverstockView items={items} />;
            case 'top': return <TopItemsView items={items} />;
            default: return <DashboardView items={items} />;
        }
    };

    const isSyncing = syncStatus?.status === 'running';

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 border-b pb-4">
                {/* Row 1: Title + Data Source */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <img src="/logo.png" alt="Gama Agro Sejati" className="h-9" />
                        <h1 className="text-2xl font-bold">Inventory Intelligence</h1>
                        <div className="flex items-center gap-2 mt-1">
                            <Badge variant="outline" className={dataSource === 'API'
                                ? 'bg-green-50 text-green-700 border-green-300'
                                : 'bg-amber-50 text-amber-700 border-amber-300'
                            }>
                                {dataSource === 'API' ? '🟢 Data Real (API)' : '🟡 Smart Estimation'}
                            </Badge>
                            <span className="text-xs text-muted-foreground">{items.length} SKU</span>
                            {selectedBranch && (
                                <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-300">
                                    🏢 {branches.find(b => b.id === parseInt(selectedBranch))?.name || 'Branch'}
                                </Badge>
                            )}
                            {selectedWarehouse && (
                                <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-300">
                                    🏭 {warehouses.find(w => w.id === parseInt(selectedWarehouse))?.name || 'Gudang'}
                                </Badge>
                            )}
                        </div>
                    </div>
                    {/* Action Buttons */}
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => fetchData()}
                            disabled={loading}
                            className="flex items-center gap-1.5"
                        >
                            {loading ? '⏳ Loading...' : '🔄 Refresh'}
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={startForceSync}
                            disabled={loading || isSyncing}
                            className="flex items-center gap-1.5 border-orange-300 text-orange-700 hover:bg-orange-50"
                        >
                            {isSyncing ? '⏳ Syncing...' : '🔃 Force Sync'}
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => exportAllAnalysis(items)}
                            disabled={items.length === 0}
                            className="flex items-center gap-1.5 border-green-300 text-green-700 hover:bg-green-50"
                        >
                            📥 Export
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={async () => {
                                await fetch('/api/auth/logout', { method: 'POST' });
                                window.location.href = '/login';
                            }}
                            className="flex items-center gap-1.5 border-red-300 text-red-600 hover:bg-red-50"
                        >
                            🚪 Logout
                        </Button>
                    </div>
                </div>

                {/* Row 2: Filters — Branch, Warehouse, Date Range */}
                <div className="flex flex-wrap items-center gap-3">
                    {/* Branch Selector */}
                    <div className="flex items-center gap-2 bg-muted/40 rounded-lg px-3 py-1.5 border">
                        <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">🏢 Cabang:</span>
                        <select
                            value={selectedBranch}
                            onChange={(e) => setSelectedBranch(e.target.value)}
                            className="bg-transparent text-sm border-none outline-none cursor-pointer min-w-[120px]"
                            disabled={loadingLocations}
                        >
                            <option value="">Semua Cabang</option>
                            {branches.map(b => (
                                <option key={b.id} value={b.id}>
                                    {b.name}{b.defaultBranch ? ' (Default)' : ''}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Warehouse Selector */}
                    <div className="flex items-center gap-2 bg-muted/40 rounded-lg px-3 py-1.5 border">
                        <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">🏭 Gudang:</span>
                        <select
                            value={selectedWarehouse}
                            onChange={(e) => setSelectedWarehouse(e.target.value)}
                            className="bg-transparent text-sm border-none outline-none cursor-pointer min-w-[140px]"
                            disabled={loadingLocations}
                        >
                            <option value="">Semua Gudang</option>
                            {warehouses.map(w => (
                                <option key={w.id} value={w.id}>
                                    {w.name}{w.defaultWarehouse ? ' (Default)' : ''}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Date Range */}
                    <div className="flex items-center gap-2 bg-muted/40 rounded-lg px-3 py-1.5 border">
                        <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">📅 Range:</span>
                        <input
                            type="date"
                            value={fromDate}
                            onChange={(e) => setFromDate(e.target.value)}
                            className="bg-transparent text-sm border-none outline-none w-[130px] cursor-pointer"
                        />
                        <span className="text-xs text-muted-foreground">→</span>
                        <input
                            type="date"
                            value={toDate}
                            onChange={(e) => setToDate(e.target.value)}
                            className="bg-transparent text-sm border-none outline-none w-[130px] cursor-pointer"
                        />
                    </div>
                </div>
            </div>

            {/* Sync Progress Banner */}
            {isSyncing && syncStatus && (
                <div className="bg-orange-50 border border-orange-200 rounded-lg px-4 py-3 space-y-2">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-5 h-5 border-[3px] border-orange-500 border-t-transparent rounded-full animate-spin" />
                            <div>
                                <p className="text-sm font-medium text-orange-800">
                                    Force Sync sedang berjalan...
                                </p>
                                <p className="text-xs text-orange-600">
                                    {syncStatus.message}
                                    {syncStatus.elapsedSec ? ` (${formatElapsed(syncStatus.elapsedSec)})` : ''}
                                </p>
                            </div>
                        </div>
                        <span className="text-sm font-bold text-orange-700">{syncStatus.progress}%</span>
                    </div>
                    <div className="w-full bg-orange-100 rounded-full h-2.5">
                        <div
                            className="bg-orange-500 h-2.5 rounded-full transition-all duration-500 ease-out"
                            style={{ width: `${syncStatus.progress}%` }}
                        />
                    </div>
                </div>
            )}

            {/* Sync Done Banner */}
            {syncStatus?.status === 'done' && (
                <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <span className="text-green-600 text-lg">✅</span>
                        <div>
                            <p className="text-sm font-medium text-green-800">Sync selesai!</p>
                            <p className="text-xs text-green-600">{syncStatus.message}</p>
                        </div>
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSyncStatus(null)}
                        className="text-green-600 hover:text-green-800"
                    >
                        ✕
                    </Button>
                </div>
            )}

            {/* Sync Error Banner */}
            {syncStatus?.status === 'error' && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <span className="text-red-600 text-lg">❌</span>
                        <div>
                            <p className="text-sm font-medium text-red-800">Sync gagal</p>
                            <p className="text-xs text-red-600">{syncStatus.message}</p>
                        </div>
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSyncStatus(null)}
                        className="text-red-600 hover:text-red-800"
                    >
                        ✕
                    </Button>
                </div>
            )}

            {/* Auto-Sync Scheduler Panel */}
            <SchedulerPanel branches={branches} />

            {/* WA Broadcast Panel */}
            <BroadcastPanel branches={branches} warehouses={warehouses} />

            {/* Tabs */}
            <div className="flex flex-wrap gap-1.5">
                {tabs.map(tab => (
                    <Button
                        key={tab.id}
                        variant={activeTab === tab.id ? 'default' : 'outline'}
                        onClick={() => setActiveTab(tab.id)}
                        size="sm"
                        className={activeTab !== tab.id ? tab.color : ''}
                    >
                        {tab.label}
                    </Button>
                ))}
            </div>

            <div className="min-h-[600px]">
                {renderContent()}
            </div>
        </div>
    );
}
