'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ArrowUpDown, ChevronUp, ChevronDown } from "lucide-react";
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
    qtyPerCarton: number | null;
}

interface ProductMasterItem {
    id: number | null;
    itemNo: string;
    itemName: string | null;
    unit1Name: string | null;
    displayUnit: string | null;
    conversionRatio: number | null;
    shouldConvert: boolean;
    category: string | null;
    notes: string | null;
    source?: 'master' | 'auto'; // 'master' = sudah disimpan, 'auto' = masih auto-detect
}

// ─── Component ────────────────────────────────────────────────

function SortHeader({ label, sortKey, currentSort, onSort, align = 'left' }: { 
    label: string, 
    sortKey: string, 
    currentSort: { key: string | null, direction: 'asc' | 'desc' }, 
    onSort: (key: string) => void,
    align?: 'left' | 'right' | 'center' 
}) {
    return (
        <th className={`px-3 py-2 font-medium cursor-pointer hover:bg-muted/80 select-none group focus:outline-none`} 
            onClick={() => onSort(sortKey)}>
            <div className={`flex items-center ${align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start'}`}>
                {label}
                {currentSort.key === sortKey ? (
                    currentSort.direction === 'asc' ? 
                        <ChevronUp className="ml-1 h-3.5 w-3.5 inline-block text-blue-600" /> : 
                        <ChevronDown className="ml-1 h-3.5 w-3.5 inline-block text-blue-600" />
                ) : (
                    <ArrowUpDown className="ml-1 h-3.5 w-3.5 inline-block opacity-0 group-hover:opacity-40" />
                )}
            </div>
        </th>
    );
}

