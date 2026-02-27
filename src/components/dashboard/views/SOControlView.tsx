'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { SOData } from '@/lib/types';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

interface SOControlViewProps {
    branches?: { id: number; name: string }[];
}

interface SOSyncState {
    status: 'idle' | 'running' | 'done' | 'error';
    progress: number;
    message: string;
}

export const SOControlView: React.FC<SOControlViewProps> = ({ branches = [] }) => {
    const [soList, setSoList] = useState<SOData[]>([]);
    const [loading, setLoading] = useState(true);
    const [syncState, setSyncState] = useState<SOSyncState>({ status: 'idle', progress: 0, message: '' });
    const [expandedId, setExpandedId] = useState<number | null>(null);

    // Filters
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [branchFilter, setBranchFilter] = useState('');
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');

    // Sync status filter (which statuses to fetch from API)
    const ALL_SO_STATUSES = ['Diajukan', 'Menunggu diproses', 'Sebagian diproses', 'Terproses'];
    const [syncStatuses, setSyncStatuses] = useState<string[]>(['Menunggu diproses', 'Sebagian diproses']);

    const toggleSyncStatus = (status: string) => {
        setSyncStatuses(prev =>
            prev.includes(status) ? prev.filter(s => s !== status) : [...prev, status]
        );
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

    // Apply search filter client-side
    const filtered = soList.filter(so => {
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

    const formatDate = (dateStr: string) => {
        const parts = dateStr.split('/');
        if (parts.length === 3) {
            const months = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
            return `${parseInt(parts[0])} ${months[parseInt(parts[1])]} ${parts[2]}`;
        }
        return dateStr;
    };

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

            {/* Sync Status Checkboxes */}
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
            </div>

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

            {/* SO Table */}
            <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="bg-muted/50 text-left">
                            <th className="px-3 py-2 font-medium w-8"></th>
                            <th className="px-3 py-2 font-medium">No. SO</th>
                            <th className="px-3 py-2 font-medium">Tanggal</th>
                            <th className="px-3 py-2 font-medium">Customer</th>
                            <th className="px-3 py-2 font-medium">Status</th>
                            <th className="px-3 py-2 font-medium text-center">Items</th>
                            <th className="px-3 py-2 font-medium text-right">Outstanding</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && (
                            <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">
                                <div className="inline-block w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mr-2" />
                                Memuat data SO...
                            </td></tr>
                        )}
                        {!loading && filtered.length === 0 && (
                            <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">
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
                                    <td className="px-3 py-2 text-muted-foreground">{formatDate(so.transDate)}</td>
                                    <td className="px-3 py-2">{so.customerName || '-'}</td>
                                    <td className="px-3 py-2">
                                        <Badge variant="outline" className={`text-xs ${getStatusColor(so.statusName)}`}>
                                            {so.statusName}
                                        </Badge>
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
                                        <td colSpan={7} className="bg-muted/20 px-4 py-3">
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
                                                        <th className="px-2 py-1.5 text-right font-medium">Stock</th>
                                                        <th className="px-2 py-1.5 text-left font-medium">Satuan</th>
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
                                                            <td className="px-2 py-1.5 text-right">
                                                                {item.stock !== undefined ? (
                                                                    <span className={item.stock < item.outstanding ? 'text-red-600 font-medium' : ''}>
                                                                        {item.stock.toLocaleString('id-ID')}
                                                                    </span>
                                                                ) : (
                                                                    <span className="text-muted-foreground">-</span>
                                                                )}
                                                            </td>
                                                            <td className="px-2 py-1.5 text-muted-foreground">{item.unitName}</td>
                                                        </tr>
                                                    ))}
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
