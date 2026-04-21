'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { SOData } from '@/lib/types';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import axios from 'axios';
import * as XLSX from 'xlsx';

interface SOControlViewProps {
    branches?: { id: number; name: string }[];
}

interface SOSyncState {
    status: 'idle' | 'running' | 'done' | 'error';
    progress: number;
    message: string;
}

// ─── SO Auto-Sync Panel ──────────────────────────────────────

interface SOSchedulerConfig {
    enabled: boolean;
    cronExpression: string;
    intervalLabel: string;
    branchId: number | null;
}

interface SOSchedulerStatus {
    config: SOSchedulerConfig;
    isRunning: boolean;
    isSyncing: boolean;
    cronActive: boolean;
    history: {
        id: number;
        startedAt: string;
        completedAt: string | null;
        status: 'success' | 'error' | 'running';
        durationSec: number | null;
        soCount: number | null;
        error: string | null;
        trigger: 'scheduled' | 'manual';
    }[];
}

const SO_INTERVAL_OPTIONS = [
    { label: 'Setiap 2 Jam', cron: '0 */2 * * *' },
    { label: 'Setiap 4 Jam', cron: '0 */4 * * *' },
    { label: 'Setiap 6 Jam', cron: '0 */6 * * *' },
    { label: 'Setiap 12 Jam', cron: '0 */12 * * *' },
    { label: 'Setiap 24 Jam (00:00)', cron: '0 0 * * *' },
];

const ALL_DELIVERY_STATUSES = ['Dikirim', 'Difaktur Sebagian', 'Difaktur', 'Ditolak', 'Diajukan', 'Draf', 'Belum dikirim'];
const ALL_DISPATCH_STATUSES = ['Selesai', 'Sudah Berangkat', 'Sebagian Berangkat', 'Belum Berangkat', 'Belum Dijadwalkan'];

