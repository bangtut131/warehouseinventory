'use client';

import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

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

interface BroadcastConfig {
    enabled: boolean;
    cronExpression: string;
    intervalLabel: string;
    reportTypes: string[];
    targetNumbers: string[];
    branchId: number | null;
    warehouseId: number | null;
    branchName?: string;
    warehouseName?: string;
    wahaUrl: string;
    wahaSession: string;
    wahaApiKey: string;
    stockUnit: 'pcs' | 'box';
}

interface BroadcastLogEntry {
    id: number;
    type: string;
    sentAt: string;
    status: string;
    target: string;
    branchId: number | null;
    warehouseId: number | null;
    message: string | null;
    itemCount: number | null;
}

const SCHEDULE_OPTIONS = [
    { cron: '0 7 * * 1-5', label: 'Senin-Jumat jam 07:00' },
    { cron: '0 7 * * 1', label: 'Setiap Senin jam 07:00' },
    { cron: '0 7 * * *', label: 'Setiap hari jam 07:00' },
    { cron: '0 8 * * 1-5', label: 'Senin-Jumat jam 08:00' },
    { cron: '0 17 * * 1-5', label: 'Senin-Jumat jam 17:00' },
    { cron: '0 7 1 * *', label: 'Tanggal 1 setiap bulan jam 07:00' },
];

interface Props {
    branches: Branch[];
    warehouses: Warehouse[];
}

