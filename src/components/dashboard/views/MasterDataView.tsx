'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import axios from 'axios';
import * as XLSX from 'xlsx';

// ─── Types ────────────────────────────────────────────────────

interface CityCluster {
    id: number;
    city: string;
    province: string | null;
    area: string;
    cluster: string;
    subCluster: string | null;
}

interface ProductDim {
    id: number;
    itemNo: string;
    itemName: string | null;
    weightKg: number | null;
    lengthCm: number | null;
    widthCm: number | null;
    heightCm: number | null;
}

// ─── Component ────────────────────────────────────────────────

export const MasterDataView: React.FC = () => {
    const [tab, setTab] = useState<'cluster' | 'dimension'>('cluster');

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-3">
                <h2 className="text-lg font-bold">⚙️ Master Data</h2>
                <div className="flex gap-1 bg-muted rounded-lg p-1">
                    {[
                        { key: 'cluster', label: '📍 Area & Cluster' },
                        { key: 'dimension', label: '📦 Dimensi Produk' },
                    ].map(t => (
                        <button key={t.key}
                            onClick={() => setTab(t.key as any)}
                            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${tab === t.key
                                ? 'bg-white shadow-sm text-blue-700'
                                : 'text-muted-foreground hover:text-foreground'
                            }`}
                        >{t.label}</button>
                    ))}
                </div>
            </div>
            {tab === 'cluster' ? <CityClusterTab /> : <ProductDimensionTab />}
        </div>
    );
};

// ─── City Cluster Tab ─────────────────────────────────────────

function CityClusterTab() {
    const [data, setData] = useState<CityCluster[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [showForm, setShowForm] = useState(false);
    const [editItem, setEditItem] = useState<CityCluster | null>(null);
    const [importing, setImporting] = useState(false);
    const [importResult, setImportResult] = useState<any>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    // Form state
    const [formCity, setFormCity] = useState('');
    const [formProvince, setFormProvince] = useState('');
    const [formArea, setFormArea] = useState('');
    const [formCluster, setFormCluster] = useState('');
    const [formSubCluster, setFormSubCluster] = useState('');

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const res = await axios.get('/api/master/city-cluster');
            setData(res.data);
        } catch { }
        setLoading(false);
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    const resetForm = () => {
        setFormCity(''); setFormProvince(''); setFormArea('');
        setFormCluster(''); setFormSubCluster('');
        setShowForm(false); setEditItem(null);
    };

    const startEdit = (item: CityCluster) => {
        setEditItem(item);
        setFormCity(item.city);
        setFormProvince(item.province || '');
        setFormArea(item.area);
        setFormCluster(item.cluster);
        setFormSubCluster(item.subCluster || '');
        setShowForm(true);
    };

    const handleSave = async () => {
        if (!formCity || !formArea) return;
        try {
            await axios.post('/api/master/city-cluster', {
                city: formCity, province: formProvince, area: formArea,
                cluster: formCluster, subCluster: formSubCluster,
            });
            resetForm();
            fetchData();
        } catch (err: any) {
            alert('Gagal menyimpan: ' + err.message);
        }
    };

    const handleDelete = async (id: number) => {
        if (!confirm('Hapus mapping ini?')) return;
        try {
            await axios.delete(`/api/master/city-cluster?id=${id}`);
            fetchData();
        } catch { }
    };

    const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setImporting(true);
        setImportResult(null);
        try {
            const formData = new FormData();
            formData.append('file', file);
            const res = await axios.post('/api/master/city-cluster/import', formData);
            setImportResult(res.data);
            fetchData();
        } catch (err: any) {
            setImportResult({ error: err.response?.data?.error || err.message });
        }
        setImporting(false);
        if (fileRef.current) fileRef.current.value = '';
    };

    const downloadTemplate = () => {
        const ws = XLSX.utils.aoa_to_sheet([
            ['Kota', 'Provinsi', 'Area', 'Cluster', 'Sub Cluster'],
            ['Cilacap', 'Jawa Tengah', 'Jateng Selatan', 'Banyumas Raya', 'Cilacap'],
            ['Banyumas', 'Jawa Tengah', 'Jateng Selatan', 'Banyumas Raya', 'Banyumas'],
            ['Purwokerto', 'Jawa Tengah', 'Jateng Selatan', 'Banyumas Raya', 'Purwokerto'],
        ]);
        ws['!cols'] = [{ wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 20 }];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Area Cluster');
        XLSX.writeFile(wb, 'Template_Area_Cluster.xlsx');
    };

    const filtered = data.filter(d =>
        !search || d.city.toLowerCase().includes(search.toLowerCase()) ||
        d.area.toLowerCase().includes(search.toLowerCase()) ||
        d.cluster.toLowerCase().includes(search.toLowerCase())
    );

    // Get unique areas for summary
    const areas = [...new Set(data.map(d => d.area))];
    const clusters = [...new Set(data.map(d => d.cluster))];

    return (
        <div className="space-y-4">
            {/* Summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                    { label: 'Total Kota', value: data.length, icon: '🏙️', color: 'bg-blue-50 border-blue-200' },
                    { label: 'Area', value: areas.length, icon: '🗺️', color: 'bg-green-50 border-green-200' },
                    { label: 'Cluster', value: clusters.length, icon: '📍', color: 'bg-purple-50 border-purple-200' },
                    { label: 'Belum Mapping', value: '-', icon: '⚠️', color: 'bg-amber-50 border-amber-200' },
                ].map(c => (
                    <Card key={c.label} className={`border ${c.color}`}>
                        <CardContent className="p-3">
                            <p className="text-lg">{c.icon}</p>
                            <p className="text-xs text-muted-foreground">{c.label}</p>
                            <p className="text-sm font-bold">{c.value}</p>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-2">
                <Input placeholder="🔍 Cari kota/area/cluster..." value={search}
                    onChange={e => setSearch(e.target.value)} className="w-56 text-xs h-8" />
                <Button size="sm" onClick={() => { resetForm(); setShowForm(true); }}
                    className="text-xs h-8 bg-blue-600 hover:bg-blue-700">+ Tambah</Button>
                <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}
                    className="text-xs h-8" disabled={importing}>
                    {importing ? '⏳ Importing...' : '📥 Import Excel'}
                </Button>
                <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImport} />
                <Button size="sm" variant="outline" onClick={downloadTemplate}
                    className="text-xs h-8">📄 Download Template</Button>
            </div>

            {/* Import result */}
            {importResult && (
                <div className={`text-xs px-3 py-2 rounded-lg border mb-3 ${importResult.error
                    ? 'bg-red-50 border-red-200 text-red-700'
                    : 'bg-green-50 border-green-200 text-green-700'}`}>
                    <div className="flex justify-between items-start">
                        <div>
                            {importResult.error
                                ? `❌ ${importResult.error}`
                                : `✅ Import selesai: ${importResult.imported} berhasil, ${importResult.skipped} dilewati`}
                            {importResult.errors && importResult.errors.length > 0 && (
                                <ul className="mt-2 text-red-600 list-disc ml-4">
                                    {importResult.errors.map((err: string, i: number) => <li key={i}>{err}</li>)}
                                </ul>
                            )}
                        </div>
                        <button onClick={() => setImportResult(null)} className="opacity-50 hover:opacity-100">✕</button>
                    </div>
                </div>
            )}

            {/* Add/Edit Form */}
            {showForm && (
                <Card className="border-blue-200 bg-blue-50/30">
                    <CardContent className="p-4">
                        <p className="text-xs font-semibold mb-3">{editItem ? `✏️ Edit: ${editItem.city}` : '➕ Tambah Mapping'}</p>
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                            <Input placeholder="Kota *" value={formCity} onChange={e => setFormCity(e.target.value)} className="text-xs h-8" disabled={!!editItem} />
                            <Input placeholder="Provinsi" value={formProvince} onChange={e => setFormProvince(e.target.value)} className="text-xs h-8" />
                            <Input placeholder="Area *" value={formArea} onChange={e => setFormArea(e.target.value)} className="text-xs h-8" />
                            <Input placeholder="Cluster" value={formCluster} onChange={e => setFormCluster(e.target.value)} className="text-xs h-8" />
                            <Input placeholder="Sub Cluster" value={formSubCluster} onChange={e => setFormSubCluster(e.target.value)} className="text-xs h-8" />
                        </div>
                        <div className="flex gap-2 mt-3">
                            <Button size="sm" onClick={handleSave} className="text-xs h-7 bg-blue-600 hover:bg-blue-700">💾 Simpan</Button>
                            <Button size="sm" variant="ghost" onClick={resetForm} className="text-xs h-7">Batal</Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Table */}
            <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                    <thead>
                        <tr className="bg-muted/50 text-left">
                            <th className="px-3 py-2 font-medium w-8">#</th>
                            <th className="px-3 py-2 font-medium">Kota</th>
                            <th className="px-3 py-2 font-medium">Provinsi</th>
                            <th className="px-3 py-2 font-medium">Area</th>
                            <th className="px-3 py-2 font-medium">Cluster</th>
                            <th className="px-3 py-2 font-medium">Sub Cluster</th>
                            <th className="px-3 py-2 font-medium text-center">Aksi</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && (
                            <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">
                                <div className="inline-block w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mr-2" />
                                Memuat data...
                            </td></tr>
                        )}
                        {!loading && filtered.length === 0 && (
                            <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">
                                Belum ada data mapping kota. Klik "Tambah" atau "Import Excel".
                            </td></tr>
                        )}
                        {!loading && filtered.map((item, idx) => (
                            <tr key={item.id} className="border-t hover:bg-muted/20">
                                <td className="px-3 py-2 text-muted-foreground">{idx + 1}</td>
                                <td className="px-3 py-2 font-medium">{item.city}</td>
                                <td className="px-3 py-2 text-muted-foreground">{item.province || '-'}</td>
                                <td className="px-3 py-2"><Badge variant="outline" className="text-[10px]">{item.area}</Badge></td>
                                <td className="px-3 py-2"><Badge variant="outline" className="text-[10px] bg-purple-50">{item.cluster}</Badge></td>
                                <td className="px-3 py-2 text-muted-foreground">{item.subCluster || '-'}</td>
                                <td className="px-3 py-2 text-center">
                                    <button onClick={() => startEdit(item)} className="text-blue-600 hover:underline text-[11px] mr-2">Edit</button>
                                    <button onClick={() => handleDelete(item.id)} className="text-red-500 hover:underline text-[11px]">Hapus</button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {!loading && <p className="text-xs text-muted-foreground text-right">{filtered.length} dari {data.length} data</p>}
        </div>
    );
}

// ─── Product Dimension Tab ────────────────────────────────────

function ProductDimensionTab() {
    const [data, setData] = useState<ProductDim[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [showForm, setShowForm] = useState(false);
    const [editItem, setEditItem] = useState<ProductDim | null>(null);
    const [importing, setImporting] = useState(false);
    const [importResult, setImportResult] = useState<any>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    // Form state
    const [formItemNo, setFormItemNo] = useState('');
    const [formItemName, setFormItemName] = useState('');
    const [formWeight, setFormWeight] = useState('');
    const [formLength, setFormLength] = useState('');
    const [formWidth, setFormWidth] = useState('');
    const [formHeight, setFormHeight] = useState('');

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const res = await axios.get('/api/master/product-dimension');
            setData(res.data);
        } catch { }
        setLoading(false);
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    const resetForm = () => {
        setFormItemNo(''); setFormItemName(''); setFormWeight('');
        setFormLength(''); setFormWidth(''); setFormHeight('');
        setShowForm(false); setEditItem(null);
    };

    const startEdit = (item: ProductDim) => {
        setEditItem(item);
        setFormItemNo(item.itemNo);
        setFormItemName(item.itemName || '');
        setFormWeight(item.weightKg?.toString() || '');
        setFormLength(item.lengthCm?.toString() || '');
        setFormWidth(item.widthCm?.toString() || '');
        setFormHeight(item.heightCm?.toString() || '');
        setShowForm(true);
    };

    const handleSave = async () => {
        if (!formItemNo) return;
        try {
            await axios.post('/api/master/product-dimension', {
                itemNo: formItemNo, itemName: formItemName,
                weightKg: formWeight || null, lengthCm: formLength || null,
                widthCm: formWidth || null, heightCm: formHeight || null,
            });
            resetForm();
            fetchData();
        } catch (err: any) {
            alert('Gagal menyimpan: ' + err.message);
        }
    };

    const handleDelete = async (id: number) => {
        if (!confirm('Hapus data dimensi ini?')) return;
        try {
            await axios.delete(`/api/master/product-dimension?id=${id}`);
            fetchData();
        } catch { }
    };

    const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setImporting(true);
        setImportResult(null);
        try {
            const formData = new FormData();
            formData.append('file', file);
            const res = await axios.post('/api/master/product-dimension/import', formData);
            setImportResult(res.data);
            fetchData();
        } catch (err: any) {
            setImportResult({ error: err.response?.data?.error || err.message });
        }
        setImporting(false);
        if (fileRef.current) fileRef.current.value = '';
    };

    const downloadTemplate = () => {
        const ws = XLSX.utils.aoa_to_sheet([
            ['Kode Barang', 'Nama Barang', 'Berat (kg)', 'Panjang (cm)', 'Lebar (cm)', 'Tinggi (cm)'],
            ['IK-051', 'Starban 585 EC 400ml', 0.45, 8, 8, 18],
            ['IK-050', 'Starban 585 EC 100ml', 0.12, 5, 5, 12],
        ]);
        ws['!cols'] = [{ wch: 15 }, { wch: 30 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 12 }];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Dimensi Produk');
        XLSX.writeFile(wb, 'Template_Dimensi_Produk.xlsx');
    };

    const calcVolume = (l?: number | null, w?: number | null, h?: number | null) => {
        if (!l || !w || !h) return null;
        return (l * w * h) / 1_000_000; // cm³ -> m³
    };

    const filtered = data.filter(d =>
        !search || d.itemNo.toLowerCase().includes(search.toLowerCase()) ||
        (d.itemName || '').toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="space-y-4">
            {/* Summary */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[
                    { label: 'Total Produk', value: data.length, icon: '📦', color: 'bg-blue-50 border-blue-200' },
                    { label: 'Ada Berat', value: data.filter(d => d.weightKg).length, icon: '⚖️', color: 'bg-green-50 border-green-200' },
                    { label: 'Ada Dimensi', value: data.filter(d => d.lengthCm && d.widthCm && d.heightCm).length, icon: '📐', color: 'bg-purple-50 border-purple-200' },
                ].map(c => (
                    <Card key={c.label} className={`border ${c.color}`}>
                        <CardContent className="p-3">
                            <p className="text-lg">{c.icon}</p>
                            <p className="text-xs text-muted-foreground">{c.label}</p>
                            <p className="text-sm font-bold">{c.value}</p>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-2">
                <Input placeholder="🔍 Cari kode/nama barang..." value={search}
                    onChange={e => setSearch(e.target.value)} className="w-56 text-xs h-8" />
                <Button size="sm" onClick={() => { resetForm(); setShowForm(true); }}
                    className="text-xs h-8 bg-blue-600 hover:bg-blue-700">+ Tambah</Button>
                <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}
                    className="text-xs h-8" disabled={importing}>
                    {importing ? '⏳ Importing...' : '📥 Import Excel'}
                </Button>
                <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImport} />
                <Button size="sm" variant="outline" onClick={downloadTemplate}
                    className="text-xs h-8">📄 Download Template</Button>
            </div>

            {/* Import result */}
            {importResult && (
                <div className={`text-xs px-3 py-2 rounded-lg border mb-3 ${importResult.error
                    ? 'bg-red-50 border-red-200 text-red-700'
                    : 'bg-green-50 border-green-200 text-green-700'}`}>
                    <div className="flex justify-between items-start">
                        <div>
                            {importResult.error
                                ? `❌ ${importResult.error}`
                                : `✅ Import selesai: ${importResult.imported} berhasil, ${importResult.skipped} dilewati`}
                            {importResult.errors && importResult.errors.length > 0 && (
                                <ul className="mt-2 text-red-600 list-disc ml-4">
                                    {importResult.errors.map((err: string, i: number) => <li key={i}>{err}</li>)}
                                </ul>
                            )}
                        </div>
                        <button onClick={() => setImportResult(null)} className="opacity-50 hover:opacity-100">✕</button>
                    </div>
                </div>
            )}

            {/* Add/Edit Form */}
            {showForm && (
                <Card className="border-blue-200 bg-blue-50/30">
                    <CardContent className="p-4">
                        <p className="text-xs font-semibold mb-3">{editItem ? `✏️ Edit: ${editItem.itemNo}` : '➕ Tambah Dimensi'}</p>
                        <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
                            <Input placeholder="Kode Barang *" value={formItemNo} onChange={e => setFormItemNo(e.target.value)} className="text-xs h-8" disabled={!!editItem} />
                            <Input placeholder="Nama Barang" value={formItemName} onChange={e => setFormItemName(e.target.value)} className="text-xs h-8" />
                            <Input placeholder="Berat (kg)" type="number" step="0.01" value={formWeight} onChange={e => setFormWeight(e.target.value)} className="text-xs h-8" />
                            <Input placeholder="Panjang (cm)" type="number" step="0.1" value={formLength} onChange={e => setFormLength(e.target.value)} className="text-xs h-8" />
                            <Input placeholder="Lebar (cm)" type="number" step="0.1" value={formWidth} onChange={e => setFormWidth(e.target.value)} className="text-xs h-8" />
                            <Input placeholder="Tinggi (cm)" type="number" step="0.1" value={formHeight} onChange={e => setFormHeight(e.target.value)} className="text-xs h-8" />
                        </div>
                        <div className="flex gap-2 mt-3">
                            <Button size="sm" onClick={handleSave} className="text-xs h-7 bg-blue-600 hover:bg-blue-700">💾 Simpan</Button>
                            <Button size="sm" variant="ghost" onClick={resetForm} className="text-xs h-7">Batal</Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Table */}
            <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                    <thead>
                        <tr className="bg-muted/50 text-left">
                            <th className="px-3 py-2 font-medium w-8">#</th>
                            <th className="px-3 py-2 font-medium">Kode Barang</th>
                            <th className="px-3 py-2 font-medium">Nama Barang</th>
                            <th className="px-3 py-2 font-medium text-right">Berat (kg)</th>
                            <th className="px-3 py-2 font-medium text-right">P (cm)</th>
                            <th className="px-3 py-2 font-medium text-right">L (cm)</th>
                            <th className="px-3 py-2 font-medium text-right">T (cm)</th>
                            <th className="px-3 py-2 font-medium text-right">Volume (m³)</th>
                            <th className="px-3 py-2 font-medium text-center">Aksi</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && (
                            <tr><td colSpan={9} className="text-center py-8 text-muted-foreground">
                                <div className="inline-block w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mr-2" />
                                Memuat data...
                            </td></tr>
                        )}
                        {!loading && filtered.length === 0 && (
                            <tr><td colSpan={9} className="text-center py-8 text-muted-foreground">
                                Belum ada data dimensi. Klik "Tambah" atau "Import Excel".
                            </td></tr>
                        )}
                        {!loading && filtered.map((item, idx) => {
                            const vol = calcVolume(item.lengthCm, item.widthCm, item.heightCm);
                            return (
                                <tr key={item.id} className="border-t hover:bg-muted/20">
                                    <td className="px-3 py-2 text-muted-foreground">{idx + 1}</td>
                                    <td className="px-3 py-2 font-mono font-medium text-blue-700">{item.itemNo}</td>
                                    <td className="px-3 py-2">{item.itemName || '-'}</td>
                                    <td className="px-3 py-2 text-right">{item.weightKg?.toFixed(2) || <span className="text-muted-foreground">-</span>}</td>
                                    <td className="px-3 py-2 text-right">{item.lengthCm?.toFixed(1) || <span className="text-muted-foreground">-</span>}</td>
                                    <td className="px-3 py-2 text-right">{item.widthCm?.toFixed(1) || <span className="text-muted-foreground">-</span>}</td>
                                    <td className="px-3 py-2 text-right">{item.heightCm?.toFixed(1) || <span className="text-muted-foreground">-</span>}</td>
                                    <td className="px-3 py-2 text-right font-mono">{vol ? vol.toFixed(6) : <span className="text-muted-foreground">-</span>}</td>
                                    <td className="px-3 py-2 text-center">
                                        <button onClick={() => startEdit(item)} className="text-blue-600 hover:underline text-[11px] mr-2">Edit</button>
                                        <button onClick={() => handleDelete(item.id)} className="text-red-500 hover:underline text-[11px]">Hapus</button>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            {!loading && <p className="text-xs text-muted-foreground text-right">{filtered.length} dari {data.length} data</p>}
        </div>
    );
}