export const SOControlView: React.FC<SOControlViewProps> = ({ branches = [] }) => {
    const [soList, setSoList] = useState<SOData[]>([]);
    const [loading, setLoading] = useState(true);
    const [syncState, setSyncState] = useState<SOSyncState>({ status: 'idle', progress: 0, message: '' });
    const [expandedId, setExpandedId] = useState<number | null>(null);

    // Filters
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [deliveryStatusFilter, setDeliveryStatusFilter] = useState('');
    const [branchFilter, setBranchFilter] = useState('');
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');
    const [dispatchStatusFilter, setDispatchStatusFilter] = useState('');

    // Sync status filter (which statuses to fetch from API)
    const ALL_SO_STATUSES = ['Diajukan', 'Menunggu diproses', 'Sebagian diproses', 'Terproses'];
    const [syncStatuses, setSyncStatuses] = useState<string[]>([]);

    // Auto-sync panel
    const [schedulerStatus, setSchedulerStatus] = useState<SOSchedulerStatus | null>(null);
    const [schedulerExpanded, setSchedulerExpanded] = useState(false);
    const [schedulerUpdating, setSchedulerUpdating] = useState(false);

    const toggleSyncStatus = (status: string) => {
        setSyncStatuses(prev =>
            prev.includes(status) ? prev.filter(s => s !== status) : [...prev, status]
        );
    };

    // Refs for synced horizontal scrolling
    const topScrollRef = useRef<HTMLDivElement>(null);
    const bottomScrollRef = useRef<HTMLDivElement>(null);

    const handleTopScroll = () => {
        if (bottomScrollRef.current && topScrollRef.current) {
            bottomScrollRef.current.scrollLeft = topScrollRef.current.scrollLeft;
        }
    };

    const handleBottomScroll = () => {
        if (topScrollRef.current && bottomScrollRef.current) {
            topScrollRef.current.scrollLeft = bottomScrollRef.current.scrollLeft;
        }
    };

    const fetchSO = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (branchFilter) params.set('branch', branchFilter);
            if (statusFilter) params.set('status', statusFilter);
            if (fromDate) params.set('from', fromDate);
            if (toDate) params.set('to', toDate);

            const res = await fetch(`/api/so?${params.toString()}`);
            const data = await res.json();
            setSoList(data.soList || []);
            if (data.syncState) setSyncState(data.syncState);
        } catch (err) {
            console.error('Failed to fetch SO data:', err);
        } finally {
            setLoading(false);
        }
    }, [branchFilter, statusFilter, fromDate, toDate]);

    useEffect(() => { fetchSO(); }, [fetchSO]);

    // Poll sync status while running
    useEffect(() => {
        if (syncState.status !== 'running') return;
        const interval = setInterval(async () => {
            try {
                const res = await fetch('/api/so');
                const data = await res.json();
                if (data.syncState) setSyncState(data.syncState);
                if (data.syncState?.status === 'done' || data.syncState?.status === 'error') {
                    setSoList(data.soList || []);
                    clearInterval(interval);
                }
            } catch { /* ignore */ }
        }, 2000);
        return () => clearInterval(interval);
    }, [syncState.status]);

    // Fetch scheduler status
    const fetchSchedulerStatus = useCallback(async () => {
        try {
            const res = await axios.get('/api/so-scheduler');
            setSchedulerStatus(res.data);
        } catch (err) {
            console.error('Failed to fetch SO scheduler status', err);
        }
    }, []);

    useEffect(() => {
        fetchSchedulerStatus();
        const timer = setInterval(fetchSchedulerStatus, 30000);
        return () => clearInterval(timer);
    }, [fetchSchedulerStatus]);

    const updateSchedulerConfig = async (updates: Partial<SOSchedulerConfig>) => {
        setSchedulerUpdating(true);
        try {
            await axios.post('/api/so-scheduler', updates);
            await fetchSchedulerStatus();
        } catch (err: any) {
            alert('Gagal update config: ' + (err.response?.data?.error || err.message));
        } finally {
            setSchedulerUpdating(false);
        }
    };

    const triggerManualSOSync = async () => {
        try {
            await axios.post('/api/so-scheduler?action=trigger');
            await fetchSchedulerStatus();
        } catch (err) {
            console.error('Failed to trigger SO sync', err);
        }
    };

    const exportToExcel = () => {
        if (filtered.length === 0) {
            alert('Tidak ada data untuk di-export');
            return;
        }

        const dataToExport: any[] = [];
        filtered.forEach((so: any) => {
            if (so.detailItems && so.detailItems.length > 0) {
                so.detailItems.forEach((item: any) => {
                    dataToExport.push({
                        'No. SO': so.soNumber,
                        'No. DO': so.doNumberText || '-',
                        'Tanggal': so.transDate,
                        'ID Customer': so.customerNo || '-',
                        'Customer': so.customerName,
                        'Kota/Kab': so.shipCity || '-',
                        'Provinsi': so.shipProvince || '-',
                        'Area': so.area || '-',
                        'Cluster': so.cluster || '-',
                        'Sub Cluster': so.subCluster || '-',
                        'Status': so.statusName,
                        'Status Kiriman': so.deliveryStatus || 'Belum dikirim',
                        'Status Armada': so.dispatchStatus || '-',
                        'Kode Barang': item.itemNo,
                        'Nama Barang': item.itemName,
                        'Qty Pesanan': item.quantity,
                        'Qty Terkirim': item.shipQuantity || 0,
                        'Outstanding': item.outstanding,
                        'Satuan': item.unitName || '',
                        'Isi/Box': item.isiPerBox || '-',
                        'Qty (Pcs)': item.qtyPcs ?? item.quantity,
                        'Outstanding (Pcs)': item.outstandingPcs ?? item.outstanding,
                        'Stock (Pcs)': item.stock ?? '-',
                        'Stock (Box)': item.stock !== undefined && item.isiPerBox ? Math.floor(item.stock / item.isiPerBox) : '-',
                        'Berat (kg)': item.totalWeightKg ? item.totalWeightKg.toFixed(1) : '-',
                        'Volume (m³)': item.totalVolumeM3 ? item.totalVolumeM3.toFixed(4) : '-',
                    });
                });
            } else {
                dataToExport.push({
                    'No. SO': so.soNumber,
                    'No. DO': so.doNumberText || '-',
                    'Tanggal': so.transDate,
                    'ID Customer': so.customerNo || '-',
                    'Customer': so.customerName,
                    'Kota/Kab': so.shipCity || '-',
                    'Provinsi': so.shipProvince || '-',
                    'Area': so.area || '-',
                    'Cluster': so.cluster || '-',
                    'Sub Cluster': so.subCluster || '-',
                    'Status': so.statusName,
                    'Status Kiriman': so.deliveryStatus || 'Belum dikirim',
                    'Status Armada': so.dispatchStatus || '-',
                    'Kode Barang': '-',
                    'Nama Barang': '-',
                    'Qty Pesanan': 0,
                    'Qty Terkirim': 0,
                    'Outstanding': so.totalOutstanding || 0,
                    'Satuan': '',
                    'Isi/Box': '-',
                    'Qty (Pcs)': 0,
                    'Outstanding (Pcs)': 0,
                    'Stock (Pcs)': '-',
                    'Stock (Box)': '-',
                    'Berat (kg)': '-',
                    'Volume (m³)': '-',
                });
            }
        });

        const ws = XLSX.utils.json_to_sheet(dataToExport);
        
        // Auto-sizing columns (basic approach)
        const colWidths = [
            { wch: 15 }, // SO
            { wch: 20 }, // DO
            { wch: 12 }, // Tanggal
            { wch: 15 }, // ID Customer
            { wch: 30 }, // Customer
            { wch: 18 }, // Kota/Kab
            { wch: 18 }, // Provinsi
            { wch: 15 }, // Area
            { wch: 15 }, // Cluster
            { wch: 15 }, // Sub Cluster
            { wch: 15 }, // Status
            { wch: 18 }, // Status Kiriman
            { wch: 18 }, // Status Armada
            { wch: 15 }, // Kode Barang
            { wch: 40 }, // Nama Barang
            { wch: 12 }, // Qty
            { wch: 12 }, // Shipped
            { wch: 12 }, // Outstanding
            { wch: 10 }, // Satuan
            { wch: 10 }, // Isi/Box
            { wch: 12 }, // Qty (Pcs)
            { wch: 16 }, // Outstanding (Pcs)
            { wch: 12 }, // Stock (Pcs)
            { wch: 12 }, // Stock (Box)
            { wch: 12 }, // Berat (kg)
            { wch: 14 }, // Volume (m³)
        ];
        ws['!cols'] = colWidths;

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Sales Orders");
        XLSX.writeFile(wb, `SO_Outstanding_${new Date().toISOString().split('T')[0]}.xlsx`);
    };

    const startSync = async () => {
        setSyncState({ status: 'running', progress: 0, message: 'Memulai sync SO...' });
        try {
            await fetch('/api/so', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    branch: branchFilter || undefined,
                    from: fromDate || undefined,
                    to: toDate || undefined,
                    statuses: syncStatuses.length > 0 && syncStatuses.length < ALL_SO_STATUSES.length ? syncStatuses : undefined,
                }),
            });
        } catch (err) {
            console.error('Failed to start SO sync:', err);
        }
    };

    // Apply filters client-side
    const filtered = soList.filter(so => {
        // Checkbox status filter
        if (syncStatuses.length > 0 && syncStatuses.length < ALL_SO_STATUSES.length) {
            const lowerSyncStatuses = syncStatuses.map(s => s.toLowerCase());
            if (!lowerSyncStatuses.includes(so.statusName.toLowerCase())) return false;
        }

        // Delivery status filter
        if (deliveryStatusFilter) {
            const soDelivery = (so.deliveryStatus || 'Belum dikirim').toLowerCase();
            if (soDelivery !== deliveryStatusFilter.toLowerCase()) return false;
        }

        // Dispatch/armada status filter
        if (dispatchStatusFilter) {
            const soDispatch = ((so as any).dispatchStatus || '').toLowerCase();
            if (dispatchStatusFilter === 'Belum Dijadwalkan' && soDispatch === '') {
                // match empty dispatch status
            } else if (soDispatch !== dispatchStatusFilter.toLowerCase()) {
                return false;
            }
        }

        if (!search) return true;
        const q = search.toLowerCase();
        return so.soNumber.toLowerCase().includes(q) ||
            so.customerName.toLowerCase().includes(q) ||
            so.detailItems.some(d => d.itemNo.toLowerCase().includes(q) || d.itemName.toLowerCase().includes(q));
    });

    // Summary counts
    const diajukan = filtered.filter(s => s.statusName.toLowerCase() === 'diajukan').length;
    const menunggu = filtered.filter(s => s.statusName.toLowerCase() === 'menunggu diproses').length;
    const sebagian = filtered.filter(s => s.statusName.toLowerCase() === 'sebagian diproses').length;
    const terproses = filtered.filter(s => s.statusName.toLowerCase() === 'terproses').length;
    const totalOutstandingQty = filtered.reduce((sum, s) => sum + s.totalOutstanding, 0);

    const getStatusColor = (status: string) => {
        const s = status.toLowerCase();
        if (s === 'diajukan') return 'bg-blue-100 text-blue-700 border-blue-300';
        if (s === 'menunggu diproses') return 'bg-amber-100 text-amber-700 border-amber-300';
        if (s === 'sebagian diproses') return 'bg-orange-100 text-orange-700 border-orange-300';
        if (s === 'terproses') return 'bg-green-100 text-green-700 border-green-300';
        return 'bg-gray-100 text-gray-700 border-gray-300';
    };

    const getDeliveryStatusColor = (status: string) => {
        const s = (status || '').toLowerCase();
        if (s === 'difaktur') return 'bg-green-100 text-green-700 border-green-300';
        if (s === 'difaktur sebagian') return 'bg-amber-100 text-amber-700 border-amber-300';
        if (s === 'dikirim') return 'bg-blue-100 text-blue-700 border-blue-300';
        if (s === 'diajukan') return 'bg-orange-100 text-orange-700 border-orange-300';
        if (s === 'draf') return 'bg-gray-100 text-gray-500 border-gray-300';
        if (s === 'ditolak') return 'bg-red-100 text-red-700 border-red-300';
        if (s === 'belum dikirim') return 'bg-gray-50 text-gray-400 border-gray-200';
        return 'bg-gray-100 text-gray-700 border-gray-300';
    };

    const formatDate = (dateStr: string) => {
        const parts = dateStr.split('/');
        if (parts.length === 3) {
            const months = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
            return `${parseInt(parts[0])} ${months[parseInt(parts[1])]} ${parts[2]}`;
        }
        return dateStr;
    };

    const formatDateTime = (iso: string) => {
        const d = new Date(iso);
        return d.toLocaleString('id-ID', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    };

    const formatDuration = (sec: number | null) => {
        if (!sec) return '-';
        const min = Math.floor(sec / 60);
        const s = sec % 60;
        return min > 0 ? `${min}m ${s}s` : `${s}s`;
    };

    const selectedIntervalIdx = schedulerStatus
        ? SO_INTERVAL_OPTIONS.findIndex(o => o.cron === schedulerStatus.config.cronExpression)
        : -1;

    return (
        <div className="space-y-4">
            {/* Summary Cards */}
            <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
                <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white">
                    <CardContent className="p-4">
                        <div className="text-2xl font-bold">{diajukan}</div>
                        <p className="text-xs opacity-80">📝 Diajukan</p>
                    </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-amber-500 to-amber-600 text-white">
                    <CardContent className="p-4">
                        <div className="text-2xl font-bold">{menunggu}</div>
                        <p className="text-xs opacity-80">⏳ Menunggu Diproses</p>
                    </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-orange-500 to-orange-600 text-white">
                    <CardContent className="p-4">
                        <div className="text-2xl font-bold">{sebagian}</div>
                        <p className="text-xs opacity-80">🔄 Sebagian Diproses</p>
                    </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-green-500 to-green-600 text-white">
                    <CardContent className="p-4">
                        <div className="text-2xl font-bold">{terproses}</div>
                        <p className="text-xs opacity-80">✅ Terproses</p>
                    </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-purple-500 to-purple-600 text-white">
                    <CardContent className="p-4">
                        <div className="text-2xl font-bold">{totalOutstandingQty.toLocaleString('id-ID')}</div>
                        <p className="text-xs opacity-80">📦 Total Outstanding Qty</p>
                    </CardContent>
                </Card>
            </div>

            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-3 bg-muted/30 rounded-lg p-3 border">
                {/* Search */}
                <Input
                    placeholder="🔍 Cari SO / Customer / Item..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="max-w-[250px] h-9"
                />

                {/* Status Filter */}
                <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="h-9 px-3 rounded-md border text-sm bg-background cursor-pointer"
                >
                    <option value="">Semua Status</option>
                    <option value="Diajukan">Diajukan</option>
                    <option value="Menunggu diproses">Menunggu Diproses</option>
                    <option value="Sebagian diproses">Sebagian Diproses</option>
                    <option value="Terproses">Terproses</option>
                </select>

                {/* Delivery Status Filter */}
                <select
                    value={deliveryStatusFilter}
                    onChange={(e) => setDeliveryStatusFilter(e.target.value)}
                    className="h-9 px-3 rounded-md border text-sm bg-background cursor-pointer"
                >
                    <option value="">Semua Kiriman</option>
                    {ALL_DELIVERY_STATUSES.map(s => (
                        <option key={s} value={s}>{s}</option>
                    ))}
                </select>

                {/* Branch Filter */}
                {branches.length > 0 && (
                    <select
                        value={branchFilter}
                        onChange={(e) => setBranchFilter(e.target.value)}
                        className="h-9 px-3 rounded-md border text-sm bg-background cursor-pointer"
                    >
                        <option value="">Semua Cabang</option>
                        {branches.map(b => (
                            <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                    </select>
                )}

                {/* Date Range */}
                <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">📅</span>
                    <input
                        type="date"
                        value={fromDate}
                        onChange={(e) => setFromDate(e.target.value)}
                        className="h-9 px-2 rounded-md border text-sm bg-background cursor-pointer w-[135px]"
                    />
                    <span className="text-xs text-muted-foreground">→</span>
                    <input
                        type="date"
                        value={toDate}
                        onChange={(e) => setToDate(e.target.value)}
                        className="h-9 px-2 rounded-md border text-sm bg-background cursor-pointer w-[135px]"
                    />
                </div>

                {/* Spacer */}
                <div className="flex-1" />

                {/* Export Button */}
                <Button
                    onClick={exportToExcel}
                    size="sm"
                    variant="outline"
                    className="border-emerald-500 text-emerald-600 hover:bg-emerald-50"
                >
                    📊 Export Excel
                </Button>

                {/* Sync Button */}
                <Button
                    onClick={startSync}
                    disabled={syncState.status === 'running'}
                    size="sm"
                    className="bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                    {syncState.status === 'running' ? `⏳ ${syncState.progress}%` : '🔄 Sync SO'}
                </Button>
            </div>

            <div className="flex flex-wrap items-center gap-3 bg-indigo-50/50 rounded-lg px-3 py-2 border border-indigo-200">
                <span className="text-xs font-medium text-indigo-600">🔄 Sync status:</span>
                {ALL_SO_STATUSES.map(status => (
                    <label key={status} className="flex items-center gap-1.5 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={syncStatuses.includes(status)}
                            onChange={() => toggleSyncStatus(status)}
                            className="rounded border-indigo-300 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
                        />
                        <span className="text-xs text-gray-700">{status}</span>
                    </label>
                ))}
                <span className="text-xs text-muted-foreground ml-1">
                    ({syncStatuses.length === 0 || syncStatuses.length === ALL_SO_STATUSES.length ? 'semua' : syncStatuses.length + ' dipilih'})
                </span>

                <span className="text-gray-300 mx-1">|</span>

                <span className="text-xs font-medium text-teal-600">📦 Kiriman:</span>
                {ALL_DELIVERY_STATUSES.map(status => (
                    <label key={status} className="flex items-center gap-1.5 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={deliveryStatusFilter === status}
                            onChange={() => setDeliveryStatusFilter(deliveryStatusFilter === status ? '' : status)}
                            className="rounded border-teal-300 text-teal-600 focus:ring-teal-500 h-3.5 w-3.5"
                        />
                        <span className="text-xs text-gray-700">{status}</span>
                    </label>
                ))}

                <span className="text-gray-300 mx-1">|</span>

                <span className="text-xs font-medium text-blue-600">🚛 Keberangkatan Armada:</span>
                {ALL_DISPATCH_STATUSES.map(status => (
                    <label key={status} className="flex items-center gap-1.5 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={dispatchStatusFilter === status}
                            onChange={() => setDispatchStatusFilter(dispatchStatusFilter === status ? '' : status)}
                            className="rounded border-blue-300 text-blue-600 focus:ring-blue-500 h-3.5 w-3.5"
                        />
                        <span className="text-xs text-gray-700">{status}</span>
                    </label>
                ))}
            </div>

            {/* Auto-Sync Panel */}
            {schedulerStatus && (
                <div className="border rounded-lg overflow-hidden">
                    <div
                        className="flex items-center justify-between px-4 py-2 bg-gradient-to-r from-teal-50 to-cyan-50 cursor-pointer hover:from-teal-100 hover:to-cyan-100 transition-colors"
                        onClick={() => setSchedulerExpanded(!schedulerExpanded)}
                    >
                        <div className="flex items-center gap-3">
                            <span className="text-base">⏰</span>
                            <span className="text-sm font-semibold text-gray-700">Auto-Sync SO</span>
                            {schedulerStatus.config.enabled ? (
                                <Badge className="bg-green-100 text-green-700 border-green-300 text-[10px] px-1.5 py-0">
                                    ● Aktif — {schedulerStatus.config.intervalLabel}
                                </Badge>
                            ) : (
                                <Badge variant="outline" className="text-gray-500 text-[10px] px-1.5 py-0">
                                    Nonaktif
                                </Badge>
                            )}
                            {schedulerStatus.isSyncing && (
                                <div className="flex items-center gap-1.5">
                                    <div className="w-3 h-3 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
                                    <span className="text-[10px] text-teal-600 font-medium">Syncing...</span>
                                </div>
                            )}
                        </div>
                        <span className="text-xs text-gray-400">{schedulerExpanded ? '▲' : '▼'}</span>
                    </div>

                    {schedulerExpanded && (
                        <div className="px-4 py-3 bg-white border-t space-y-3">
                            <div className="flex flex-wrap items-center gap-3">
                                <Button
                                    variant={schedulerStatus.config.enabled ? 'default' : 'outline'}
                                    size="sm"
                                    onClick={() => updateSchedulerConfig({ enabled: !schedulerStatus.config.enabled })}
                                    disabled={schedulerUpdating}
                                    className={schedulerStatus.config.enabled
                                        ? 'bg-green-600 hover:bg-green-700 text-white text-xs'
                                        : 'text-xs'
                                    }
                                >
                                    {schedulerStatus.config.enabled ? '✅ Enabled' : '⬜ Disabled'}
                                </Button>

                                <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-1.5 border">
                                    <span className="text-xs font-medium text-gray-500 whitespace-nowrap">Interval:</span>
                                    <select
                                        value={selectedIntervalIdx >= 0 ? selectedIntervalIdx : 2}
                                        onChange={(e) => {
                                            const opt = SO_INTERVAL_OPTIONS[parseInt(e.target.value)];
                                            if (opt) updateSchedulerConfig({ cronExpression: opt.cron, intervalLabel: opt.label });
                                        }}
                                        className="bg-transparent text-xs border-none outline-none cursor-pointer min-w-[130px]"
                                        disabled={schedulerUpdating}
                                    >
                                        {SO_INTERVAL_OPTIONS.map((opt, idx) => (
                                            <option key={idx} value={idx}>{opt.label}</option>
                                        ))}
                                    </select>
                                </div>

                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={triggerManualSOSync}
                                    disabled={schedulerStatus.isSyncing || schedulerUpdating}
                                    className="text-xs border-teal-300 text-teal-700 hover:bg-teal-50"
                                >
                                    {schedulerStatus.isSyncing ? '⏳ Running...' : '▶ Run Now'}
                                </Button>
                            </div>

                            {/* Sync History */}
                            {schedulerStatus.history.length > 0 && (
                                <div>
                                    <p className="text-xs font-semibold text-gray-500 mb-1.5">📋 Riwayat Sync SO</p>
                                    <div className="max-h-[160px] overflow-y-auto">
                                        <table className="w-full text-xs">
                                            <thead>
                                                <tr className="border-b text-left text-gray-400">
                                                    <th className="py-1 pr-2">Waktu</th>
                                                    <th className="py-1 pr-2">Status</th>
                                                    <th className="py-1 pr-2">Durasi</th>
                                                    <th className="py-1 pr-2">SOs</th>
                                                    <th className="py-1">Trigger</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {schedulerStatus.history.slice(0, 10).map(entry => (
                                                    <tr key={entry.id} className="border-b border-gray-50 hover:bg-gray-50">
                                                        <td className="py-1.5 pr-2 text-gray-600">{formatDateTime(entry.startedAt)}</td>
                                                        <td className="py-1.5 pr-2">
                                                            {entry.status === 'success' && <span className="text-green-600">✅ Sukses</span>}
                                                            {entry.status === 'error' && <span className="text-red-600" title={entry.error || ''}>❌ Gagal</span>}
                                                            {entry.status === 'running' && <span className="text-blue-600">🔄 Berjalan</span>}
                                                        </td>
                                                        <td className="py-1.5 pr-2 text-gray-500">{formatDuration(entry.durationSec)}</td>
                                                        <td className="py-1.5 pr-2 text-gray-500">{entry.soCount ?? '-'}</td>
                                                        <td className="py-1.5">
                                                            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${entry.trigger === 'scheduled'
                                                                ? 'bg-purple-50 text-purple-600 border-purple-200'
                                                                : 'bg-blue-50 text-blue-600 border-blue-200'
                                                                }`}>
                                                                {entry.trigger === 'scheduled' ? '⏰ Auto' : '👤 Manual'}
                                                            </Badge>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Sync Progress Banner */}
            {syncState.status === 'running' && (
                <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-3 space-y-2">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-5 h-5 border-[3px] border-indigo-500 border-t-transparent rounded-full animate-spin" />
                            <p className="text-sm text-indigo-700">{syncState.message}</p>
                        </div>
                        <span className="text-sm font-bold text-indigo-700">{syncState.progress}%</span>
                    </div>
                    <div className="w-full bg-indigo-100 rounded-full h-2">
                        <div
                            className="bg-indigo-500 h-2 rounded-full transition-all duration-500"
                            style={{ width: `${syncState.progress}%` }}
                        />
                    </div>
                </div>
            )}

            {syncState.status === 'done' && (
                <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2 flex items-center justify-between">
                    <p className="text-sm text-green-700">✅ {syncState.message}</p>
                    <Button variant="ghost" size="sm" onClick={() => setSyncState({ status: 'idle', progress: 0, message: '' })} className="text-green-600">✕</Button>
                </div>
            )}

            {syncState.status === 'error' && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 flex items-center justify-between">
                    <p className="text-sm text-red-700">❌ {syncState.message}</p>
                    <Button variant="ghost" size="sm" onClick={() => setSyncState({ status: 'idle', progress: 0, message: '' })} className="text-red-600">✕</Button>
                </div>
            )}

            {/* Top Horizontal Scrollbar Placeholder */}
            {bottomScrollRef.current && bottomScrollRef.current.scrollWidth > bottomScrollRef.current.clientWidth && (
                <div 
                    ref={topScrollRef} 
                    className="overflow-x-auto overflow-y-hidden mb-1 border rounded-md"
                    onScroll={handleTopScroll}
                >
                    <div style={{ height: '1px', width: bottomScrollRef.current.scrollWidth }} />
                </div>
            )}

            {/* SO Table */}
            <div 
               ref={bottomScrollRef}
               className="border rounded-lg overflow-x-auto max-h-[calc(100vh-270px)] bg-white"
               onScroll={handleBottomScroll}
            >
                <table className="w-full text-sm whitespace-nowrap">
                    <thead className="sticky top-0 z-10 bg-muted/90 backdrop-blur shadow-sm">
                        <tr className="text-left">
                            <th className="px-3 py-2 font-medium w-8 bg-muted/90"></th>
                            <th className="px-3 py-2 font-medium bg-muted/90">No. SO</th>
                            <th className="px-3 py-2 font-medium bg-muted/90 min-w-[200px]">No. DO</th>
                            <th className="px-3 py-2 font-medium bg-muted/90">Tanggal</th>
                            <th className="px-3 py-2 font-medium bg-muted/90">ID Customer</th>
                            <th className="px-3 py-2 font-medium bg-muted/90">Customer</th>
                            <th className="px-3 py-2 font-medium bg-muted/90">Kota/Kab</th>
                            <th className="px-3 py-2 font-medium bg-muted/90">Provinsi</th>
                            <th className="px-3 py-2 font-medium bg-muted/90">Area</th>
                            <th className="px-3 py-2 font-medium bg-muted/90">Cluster</th>
                            <th className="px-3 py-2 font-medium bg-muted/90">Sub Cluster</th>
                            <th className="px-3 py-2 font-medium bg-muted/90">Status</th>
                            <th className="px-3 py-2 font-medium bg-muted/90">Status Kiriman</th>
                            <th className="px-3 py-2 font-medium bg-muted/90">Status Armada</th>
                            <th className="px-3 py-2 font-medium bg-muted/90 text-center">Items</th>
                            <th className="px-3 py-2 font-medium bg-muted/90 text-right">Outstanding</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && (
                            <tr><td colSpan={15} className="text-center py-8 text-muted-foreground">
                                <div className="inline-block w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mr-2" />
                                Memuat data SO...
                            </td></tr>
                        )}
                        {!loading && filtered.length === 0 && (
                            <tr><td colSpan={15} className="text-center py-8 text-muted-foreground">
                                Tidak ada data SO. {soList.length === 0 ? 'Klik Sync SO untuk mengambil data.' : 'Coba ubah filter.'}
                            </td></tr>
                        )}
                        {!loading && filtered.map(so => (
                            <React.Fragment key={so.id}>
                                <tr
                                    className="border-t hover:bg-muted/30 cursor-pointer transition-colors"
                                    onClick={() => setExpandedId(expandedId === so.id ? null : so.id)}
                                >
                                    <td className="px-3 py-2 text-center text-muted-foreground">
                                        {expandedId === so.id ? '▼' : '▶'}
                                    </td>
                                    <td className="px-3 py-2 font-mono font-medium text-blue-700">{so.soNumber}</td>
                                    <td className="px-3 py-2 font-mono text-xs whitespace-normal min-w-[200px]">
                                        {so.doNumberText ? (
                                            so.doNumberText.split(', ').map((doNum, idx) => (
                                                <div key={idx} className="mb-0.5 last:mb-0 bg-blue-50/50 px-1.5 py-0.5 rounded inline-block w-full">{doNum}</div>
                                            ))
                                        ) : (
                                            <span className="text-muted-foreground">-</span>
                                        )}
                                    </td>
                                    <td className="px-3 py-2 text-muted-foreground">{formatDate(so.transDate)}</td>
                                    <td className="px-3 py-2 font-mono text-xs">{so.customerNo || '-'}</td>
                                    <td className="px-3 py-2">{so.customerName || '-'}</td>
                                    <td className="px-3 py-2 text-xs">{so.shipCity || <span className="text-muted-foreground">-</span>}</td>
                                    <td className="px-3 py-2 text-xs">{so.shipProvince || <span className="text-muted-foreground">-</span>}</td>
                                    <td className="px-3 py-2 text-xs">{(so as any).area ? <Badge variant="outline" className="text-[10px]">{(so as any).area}</Badge> : <span className="text-muted-foreground">-</span>}</td>
                                    <td className="px-3 py-2 text-xs">{(so as any).cluster ? <Badge variant="outline" className="text-[10px] bg-purple-50">{(so as any).cluster}</Badge> : <span className="text-muted-foreground">-</span>}</td>
                                    <td className="px-3 py-2 text-xs">{(so as any).subCluster || <span className="text-muted-foreground">-</span>}</td>
                                    <td className="px-3 py-2">
                                        <Badge variant="outline" className={`text-xs ${getStatusColor(so.statusName)}`}>
                                            {so.statusName}
                                        </Badge>
                                    </td>
                                    <td className="px-3 py-2">
                                        <Badge variant="outline" className={`text-xs ${getDeliveryStatusColor(so.deliveryStatus || 'Belum dikirim')}`}>
                                            {so.deliveryStatus || 'Belum dikirim'}
                                        </Badge>
                                    </td>
                                    <td className="px-3 py-2">
                                        {(so as any).dispatchStatus ? (
                                            <div>
                                                <Badge variant="outline" className={`text-xs ${
                                                    (so as any).dispatchStatus === 'Selesai'
                                                        ? 'bg-green-100 text-green-700 border-green-300'
                                                        : (so as any).dispatchStatus === 'Sudah Berangkat'
                                                        ? 'bg-blue-100 text-blue-700 border-blue-300'
                                                        : (so as any).dispatchStatus === 'Sebagian Berangkat'
                                                        ? 'bg-cyan-100 text-cyan-700 border-cyan-300'
                                                        : 'bg-amber-100 text-amber-700 border-amber-300'
                                                }`}>
                                                    {(so as any).dispatchStatus === 'Selesai' ? '✅ ' 
                                                     : (so as any).dispatchStatus === 'Sudah Berangkat' ? '🚛 '
                                                     : (so as any).dispatchStatus === 'Sebagian Berangkat' ? '🔄 '
                                                     : '⏳ '}
                                                    {(so as any).dispatchStatus}
                                                </Badge>
                                                {(so as any).dispatchDriver && (
                                                    <p className="text-[10px] text-gray-400 mt-0.5 truncate max-w-[120px]" title={(so as any).dispatchDriver}>
                                                        👤 {(so as any).dispatchDriver}
                                                    </p>
                                                )}
                                            </div>
                                        ) : (
                                            <span className="text-xs text-gray-300">-</span>
                                        )}
                                    </td>
                                    <td className="px-3 py-2 text-center">{so.detailItems.length}</td>
                                    <td className="px-3 py-2 text-right font-medium">
                                        {so.totalOutstanding > 0 ? (
                                            <span className="text-orange-600">{so.totalOutstanding.toLocaleString('id-ID')}</span>
                                        ) : (
                                            <span className="text-green-600">0</span>
                                        )}
                                    </td>
                                </tr>

                                {/* Expanded Detail */}
                                {expandedId === so.id && (
                                    <tr>
                                        <td colSpan={15} className="bg-muted/20 px-4 py-3">
                                            <div className="text-xs font-medium text-muted-foreground mb-2">
                                                Detail Item — {so.soNumber}
                                            </div>
                                            <table className="w-full text-xs">
                                                <thead>
                                                    <tr className="bg-muted/40">
                                                        <th className="px-2 py-1.5 text-left font-medium">Kode</th>
                                                        <th className="px-2 py-1.5 text-left font-medium">Nama Item</th>
                                                        <th className="px-2 py-1.5 text-right font-medium">Qty Pesan</th>
                                                        <th className="px-2 py-1.5 text-right font-medium">Qty Terproses</th>
                                                        <th className="px-2 py-1.5 text-right font-medium">Outstanding</th>
                                                        <th className="px-2 py-1.5 text-left font-medium">Satuan</th>
                                                        <th className="px-2 py-1.5 text-right font-medium">Isi/Box</th>
                                                        <th className="px-2 py-1.5 text-right font-medium">Qty (Pcs)</th>
                                                        <th className="px-2 py-1.5 text-right font-medium">Outstanding (Pcs)</th>
                                                        <th className="px-2 py-1.5 text-right font-medium">Stock (Pcs)</th>
                                                        <th className="px-2 py-1.5 text-right font-medium">Stock (Box)</th>
                                                        <th className="px-2 py-1.5 text-right font-medium">Berat (kg)</th>
                                                        <th className="px-2 py-1.5 text-right font-medium">Vol (m³)</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {so.detailItems.map((item, idx) => (
                                                        <tr key={idx} className="border-t border-muted/30">
                                                            <td className="px-2 py-1.5 font-mono text-blue-600">{item.itemNo}</td>
                                                            <td className="px-2 py-1.5">{item.itemName}</td>
                                                            <td className="px-2 py-1.5 text-right">{item.quantity.toLocaleString('id-ID')}</td>
                                                            <td className="px-2 py-1.5 text-right">{item.shipQuantity.toLocaleString('id-ID')}</td>
                                                            <td className="px-2 py-1.5 text-right font-medium">
                                                                {item.outstanding > 0 ? (
                                                                    <span className="text-orange-600">{item.outstanding.toLocaleString('id-ID')}</span>
                                                                ) : (
                                                                    <span className="text-green-600">0</span>
                                                                )}
                                                            </td>
                                                            <td className="px-2 py-1.5 text-muted-foreground">{item.unitName}</td>
                                                            <td className="px-2 py-1.5 text-right font-mono text-xs">
                                                                {item.isiPerBox ? item.isiPerBox.toLocaleString('id-ID') : <span className="text-muted-foreground">-</span>}
                                                            </td>
                                                            <td className="px-2 py-1.5 text-right font-medium">
                                                                {(item.qtyPcs ?? item.quantity).toLocaleString('id-ID')}
                                                                {item.isiPerBox && <span className="text-[10px] text-muted-foreground ml-0.5">pcs</span>}
                                                            </td>
                                                            <td className="px-2 py-1.5 text-right font-medium">
                                                                {(item.outstandingPcs ?? item.outstanding) > 0 ? (
                                                                    <span className="text-orange-600">
                                                                        {(item.outstandingPcs ?? item.outstanding).toLocaleString('id-ID')}
                                                                        {item.isiPerBox && <span className="text-[10px] text-muted-foreground ml-0.5">pcs</span>}
                                                                    </span>
                                                                ) : (
                                                                    <span className="text-green-600">0</span>
                                                                )}
                                                            </td>
                                                            <td className="px-2 py-1.5 text-right">
                                                                {item.stock !== undefined ? (
                                                                    <span className={(item.outstandingPcs ?? item.outstanding) > 0 && item.stock < (item.outstandingPcs ?? item.outstanding) ? 'text-red-600 font-medium' : ''}>
                                                                        {item.stock.toLocaleString('id-ID')}
                                                                        <span className="text-[10px] text-muted-foreground ml-0.5">{item.baseUnitName || 'pcs'}</span>
                                                                    </span>
                                                                ) : (
                                                                    <span className="text-muted-foreground">-</span>
                                                                )}
                                                            </td>
                                                            <td className="px-2 py-1.5 text-right">
                                                                {item.stock !== undefined && item.isiPerBox ? (
                                                                    <span className={(item.outstanding) > 0 && Math.floor(item.stock / item.isiPerBox) < item.outstanding ? 'text-red-600 font-medium' : ''}>
                                                                        {Math.floor(item.stock / item.isiPerBox).toLocaleString('id-ID')}
                                                                        <span className="text-[10px] text-muted-foreground ml-0.5">{item.salesUnitName || 'box'}</span>
                                                                    </span>
                                                                ) : (
                                                                    <span className="text-muted-foreground">-</span>
                                                                )}
                                                            </td>
                                                            <td className="px-2 py-1.5 text-right text-xs">
                                                                {item.totalWeightKg ? item.totalWeightKg.toFixed(1) : <span className="text-muted-foreground">-</span>}
                                                            </td>
                                                            <td className="px-2 py-1.5 text-right text-xs font-mono">
                                                                {item.totalVolumeM3 ? item.totalVolumeM3.toFixed(4) : <span className="text-muted-foreground">-</span>}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                    {/* Summary row */}
                                                    {(() => {
                                                        const totalWt = so.detailItems.reduce((s: number, i: any) => s + (i.totalWeightKg || 0), 0);
                                                        const totalVol = so.detailItems.reduce((s: number, i: any) => s + (i.totalVolumeM3 || 0), 0);
                                                        return (totalWt > 0 || totalVol > 0) ? (
                                                            <tr className="border-t-2 border-muted bg-muted/30 font-medium">
                                                                <td colSpan={11} className="px-2 py-1.5 text-right text-xs">Total SO:</td>
                                                                <td className="px-2 py-1.5 text-right text-xs text-blue-700">{totalWt > 0 ? `${totalWt.toFixed(1)} kg` : '-'}</td>
                                                                <td className="px-2 py-1.5 text-right text-xs font-mono text-blue-700">{totalVol > 0 ? `${totalVol.toFixed(4)} m³` : '-'}</td>
                                                            </tr>
                                                        ) : null;
                                                    })()}
                                                </tbody>
                                            </table>
                                        </td>
                                    </tr>
                                )}
                            </React.Fragment>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Footer info */}
            {!loading && filtered.length > 0 && (
                <p className="text-xs text-muted-foreground text-right">
                    Menampilkan {filtered.length} SO {filtered.length !== soList.length ? `(dari ${soList.length} total)` : ''}
                </p>
            )}
        </div>
    );
};