export const MasterDataView: React.FC = () => {
    const [tab, setTab] = useState<'cluster' | 'dimension' | 'conversion'>('cluster');

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-3">
                <h2 className="text-lg font-bold">⚙️ Master Data</h2>
                <div className="flex gap-1 bg-muted rounded-lg p-1">
                    {[
                        { key: 'cluster', label: '📍 Area & Cluster' },
                        { key: 'dimension', label: '📦 Dimensi Produk' },
                        { key: 'conversion', label: '⚖️ Konversi Satuan' },
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
            {tab === 'cluster' && <CityClusterTab />}
            {tab === 'dimension' && <ProductDimensionTab />}
            {tab === 'conversion' && <ProductConversionTab />}
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

    const [selectedIds, setSelectedIds] = useState<number[]>([]);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const res = await axios.get('/api/master/city-cluster');
            setData(res.data);
        } catch { }
        setLoading(false);
        setSelectedIds([]);
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
                id: editItem?.id,
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

    const [sortConfig, setSortConfig] = useState<{ key: keyof CityCluster | null, direction: 'asc' | 'desc' }>({ key: null, direction: 'asc' });

    const handleSort = (key: string) => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
        setSortConfig({ key: key as keyof CityCluster, direction });
    };

    const sortedFiltered = React.useMemo(() => {
        let result = data.filter(d =>
            !search || d.city.toLowerCase().includes(search.toLowerCase()) ||
            d.area.toLowerCase().includes(search.toLowerCase()) ||
            d.cluster.toLowerCase().includes(search.toLowerCase())
        );

        if (sortConfig.key) {
            result.sort((a, b) => {
                const aVal = a[sortConfig.key!];
                const bVal = b[sortConfig.key!];
                if (aVal === bVal) return 0;
                if (aVal === null || aVal === undefined) return 1;
                if (bVal === null || bVal === undefined) return -1;
                const comparison = aVal < bVal ? -1 : 1;
                return sortConfig.direction === 'asc' ? comparison : -comparison;
            });
        }
        return result;
    }, [data, search, sortConfig]);

    const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.checked) setSelectedIds(sortedFiltered.map(d => d.id));
        else setSelectedIds([]);
    };

    const handleSelect = (id: number, checked: boolean) => {
        if (checked) setSelectedIds(prev => [...prev, id]);
        else setSelectedIds(prev => prev.filter(i => i !== id));
    };

    const handleDeleteSelected = async () => {
        if (!confirm(`Hapus ${selectedIds.length} data yang dipilih?`)) return;
        try {
            await axios.delete(`/api/master/city-cluster?ids=${selectedIds.join(',')}`);
            fetchData();
        } catch (err: any) {
            alert('Gagal menghapus data: ' + err.message);
        }
    };

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
                {selectedIds.length > 0 && (
                    <Button size="sm" variant="destructive" onClick={handleDeleteSelected} className="text-xs h-8 bg-red-600 hover:bg-red-700">
                        🗑️ Hapus {selectedIds.length} Terpilih
                    </Button>
                )}
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
                            <Input placeholder="Kota *" value={formCity} onChange={e => setFormCity(e.target.value)} className="text-xs h-8" />
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
                        <tr className="bg-muted/50 text-left whitespace-nowrap">
                            <th className="px-3 py-2 w-8 text-center">
                                <input type="checkbox" className="rounded"
                                    checked={sortedFiltered.length > 0 && selectedIds.length === sortedFiltered.length}
                                    onChange={handleSelectAll} />
                            </th>
                            <th className="px-3 py-2 font-medium w-8">#</th>
                            <SortHeader label="Kota" sortKey="city" currentSort={sortConfig} onSort={handleSort} />
                            <SortHeader label="Provinsi" sortKey="province" currentSort={sortConfig} onSort={handleSort} />
                            <SortHeader label="Area" sortKey="area" currentSort={sortConfig} onSort={handleSort} />
                            <SortHeader label="Cluster" sortKey="cluster" currentSort={sortConfig} onSort={handleSort} />
                            <SortHeader label="Sub Cluster" sortKey="subCluster" currentSort={sortConfig} onSort={handleSort} />
                            <th className="px-3 py-2 font-medium text-center">Aksi</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && (
                            <tr><td colSpan={8} className="text-center py-8 text-muted-foreground">
                                <div className="inline-block w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mr-2" />
                                Memuat data...
                            </td></tr>
                        )}
                        {!loading && sortedFiltered.length === 0 && (
                            <tr><td colSpan={8} className="text-center py-8 text-muted-foreground">
                                Belum ada data mapping kota. Klik "Tambah" atau "Import Excel".
                            </td></tr>
                        )}
                        {!loading && sortedFiltered.map((item, idx) => (
                            <tr key={item.id} className={`border-t hover:bg-muted/20 ${selectedIds.includes(item.id) ? 'bg-blue-50/50' : ''}`}>
                                <td className="px-3 py-2 text-center text-muted-foreground">
                                    <input type="checkbox" className="rounded"
                                        checked={selectedIds.includes(item.id)}
                                        onChange={(e) => handleSelect(item.id, e.target.checked)} />
                                </td>
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
            {!loading && <p className="text-xs text-muted-foreground text-right">{sortedFiltered.length} dari {data.length} data</p>}
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
    const [syncingKarton, setSyncingKarton] = useState(false);
    const [importResult, setImportResult] = useState<any>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    // Form state
    const [formItemNo, setFormItemNo] = useState('');
    const [formItemName, setFormItemName] = useState('');
    const [formWeight, setFormWeight] = useState('');
    const [formLength, setFormLength] = useState('');
    const [formWidth, setFormWidth] = useState('');
    const [formHeight, setFormHeight] = useState('');

    const [selectedIds, setSelectedIds] = useState<number[]>([]);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const res = await axios.get('/api/master/product-dimension');
            setData(res.data);
        } catch { }
        setLoading(false);
        setSelectedIds([]);
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
                id: editItem?.id,
                itemNo: formItemNo, itemName: formItemName,
                weightKg: formWeight || null,
                lengthCm: formLength || null,
                widthCm: formWidth || null,
                heightCm: formHeight || null,
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

    const handleSyncKarton = async () => {
        setSyncingKarton(true);
        try {
            const res = await axios.post('/api/master/product-dimension/sync-karton');
            alert(res.data.message);
            fetchData();
        } catch (err: any) {
            alert('Gagal sync isi karton: ' + (err.response?.data?.error || err.message));
        }
        setSyncingKarton(false);
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

    const [sortConfig, setSortConfig] = useState<{ key: string | null, direction: 'asc' | 'desc' }>({ key: null, direction: 'asc' });

    const handleSort = (key: string) => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
        setSortConfig({ key, direction });
    };

    const calcVolume = (l?: number | null, w?: number | null, h?: number | null) => {
        if (!l || !w || !h) return null;
        return (l * w * h) / 1_000_000; // cm³ -> m³
    };

    const sortedFiltered = React.useMemo(() => {
        let result = data.filter(d =>
            !search || d.itemNo.toLowerCase().includes(search.toLowerCase()) ||
            (d.itemName || '').toLowerCase().includes(search.toLowerCase())
        );

        if (sortConfig.key) {
            result.sort((a, b) => {
                let aVal: any = a[sortConfig.key as keyof ProductDim];
                let bVal: any = b[sortConfig.key as keyof ProductDim];

                if (sortConfig.key === 'volume') {
                    aVal = calcVolume(a.lengthCm, a.widthCm, a.heightCm);
                    bVal = calcVolume(b.lengthCm, b.widthCm, b.heightCm);
                }

                if (aVal === bVal) return 0;
                if (aVal === null || aVal === undefined) return 1;
                if (bVal === null || bVal === undefined) return -1;

                const comparison = aVal < bVal ? -1 : 1;
                return sortConfig.direction === 'asc' ? comparison : -comparison;
            });
        }
        return result;
    }, [data, search, sortConfig]);

    const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.checked) setSelectedIds(sortedFiltered.map(d => d.id));
        else setSelectedIds([]);
    };

    const handleSelect = (id: number, checked: boolean) => {
        if (checked) setSelectedIds(prev => [...prev, id]);
        else setSelectedIds(prev => prev.filter(i => i !== id));
    };

    const handleDeleteSelected = async () => {
        if (!confirm(`Hapus ${selectedIds.length} data yang dipilih?`)) return;
        try {
            await axios.delete(`/api/master/product-dimension?ids=${selectedIds.join(',')}`);
            fetchData();
        } catch (err: any) {
            alert('Gagal menghapus data: ' + err.message);
        }
    };

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
                <Button size="sm" variant="outline" onClick={handleSyncKarton} disabled={syncingKarton}
                    className="text-xs h-8 bg-purple-50 text-purple-700 hover:bg-purple-100 hover:text-purple-800 border-purple-200">
                    {syncingKarton ? '⏳ Syncing...' : '🔄 Sync Isi Karton'}
                </Button>
                {selectedIds.length > 0 && (
                    <Button size="sm" variant="destructive" onClick={handleDeleteSelected} className="text-xs h-8 bg-red-600 hover:bg-red-700">
                        🗑️ Hapus {selectedIds.length} Terpilih
                    </Button>
                )}
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
                            <Input placeholder="Kode Barang *" value={formItemNo} onChange={e => setFormItemNo(e.target.value)} className="text-xs h-8" />
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
                        <tr className="bg-muted/50 text-left whitespace-nowrap">
                            <th className="px-3 py-2 w-8 text-center">
                                <input type="checkbox" className="rounded"
                                    checked={sortedFiltered.length > 0 && selectedIds.length === sortedFiltered.length}
                                    onChange={handleSelectAll} />
                            </th>
                            <th className="px-3 py-2 font-medium w-8">#</th>
                            <SortHeader label="Kode Barang" sortKey="itemNo" currentSort={sortConfig} onSort={handleSort} />
                            <SortHeader label="Nama Barang" sortKey="itemName" currentSort={sortConfig} onSort={handleSort} />
                            <SortHeader label="Berat (kg)" sortKey="weightKg" currentSort={sortConfig} onSort={handleSort} align="right" />
                            <SortHeader label="P (cm)" sortKey="lengthCm" currentSort={sortConfig} onSort={handleSort} align="right" />
                            <SortHeader label="L (cm)" sortKey="widthCm" currentSort={sortConfig} onSort={handleSort} align="right" />
                            <SortHeader label="T (cm)" sortKey="heightCm" currentSort={sortConfig} onSort={handleSort} align="right" />
                            <SortHeader label="Isi Karton" sortKey="qtyPerCarton" currentSort={sortConfig} onSort={handleSort} align="right" />
                            <SortHeader label="Volume/Pcs (m³)" sortKey="volume" currentSort={sortConfig} onSort={handleSort} align="right" />
                            <th className="px-3 py-2 font-medium text-center">Aksi</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && (
                            <tr><td colSpan={11} className="text-center py-8 text-muted-foreground">
                                <div className="inline-block w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mr-2" />
                                Memuat data...
                            </td></tr>
                        )}
                        {!loading && sortedFiltered.length === 0 && (
                            <tr><td colSpan={11} className="text-center py-8 text-muted-foreground">
                                Belum ada data dimensi. Klik "Tambah" atau "Import Excel".
                            </td></tr>
                        )}
                        {!loading && sortedFiltered.map((item, idx) => {
                            const qty = (item.qtyPerCarton && item.qtyPerCarton > 1) ? item.qtyPerCarton : 1;
                            const cartonVol = calcVolume(item.lengthCm, item.widthCm, item.heightCm);
                            const pcsVol = cartonVol ? cartonVol / qty : null;

                            return (
                                <tr key={item.id} className={`border-t hover:bg-muted/20 ${selectedIds.includes(item.id) ? 'bg-blue-50/50' : ''}`}>
                                    <td className="px-3 py-2 text-center text-muted-foreground">
                                        <input type="checkbox" className="rounded"
                                            checked={selectedIds.includes(item.id)}
                                            onChange={(e) => handleSelect(item.id, e.target.checked)} />
                                    </td>
                                    <td className="px-3 py-2 text-muted-foreground">{idx + 1}</td>
                                    <td className="px-3 py-2 font-mono font-medium text-blue-700">{item.itemNo}</td>
                                    <td className="px-3 py-2">{item.itemName || '-'}</td>
                                    <td className="px-3 py-2 text-right">
                                        {item.weightKg ? item.weightKg.toFixed(2)
                                            : <span className="text-muted-foreground">-</span>
                                        }
                                    </td>
                                    <td className="px-3 py-2 text-right">{item.lengthCm?.toFixed(1) || <span className="text-muted-foreground">-</span>}</td>
                                    <td className="px-3 py-2 text-right">{item.widthCm?.toFixed(1) || <span className="text-muted-foreground">-</span>}</td>
                                    <td className="px-3 py-2 text-right">{item.heightCm?.toFixed(1) || <span className="text-muted-foreground">-</span>}</td>
                                    <td className="px-3 py-2 text-right">
                                        {item.qtyPerCarton && item.qtyPerCarton > 1 ? (
                                            <Badge variant="outline" className="text-[10px] bg-purple-50 text-purple-700">{item.qtyPerCarton}</Badge>
                                        ) : <span className="text-muted-foreground">-</span>}
                                    </td>
                                    <td className="px-3 py-2 text-right font-mono">
                                        {pcsVol ? 
                                            ((qty > 1) ? <span className="text-green-600 font-medium">{pcsVol.toFixed(6)}</span> : pcsVol.toFixed(6)) 
                                            : <span className="text-muted-foreground">-</span>
                                        }
                                    </td>
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
            {!loading && <p className="text-xs text-muted-foreground text-right">{sortedFiltered.length} dari {data.length} data</p>}
        </div>
    );
}

// ─── Product Conversion Tab ───────────────────────────────────

function ProductConversionTab() {
    const [data, setData] = useState<ProductMasterItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [showForm, setShowForm] = useState(false);
    const [editItem, setEditItem] = useState<ProductMasterItem | null>(null);
    const [importing, setImporting] = useState(false);
    const [populating, setPopulating] = useState(false);
    const [importResult, setImportResult] = useState<any>(null);
    const [populateResult, setPopulateResult] = useState<any>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    const [selectedIds, setSelectedIds] = useState<number[]>([]);
    const [filterConvert, setFilterConvert] = useState<'all' | 'yes' | 'no'>('all');

    // Form state
    const [formItemNo, setFormItemNo] = useState('');
    const [formItemName, setFormItemName] = useState('');
    const [formUnit1Name, setFormUnit1Name] = useState('');
    const [formDisplayUnit, setFormDisplayUnit] = useState('');
    const [formConversionRatio, setFormConversionRatio] = useState('');
    const [formShouldConvert, setFormShouldConvert] = useState(false);
    const [formCategory, setFormCategory] = useState('');
    const [formNotes, setFormNotes] = useState('');

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            // /effective returns ALL items: master (from DB) + auto-detect (from Accurate)
            const res = await axios.get('/api/master/product-master/effective');
            setData(res.data);
        } catch { }
        setLoading(false);
        setSelectedIds([]);
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    const resetForm = () => {
        setFormItemNo(''); setFormItemName(''); setFormUnit1Name('');
        setFormDisplayUnit(''); setFormConversionRatio('');
        setFormShouldConvert(false); setFormCategory(''); setFormNotes('');
        setShowForm(false); setEditItem(null);
    };

    const startEdit = (item: ProductMasterItem) => {
        setEditItem(item);
        setFormItemNo(item.itemNo);
        setFormItemName(item.itemName || '');
        setFormUnit1Name(item.unit1Name || '');
        setFormDisplayUnit(item.displayUnit || '');
        setFormConversionRatio(item.conversionRatio?.toString() || '');
        setFormShouldConvert(item.shouldConvert);
        setFormCategory(item.category || '');
        setFormNotes(item.notes || '');
        setShowForm(true);
    };

    const handleSave = async () => {
        if (!formItemNo) return;
        try {
            // Always upsert by itemNo — auto items have no id yet
            await axios.post('/api/master/product-master', {
                id: editItem?.id || undefined,
                itemNo: formItemNo, itemName: formItemName,
                unit1Name: formUnit1Name, displayUnit: formDisplayUnit,
                conversionRatio: formConversionRatio || null,
                shouldConvert: formShouldConvert,
                category: formCategory || null, notes: formNotes || null,
            });
            resetForm();
            fetchData();
        } catch (err: any) {
            alert('Gagal menyimpan: ' + (err.response?.data?.error || err.message));
        }
    };

    const handleDelete = async (item: ProductMasterItem) => {
        if (!item.id) {
            alert('Item ini belum disimpan ke master. Tidak perlu dihapus.');
            return;
        }
        if (!confirm('Hapus data konversi ini? Item akan kembali ke auto-detect.')) return;
        try {
            await axios.delete(`/api/master/product-master?id=${item.id}`);
            fetchData();
        } catch { }
    };

    const handleDeleteSelected = async () => {
        if (!confirm(`Hapus ${selectedIds.length} data yang dipilih?`)) return;
        try {
            await axios.delete(`/api/master/product-master?ids=${selectedIds.join(',')}`);
            fetchData();
        } catch (err: any) {
            alert('Gagal menghapus: ' + err.message);
        }
    };

    const handlePopulate = async () => {
        if (!confirm('Auto-populate akan mengambil semua item dari Accurate dan mengisi default konversi. Item yang sudah ada tidak akan di-overwrite. Lanjutkan?')) return;
        setPopulating(true);
        setPopulateResult(null);
        try {
            const res = await axios.post('/api/master/product-master/populate');
            setPopulateResult(res.data);
            fetchData();
        } catch (err: any) {
            setPopulateResult({ error: err.response?.data?.error || err.message });
        }
        setPopulating(false);
    };

    const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setImporting(true);
        setImportResult(null);
        try {
            const formData = new FormData();
            formData.append('file', file);
            const res = await axios.post('/api/master/product-master/import', formData);
            setImportResult(res.data);
            fetchData();
        } catch (err: any) {
            setImportResult({ error: err.response?.data?.error || err.message });
        }
        setImporting(false);
        if (fileRef.current) fileRef.current.value = '';
    };

    const exportExcel = () => {
        const rows = data.map(d => ({
            'Kode Barang': d.itemNo,
            'Nama Barang': d.itemName || '',
            'Unit Asli': d.unit1Name || '',
            'Unit Tampilan': d.displayUnit || '',
            'Rasio Konversi': d.conversionRatio || '',
            'Konversi Aktif': d.shouldConvert ? 'Ya' : 'Tidak',
            'Kategori': d.category || '',
            'Catatan': d.notes || '',
        }));
        const ws = XLSX.utils.json_to_sheet(rows);
        ws['!cols'] = [{ wch: 15 }, { wch: 35 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 13 }, { wch: 15 }, { wch: 20 }];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Konversi Satuan');
        XLSX.writeFile(wb, `Master_Konversi_Satuan_${new Date().toISOString().slice(0, 10)}.xlsx`);
    };

    const [sortConfig, setSortConfig] = useState<{ key: string | null, direction: 'asc' | 'desc' }>({ key: null, direction: 'asc' });
    const handleSort = (key: string) => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
        setSortConfig({ key, direction });
    };

    const sortedFiltered = React.useMemo(() => {
        let result = data.filter(d => {
            const matchSearch = !search || d.itemNo.toLowerCase().includes(search.toLowerCase()) ||
                (d.itemName || '').toLowerCase().includes(search.toLowerCase());
            const matchFilter = filterConvert === 'all' ||
                (filterConvert === 'yes' && d.shouldConvert) ||
                (filterConvert === 'no' && !d.shouldConvert) ||
                (filterConvert === 'master' && d.source === 'master') ||
                (filterConvert === 'auto' && d.source === 'auto');
            return matchSearch && matchFilter;
        });
        if (sortConfig.key) {
            result.sort((a, b) => {
                const aVal: any = a[sortConfig.key as keyof ProductMasterItem];
                const bVal: any = b[sortConfig.key as keyof ProductMasterItem];
                if (aVal === bVal) return 0;
                if (aVal === null || aVal === undefined) return 1;
                if (bVal === null || bVal === undefined) return -1;
                const comparison = aVal < bVal ? -1 : 1;
                return sortConfig.direction === 'asc' ? comparison : -comparison;
            });
        }
        return result;
    }, [data, search, sortConfig, filterConvert]);

    const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
        // Only select items that have been saved to master (have id)
        if (e.target.checked) setSelectedIds(sortedFiltered.filter(d => d.id !== null).map(d => d.id as number));
        else setSelectedIds([]);
    };
    const handleSelect = (id: number | null, checked: boolean) => {
        if (!id) return;
        if (checked) setSelectedIds(prev => [...prev, id]);
        else setSelectedIds(prev => prev.filter(i => i !== id));
    };

    const masterCount = data.filter(d => d.source === 'master').length;
    const autoCount = data.filter(d => d.source === 'auto').length;
    const convertCount = data.filter(d => d.shouldConvert).length;
    const noConvertCount = data.filter(d => !d.shouldConvert).length;

    return (
        <div className="space-y-4">
            {/* Summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                    { label: 'Total Item', value: data.length, icon: '📦', color: 'bg-blue-50 border-blue-200' },
                    { label: 'Sudah Diatur (Master)', value: masterCount, icon: '✏️', color: 'bg-indigo-50 border-indigo-200' },
                    { label: 'Auto-detect', value: autoCount, icon: '🤖', color: 'bg-amber-50 border-amber-200' },
                    { label: 'Aktif Konversi', value: convertCount, icon: '🔄', color: 'bg-green-50 border-green-200' },
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
                <select value={filterConvert} onChange={e => setFilterConvert(e.target.value as any)}
                    className="h-8 text-xs rounded-md border px-2 bg-white">
                    <option value="all">Semua</option>
                    <option value="yes">Konversi Aktif</option>
                    <option value="no">Tidak Konversi</option>
                    <option value="master">Sudah Diatur</option>
                    <option value="auto">Masih Auto-detect</option>
                </select>
                <Button size="sm" onClick={() => { resetForm(); setShowForm(true); }}
                    className="text-xs h-8 bg-blue-600 hover:bg-blue-700">+ Tambah</Button>
                <Button size="sm" variant="outline" onClick={handlePopulate} disabled={populating}
                    className="text-xs h-8 bg-amber-50 text-amber-700 hover:bg-amber-100 border-amber-200">
                    {populating ? '⏳ Populating...' : '🔄 Auto-populate dari Accurate'}
                </Button>
                <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}
                    className="text-xs h-8" disabled={importing}>
                    {importing ? '⏳ Importing...' : '📥 Import Excel'}
                </Button>
                <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImport} />
                <Button size="sm" variant="outline" onClick={exportExcel}
                    className="text-xs h-8">📤 Export Excel</Button>
                {selectedIds.length > 0 && (
                    <Button size="sm" variant="destructive" onClick={handleDeleteSelected} className="text-xs h-8 bg-red-600 hover:bg-red-700">
                        🗑️ Hapus {selectedIds.length} Terpilih
                    </Button>
                )}
            </div>

            {/* Populate result */}
            {populateResult && (
                <div className={`text-xs px-3 py-2 rounded-lg border ${populateResult.error
                    ? 'bg-red-50 border-red-200 text-red-700'
                    : 'bg-green-50 border-green-200 text-green-700'}`}>
                    <div className="flex justify-between items-start">
                        <div>
                            {populateResult.error
                                ? `❌ ${populateResult.error}`
                                : `✅ Auto-populate selesai: ${populateResult.created} item baru ditambahkan, ${populateResult.skipped} sudah ada (tidak di-overwrite)`}
                        </div>
                        <button onClick={() => setPopulateResult(null)} className="opacity-50 hover:opacity-100">✕</button>
                    </div>
                </div>
            )}

            {/* Import result */}
            {importResult && (
                <div className={`text-xs px-3 py-2 rounded-lg border ${importResult.error
                    ? 'bg-red-50 border-red-200 text-red-700'
                    : 'bg-green-50 border-green-200 text-green-700'}`}>
                    <div className="flex justify-between items-start">
                        <div>
                            {importResult.error
                                ? `❌ ${importResult.error}`
                                : `✅ Import selesai: ${importResult.imported || importResult.created || 0} berhasil`}
                        </div>
                        <button onClick={() => setImportResult(null)} className="opacity-50 hover:opacity-100">✕</button>
                    </div>
                </div>
            )}

            {/* Add/Edit Form */}
            {showForm && (
                <Card className="border-blue-200 bg-blue-50/30">
                    <CardContent className="p-4">
                        <p className="text-xs font-semibold mb-3">{editItem ? `✏️ Edit: ${editItem.itemNo}` : '➕ Tambah Konversi'}</p>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            <Input placeholder="Kode Barang *" value={formItemNo} onChange={e => setFormItemNo(e.target.value)} className="text-xs h-8" />
                            <Input placeholder="Nama Barang" value={formItemName} onChange={e => setFormItemName(e.target.value)} className="text-xs h-8" />
                            <Input placeholder="Unit Asli (Kg, Btl)" value={formUnit1Name} onChange={e => setFormUnit1Name(e.target.value)} className="text-xs h-8" />
                            <Input placeholder="Unit Tampilan (Sak, Btl)" value={formDisplayUnit} onChange={e => setFormDisplayUnit(e.target.value)} className="text-xs h-8" />
                            <Input placeholder="Rasio Konversi" type="number" step="0.1" value={formConversionRatio} onChange={e => setFormConversionRatio(e.target.value)} className="text-xs h-8" />
                            <label className="flex items-center gap-2 text-xs px-2">
                                <input type="checkbox" checked={formShouldConvert} onChange={e => setFormShouldConvert(e.target.checked)} className="rounded" />
                                Konversi Aktif
                            </label>
                            <Input placeholder="Kategori" value={formCategory} onChange={e => setFormCategory(e.target.value)} className="text-xs h-8" />
                            <Input placeholder="Catatan" value={formNotes} onChange={e => setFormNotes(e.target.value)} className="text-xs h-8" />
                        </div>
                        <div className="flex gap-2 mt-3">
                            <Button size="sm" onClick={handleSave} className="text-xs h-7 bg-blue-600 hover:bg-blue-700">💾 Simpan</Button>
                            <Button size="sm" variant="ghost" onClick={resetForm} className="text-xs h-7">Batal</Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Table */}
            <div className="border rounded-lg overflow-auto">
                <table className="w-full text-xs">
                    <thead>
                        <tr className="bg-muted/50 text-left whitespace-nowrap">
                            <th className="px-3 py-2 w-8 text-center">
                                <input type="checkbox" className="rounded"
                                    checked={sortedFiltered.length > 0 && selectedIds.length === sortedFiltered.length}
                                    onChange={handleSelectAll} />
                            </th>
                            <th className="px-3 py-2 font-medium w-8">#</th>
                            <SortHeader label="Kode Barang" sortKey="itemNo" currentSort={sortConfig} onSort={handleSort} />
                            <SortHeader label="Nama Barang" sortKey="itemName" currentSort={sortConfig} onSort={handleSort} />
                            <SortHeader label="Unit Asli" sortKey="unit1Name" currentSort={sortConfig} onSort={handleSort} />
                            <SortHeader label="Unit Tampilan" sortKey="displayUnit" currentSort={sortConfig} onSort={handleSort} />
                            <SortHeader label="Rasio" sortKey="conversionRatio" currentSort={sortConfig} onSort={handleSort} align="right" />
                            <th className="px-3 py-2 font-medium text-center">Konversi</th>
                            <th className="px-3 py-2 font-medium text-center">Sumber</th>
                            <th className="px-3 py-2 font-medium text-center">Aksi</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && (
                            <tr><td colSpan={10} className="text-center py-8 text-muted-foreground">
                                <div className="inline-block w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mr-2" />
                                Memuat data...
                            </td></tr>
                        )}
                        {!loading && sortedFiltered.length === 0 && (
                            <tr><td colSpan={10} className="text-center py-8 text-muted-foreground">
                                {data.length === 0
                                    ? 'Belum ada data. Klik "Auto-populate dari Accurate" untuk memulai.'
                                    : 'Tidak ada data yang cocok dengan filter.'}
                            </td></tr>
                        )}
                        {!loading && sortedFiltered.map((item, idx) => (
                            <tr key={item.itemNo} className={`border-t hover:bg-muted/20 ${
                                item.source === 'master' ? 'bg-white' : 'bg-amber-50/30'
                            } ${selectedIds.includes(item.id as number) ? 'bg-blue-50/50' : ''}`}>
                                <td className="px-3 py-2 text-center">
                                    {item.id ? (
                                        <input type="checkbox" className="rounded"
                                            checked={selectedIds.includes(item.id)}
                                            onChange={(e) => handleSelect(item.id, e.target.checked)} />
                                    ) : <span className="text-muted-foreground text-[10px]">-</span>}
                                </td>
                                <td className="px-3 py-2 text-muted-foreground">{idx + 1}</td>
                                <td className="px-3 py-2 font-mono font-medium text-blue-700">{item.itemNo}</td>
                                <td className="px-3 py-2 max-w-[200px] truncate">{item.itemName || '-'}</td>
                                <td className="px-3 py-2 text-muted-foreground">{item.unit1Name || '-'}</td>
                                <td className="px-3 py-2 font-medium">{item.displayUnit || '-'}</td>
                                <td className="px-3 py-2 text-right font-mono">
                                    {item.conversionRatio ? item.conversionRatio : <span className="text-muted-foreground">-</span>}
                                </td>
                                <td className="px-3 py-2 text-center">
                                    {item.shouldConvert
                                        ? <Badge className="text-[10px] bg-green-100 text-green-700 hover:bg-green-100">Aktif</Badge>
                                        : <Badge variant="outline" className="text-[10px] text-muted-foreground">Tidak</Badge>}
                                </td>
                                <td className="px-3 py-2 text-center">
                                    {item.source === 'master'
                                        ? <Badge className="text-[10px] bg-indigo-100 text-indigo-700 hover:bg-indigo-100">Master</Badge>
                                        : <Badge className="text-[10px] bg-amber-100 text-amber-700 hover:bg-amber-100">Auto</Badge>}
                                </td>
                                <td className="px-3 py-2 text-center whitespace-nowrap">
                                    <button onClick={() => startEdit(item)} className="text-blue-600 hover:underline text-[11px] mr-2">Edit</button>
                                    {item.id && (
                                        <button onClick={() => handleDelete(item)} className="text-red-500 hover:underline text-[11px]">Reset</button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {!loading && <p className="text-xs text-muted-foreground text-right">{sortedFiltered.length} dari {data.length} data</p>}
        </div>
    );
}