export function BroadcastPanel({ branches, warehouses }: Props) {
    const [expanded, setExpanded] = useState(false);
    const [config, setConfig] = useState<BroadcastConfig | null>(null);
    const [history, setHistory] = useState<BroadcastLogEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<string | null>(null);
    const [cronActive, setCronActive] = useState(false);
    const [isBroadcasting, setIsBroadcasting] = useState(false);

    // Form state
    const [enabled, setEnabled] = useState(false);
    const [wahaUrl, setWahaUrl] = useState('');
    const [wahaSession, setWahaSession] = useState('default');
    const [wahaApiKey, setWahaApiKey] = useState('');
    const [targetInput, setTargetInput] = useState('');
    const [selectedCron, setSelectedCron] = useState('0 7 * * 1-5');
    const [reportReorder, setReportReorder] = useState(true);
    const [reportAlert, setReportAlert] = useState(false);
    const [branchId, setBranchId] = useState<string>('');
    const [warehouseId, setWarehouseId] = useState<string>('');
    const [stockUnit, setStockUnit] = useState<'pcs' | 'box'>('pcs');

    const loadConfig = useCallback(async () => {
        setLoading(true);
        try {
            const res = await axios.get('/api/broadcast');
            const data = res.data;
            setConfig(data.config);
            setHistory(data.history || []);
            setCronActive(data.cronActive);
            setIsBroadcasting(data.isBroadcasting);

            // Populate form
            const c = data.config;
            setEnabled(c.enabled);
            setWahaUrl(c.wahaUrl || '');
            setWahaSession(c.wahaSession || 'default');
            setWahaApiKey(c.wahaApiKey || '');
            setTargetInput((c.targetNumbers || []).join(', '));
            setSelectedCron(c.cronExpression || '0 7 * * 1-5');
            setReportReorder((c.reportTypes || []).includes('reorder'));
            setReportAlert((c.reportTypes || []).includes('alert-pdf'));
            setBranchId(c.branchId ? c.branchId.toString() : '');
            setWarehouseId(c.warehouseId ? c.warehouseId.toString() : '');
            setStockUnit(c.stockUnit || 'pcs');
        } catch (err) {
            console.error('Failed to load broadcast config', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (expanded) loadConfig();
    }, [expanded, loadConfig]);

    const saveConfig = async () => {
        setSaving(true);
        setTestResult(null);
        try {
            const reportTypes: string[] = [];
            if (reportReorder) reportTypes.push('reorder');
            if (reportAlert) reportTypes.push('alert-pdf');

            const targets = targetInput
                .split(/[,;\n]/)
                .map(t => t.trim())
                .filter(Boolean);

            const branchObj = branchId ? branches.find(b => b.id === parseInt(branchId)) : null;
            const warehouseObj = warehouseId ? warehouses.find(w => w.id === parseInt(warehouseId)) : null;

            const update: Partial<BroadcastConfig> = {
                enabled,
                cronExpression: selectedCron,
                intervalLabel: SCHEDULE_OPTIONS.find(o => o.cron === selectedCron)?.label || selectedCron,
                reportTypes,
                targetNumbers: targets,
                branchId: branchId ? parseInt(branchId) : null,
                warehouseId: warehouseId ? parseInt(warehouseId) : null,
                branchName: branchObj?.name,
                warehouseName: warehouseObj?.name,
                wahaUrl,
                wahaSession,
                wahaApiKey,
                stockUnit,
            };

            await axios.post('/api/broadcast', update);
            setTestResult('✅ Config tersimpan!');
            await loadConfig();
        } catch (err: any) {
            setTestResult(`❌ Error: ${err.message}`);
        } finally {
            setSaving(false);
        }
    };

    const testConnection = async () => {
        setTesting(true);
        setTestResult(null);
        try {
            const res = await axios.post('/api/broadcast?action=test-connection', {
                wahaUrl,
                wahaSession,
                wahaApiKey,
            });
            if (res.data.ok) {
                setTestResult(`✅ Koneksi berhasil! Status: ${res.data.status}`);
            } else {
                setTestResult(`❌ Koneksi gagal: ${res.data.error}`);
            }
        } catch (err: any) {
            setTestResult(`❌ Error: ${err.message}`);
        } finally {
            setTesting(false);
        }
    };

    const testSend = async () => {
        setTesting(true);
        setTestResult(null);
        try {
            const targets = targetInput.split(/[,;\n]/).map(t => t.trim()).filter(Boolean);
            if (targets.length === 0) {
                setTestResult('❌ Masukkan nomor WA tujuan');
                setTesting(false);
                return;
            }
            const res = await axios.post('/api/broadcast?action=test-send', {
                wahaUrl,
                wahaSession,
                wahaApiKey,
                targetNumber: targets[0],
            });
            if (res.data.ok) {
                setTestResult('✅ Pesan test terkirim!');
            } else {
                setTestResult(`❌ Gagal kirim: ${res.data.error}`);
            }
        } catch (err: any) {
            setTestResult(`❌ Error: ${err.message}`);
        } finally {
            setTesting(false);
        }
    };

    const triggerBroadcast = async () => {
        if (!confirm('Kirim broadcast sekarang?')) return;
        setTesting(true);
        setTestResult(null);
        try {
            await axios.post('/api/broadcast?action=trigger');
            setTestResult('📤 Broadcast dimulai! Cek history setelah beberapa saat.');
            setTimeout(loadConfig, 10000);
        } catch (err: any) {
            setTestResult(`❌ Error: ${err.message}`);
        } finally {
            setTesting(false);
        }
    };

    return (
        <Card className="border-green-200 bg-green-50/30">
            <CardHeader
                className="cursor-pointer hover:bg-green-50/50 transition-colors py-3"
                onClick={() => setExpanded(!expanded)}
            >
                <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                        📢 WhatsApp Broadcast
                        {cronActive && (
                            <Badge className="bg-green-600 text-white text-xs px-2 py-0">
                                Aktif — {config?.intervalLabel}
                            </Badge>
                        )}
                        {isBroadcasting && (
                            <Badge className="bg-orange-500 text-white text-xs px-2 py-0 animate-pulse">
                                Sending...
                            </Badge>
                        )}
                    </CardTitle>
                    <span className="text-sm text-muted-foreground">{expanded ? '▲' : '▼'}</span>
                </div>
            </CardHeader>

            {expanded && (
                <CardContent className="space-y-4 pt-0">
                    {loading ? (
                        <div className="text-center py-4 text-muted-foreground">Loading...</div>
                    ) : (
                        <>
                            {/* WAHA Connection */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div>
                                    <label className="text-xs font-medium text-gray-600 mb-1 block">WAHA API URL</label>
                                    <input
                                        type="text"
                                        value={wahaUrl}
                                        onChange={(e) => setWahaUrl(e.target.value)}
                                        placeholder="http://localhost:3000"
                                        className="w-full px-3 py-1.5 text-sm border rounded-md"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-gray-600 mb-1 block">Session Name</label>
                                    <input
                                        type="text"
                                        value={wahaSession}
                                        onChange={(e) => setWahaSession(e.target.value)}
                                        placeholder="default"
                                        className="w-full px-3 py-1.5 text-sm border rounded-md"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-gray-600 mb-1 block">API Key (opsional)</label>
                                    <input
                                        type="password"
                                        value={wahaApiKey}
                                        onChange={(e) => setWahaApiKey(e.target.value)}
                                        placeholder="(kosongkan jika tidak ada)"
                                        className="w-full px-3 py-1.5 text-sm border rounded-md"
                                    />
                                </div>
                            </div>

                            {/* Test Connection */}
                            <div className="flex items-center gap-2">
                                <Button size="sm" variant="outline" onClick={testConnection} disabled={testing || !wahaUrl}>
                                    {testing ? '⏳' : '🔌'} Test Koneksi
                                </Button>
                                <Button size="sm" variant="outline" onClick={testSend} disabled={testing || !wahaUrl || !targetInput}>
                                    {testing ? '⏳' : '📩'} Test Kirim
                                </Button>
                                {testResult && (
                                    <span className="text-sm">{testResult}</span>
                                )}
                            </div>

                            <hr />

                            {/* Target Numbers */}
                            <div>
                                <label className="text-xs font-medium text-gray-600 mb-1 block">
                                    Nomor WA Tujuan (pisah dengan koma, format: 628xxx)
                                </label>
                                <input
                                    type="text"
                                    value={targetInput}
                                    onChange={(e) => setTargetInput(e.target.value)}
                                    placeholder="6281234567890, 6289876543210"
                                    className="w-full px-3 py-1.5 text-sm border rounded-md"
                                />
                            </div>

                            {/* Report Types */}
                            <div className="flex items-center gap-4">
                                <span className="text-xs font-medium text-gray-600">Jenis Laporan:</span>
                                <label className="flex items-center gap-1.5 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={reportReorder}
                                        onChange={(e) => setReportReorder(e.target.checked)}
                                        className="rounded"
                                    />
                                    <span className="text-sm">📋 Reorder Report</span>
                                </label>
                                <label className="flex items-center gap-1.5 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={reportAlert}
                                        onChange={(e) => setReportAlert(e.target.checked)}
                                        className="rounded"
                                    />
                                    <span className="text-sm">🚨 Alert PDF</span>
                                </label>
                            </div>

                            {/* Stock Unit */}
                            <div className="flex items-center gap-3">
                                <span className="text-xs font-medium text-gray-600">Satuan Stock:</span>
                                <label className="flex items-center gap-1.5 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="stockUnit"
                                        value="pcs"
                                        checked={stockUnit === 'pcs'}
                                        onChange={() => setStockUnit('pcs')}
                                    />
                                    <span className="text-sm">📦 Pcs</span>
                                </label>
                                <label className="flex items-center gap-1.5 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="stockUnit"
                                        value="box"
                                        checked={stockUnit === 'box'}
                                        onChange={() => setStockUnit('box')}
                                    />
                                    <span className="text-sm">📦 Box</span>
                                </label>
                            </div>

                            {/* Branch & Warehouse Filter */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs font-medium text-gray-600 mb-1 block">Cabang</label>
                                    <select
                                        value={branchId}
                                        onChange={(e) => setBranchId(e.target.value)}
                                        className="w-full px-3 py-1.5 text-sm border rounded-md bg-white"
                                    >
                                        <option value="">Semua Cabang</option>
                                        {branches.map(b => (
                                            <option key={b.id} value={b.id}>{b.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-gray-600 mb-1 block">Gudang</label>
                                    <select
                                        value={warehouseId}
                                        onChange={(e) => setWarehouseId(e.target.value)}
                                        className="w-full px-3 py-1.5 text-sm border rounded-md bg-white"
                                    >
                                        <option value="">Semua Gudang</option>
                                        {warehouses.map(w => (
                                            <option key={w.id} value={w.id}>{w.name}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {/* Schedule */}
                            <div className="flex items-center gap-3">
                                <div className="flex-1">
                                    <label className="text-xs font-medium text-gray-600 mb-1 block">Jadwal Kirim</label>
                                    <select
                                        value={selectedCron}
                                        onChange={(e) => setSelectedCron(e.target.value)}
                                        className="w-full px-3 py-1.5 text-sm border rounded-md bg-white"
                                    >
                                        {SCHEDULE_OPTIONS.map(opt => (
                                            <option key={opt.cron} value={opt.cron}>{opt.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="flex items-center gap-2 pt-5">
                                    <label className="flex items-center gap-1.5 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={enabled}
                                            onChange={(e) => setEnabled(e.target.checked)}
                                            className="rounded"
                                        />
                                        <span className="text-sm font-medium">Aktifkan Auto-Broadcast</span>
                                    </label>
                                </div>
                            </div>

                            {/* Action Buttons */}
                            <div className="flex items-center gap-2 pt-2">
                                <Button
                                    size="sm"
                                    onClick={saveConfig}
                                    disabled={saving}
                                    className="bg-green-600 hover:bg-green-700 text-white"
                                >
                                    {saving ? '⏳ Menyimpan...' : '💾 Simpan Setting'}
                                </Button>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={triggerBroadcast}
                                    disabled={testing || isBroadcasting || !targetInput}
                                    className="border-orange-300 text-orange-700 hover:bg-orange-50"
                                >
                                    {isBroadcasting ? '⏳ Mengirim...' : '📤 Kirim Sekarang'}
                                </Button>
                            </div>

                            {/* History */}
                            {history.length > 0 && (
                                <div className="mt-4">
                                    <h4 className="text-xs font-medium text-gray-600 mb-2">Riwayat Broadcast</h4>
                                    <div className="max-h-[200px] overflow-auto">
                                        <table className="w-full text-xs">
                                            <thead>
                                                <tr className="bg-gray-100">
                                                    <th className="px-2 py-1 text-left">Waktu</th>
                                                    <th className="px-2 py-1 text-left">Tipe</th>
                                                    <th className="px-2 py-1 text-left">Tujuan</th>
                                                    <th className="px-2 py-1 text-center">Status</th>
                                                    <th className="px-2 py-1 text-left">Pesan</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {history.map(log => (
                                                    <tr key={log.id} className="border-b hover:bg-gray-50">
                                                        <td className="px-2 py-1 whitespace-nowrap">
                                                            {new Date(log.sentAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}
                                                        </td>
                                                        <td className="px-2 py-1">
                                                            {log.type === 'reorder' ? '📋 Reorder' : '🚨 Alert'}
                                                        </td>
                                                        <td className="px-2 py-1">{log.target}</td>
                                                        <td className="px-2 py-1 text-center">
                                                            <Badge className={log.status === 'SUCCESS' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}>
                                                                {log.status}
                                                            </Badge>
                                                        </td>
                                                        <td className="px-2 py-1 max-w-[200px] truncate" title={log.message || ''}>
                                                            {log.message}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </CardContent>
            )}
        </Card>
    );
}
