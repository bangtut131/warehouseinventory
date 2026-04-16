'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

// ─── Types ────────────────────────────────────────────────

interface AppRole {
    id: number;
    name: string;
    description: string | null;
    allowedMenus: string[];
    hiddenColumns: string[];
    isDefault: boolean;
    _count?: { users: number };
}

interface AppUser {
    id: number;
    username: string;
    fullName: string | null;
    status: string;
    isActive: boolean;
    createdAt: string;
    role: { id: number; name: string };
}

interface MenuItem {
    id: string;
    label: string;
    category: string;
    icon: string;
}

interface ColumnItem {
    id: string;
    label: string;
    description: string;
}

type SettingsTab = 'users' | 'roles';

// ─── Main Component ─────────────────────────────────────────

export const GeneralSettingsView: React.FC = () => {
    const [tab, setTab] = useState<SettingsTab>('users');

    // Data
    const [users, setUsers] = useState<AppUser[]>([]);
    const [roles, setRoles] = useState<AppRole[]>([]);
    const [menuRegistry, setMenuRegistry] = useState<MenuItem[]>([]);
    const [columnRegistry, setColumnRegistry] = useState<ColumnItem[]>([]);
    const [loading, setLoading] = useState(true);

    // User form
    const [showUserForm, setShowUserForm] = useState(false);
    const [editingUser, setEditingUser] = useState<Partial<AppUser & { password?: string; roleId?: number }> | null>(null);

    // Role form
    const [showRoleForm, setShowRoleForm] = useState(false);
    const [editingRole, setEditingRole] = useState<Partial<AppRole> | null>(null);

    const [saving, setSaving] = useState(false);

    // ─── Fetch data ─────────────────────────────

    const fetchAll = useCallback(async () => {
        setLoading(true);
        try {
            const [usersRes, rolesRes] = await Promise.all([
                fetch('/api/users'),
                fetch('/api/roles'),
            ]);
            const usersData = await usersRes.json();
            const rolesData = await rolesRes.json();
            setUsers(usersData.users || []);
            setRoles(rolesData.roles || []);
            setMenuRegistry(rolesData.menuRegistry || []);
            setColumnRegistry(rolesData.columnRegistry || []);
        } catch { /* ignore */ }
        setLoading(false);
    }, []);

    useEffect(() => { fetchAll(); }, [fetchAll]);

    // ─── User CRUD handlers ─────────────────────

    const handleSaveUser = async () => {
        if (!editingUser?.username) return;
        setSaving(true);
        try {
            const method = editingUser.id ? 'PUT' : 'POST';
            const body: any = { ...editingUser };
            if (method === 'POST' && !body.roleId && roles.length > 0) {
                body.roleId = roles[0].id;
            }
            await fetch('/api/users', {
                method, headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            setShowUserForm(false);
            setEditingUser(null);
            await fetchAll();
        } catch { /* ignore */ }
        setSaving(false);
    };

    const handleApproveUser = async (user: AppUser) => {
        await fetch('/api/users', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: user.id, status: 'approved' }),
        });
        await fetchAll();
    };

    const handleRejectUser = async (user: AppUser) => {
        if (!confirm(`Tolak registrasi "${user.username}"?`)) return;
        await fetch('/api/users', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: user.id, status: 'rejected' }),
        });
        await fetchAll();
    };

    const handleToggleUser = async (user: AppUser) => {
        await fetch('/api/users', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: user.id, isActive: !user.isActive }),
        });
        await fetchAll();
    };

    const handleDeleteUser = async (id: number) => {
        if (!confirm('Hapus user ini?')) return;
        await fetch(`/api/users?id=${id}`, { method: 'DELETE' });
        await fetchAll();
    };

    // ─── Role CRUD handlers ─────────────────────

    const handleSaveRole = async () => {
        if (!editingRole?.name) return;
        setSaving(true);
        try {
            const method = editingRole.id ? 'PUT' : 'POST';
            await fetch('/api/roles', {
                method, headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(editingRole),
            });
            setShowRoleForm(false);
            setEditingRole(null);
            await fetchAll();
        } catch { /* ignore */ }
        setSaving(false);
    };

    const handleDeleteRole = async (id: number) => {
        if (!confirm('Hapus role ini?')) return;
        const res = await fetch(`/api/roles?id=${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) alert(data.error);
        await fetchAll();
    };

    const toggleMenu = (menuId: string) => {
        if (!editingRole) return;
        const current = editingRole.allowedMenus || [];
        const updated = current.includes(menuId)
            ? current.filter(m => m !== menuId)
            : [...current, menuId];
        setEditingRole({ ...editingRole, allowedMenus: updated });
    };

    const toggleColumn = (colId: string) => {
        if (!editingRole) return;
        const current = editingRole.hiddenColumns || [];
        const updated = current.includes(colId)
            ? current.filter(c => c !== colId)
            : [...current, colId];
        setEditingRole({ ...editingRole, hiddenColumns: updated });
    };

    const selectAllMenus = () => {
        if (!editingRole) return;
        setEditingRole({ ...editingRole, allowedMenus: menuRegistry.map(m => m.id) });
    };

    const clearAllMenus = () => {
        if (!editingRole) return;
        setEditingRole({ ...editingRole, allowedMenus: [] });
    };

    // ─── Status badge ───────────────────────────

    const StatusBadge = ({ status }: { status: string }) => {
        const cfg: Record<string, string> = {
            pending: 'bg-amber-100 text-amber-700 border-amber-200',
            approved: 'bg-green-100 text-green-700 border-green-200',
            rejected: 'bg-red-100 text-red-700 border-red-200',
        };
        return (
            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${cfg[status] || 'bg-gray-100 text-gray-500 border-gray-200'}`}>
                {status === 'pending' ? '⏳ Menunggu' : status === 'approved' ? '✅ Disetujui' : status === 'rejected' ? '❌ Ditolak' : status}
            </span>
        );
    };

    // ─── Render ─────────────────────────────────

    const pendingCount = users.filter(u => u.status === 'pending').length;

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="bg-gradient-to-r from-gray-800 to-gray-700 text-white rounded-xl p-5 shadow-lg">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-lg font-bold flex items-center gap-2">🛠️ Settings General</h2>
                        <p className="text-xs text-gray-300 mt-0.5">Kelola user, role, dan hak akses aplikasi</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={fetchAll} disabled={loading}
                        className="text-xs text-gray-300 border-gray-500 hover:bg-gray-600">
                        {loading ? '⟳ Memuat...' : '🔄 Refresh'}
                    </Button>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-2">
                <button
                    onClick={() => setTab('users')}
                    className={`px-4 py-2 text-sm font-medium rounded-lg transition ${tab === 'users' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                    👤 User Management
                    {pendingCount > 0 && <span className="ml-1.5 bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">{pendingCount}</span>}
                </button>
                <button
                    onClick={() => setTab('roles')}
                    className={`px-4 py-2 text-sm font-medium rounded-lg transition ${tab === 'roles' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                    🔐 Role Management
                </button>
            </div>

            {/* ═══════════════════════════════════════════════ */}
            {/* USER MANAGEMENT TAB */}
            {/* ═══════════════════════════════════════════════ */}
            {tab === 'users' && (
                <Card className="border">
                    <CardContent className="p-4 space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-bold text-gray-700">👤 Daftar User</h3>
                            <button
                                onClick={() => { setEditingUser({ username: '', password: '', fullName: '', roleId: roles[0]?.id }); setShowUserForm(true); }}
                                className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 transition"
                            >+ Tambah User</button>
                        </div>

                        {/* Pending approval banner */}
                        {pendingCount > 0 && (
                            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                                ⏳ <strong>{pendingCount} user</strong> menunggu persetujuan registrasi
                            </div>
                        )}

                        {/* User table */}
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead className="bg-gray-50 border-b">
                                    <tr>
                                        <th className="text-left px-3 py-2 text-gray-500">Username</th>
                                        <th className="text-left px-3 py-2 text-gray-500">Nama Lengkap</th>
                                        <th className="text-center px-3 py-2 text-gray-500">Role</th>
                                        <th className="text-center px-3 py-2 text-gray-500">Status</th>
                                        <th className="text-center px-3 py-2 text-gray-500">Aktif</th>
                                        <th className="text-left px-3 py-2 text-gray-500">Dibuat</th>
                                        <th className="text-center px-3 py-2 text-gray-500">Aksi</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {users.length === 0 && (
                                        <tr><td colSpan={7} className="text-center text-gray-400 py-6">Belum ada user terdaftar</td></tr>
                                    )}
                                    {users.map(u => (
                                        <tr key={u.id} className={`border-b hover:bg-gray-50 ${!u.isActive ? 'opacity-40' : ''}`}>
                                            <td className="px-3 py-2 font-medium text-gray-800">{u.username}</td>
                                            <td className="px-3 py-2 text-gray-600">{u.fullName || '-'}</td>
                                            <td className="px-3 py-2 text-center">
                                                <span className="bg-blue-100 text-blue-700 border border-blue-200 text-[10px] px-2 py-0.5 rounded-full">{u.role.name}</span>
                                            </td>
                                            <td className="px-3 py-2 text-center"><StatusBadge status={u.status} /></td>
                                            <td className="px-3 py-2 text-center">
                                                <button onClick={() => handleToggleUser(u)} className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${u.isActive ? 'bg-green-100 text-green-700 border-green-200' : 'bg-gray-100 text-gray-400 border-gray-200'}`}>
                                                    {u.isActive ? 'Aktif' : 'Nonaktif'}
                                                </button>
                                            </td>
                                            <td className="px-3 py-2 text-gray-400">{new Date(u.createdAt).toLocaleDateString('id-ID')}</td>
                                            <td className="px-3 py-2 text-center space-x-1">
                                                {u.status === 'pending' && (
                                                    <>
                                                        <button onClick={() => handleApproveUser(u)} className="text-[10px] px-2 py-0.5 bg-green-600 text-white rounded hover:bg-green-700">✓ Setujui</button>
                                                        <button onClick={() => handleRejectUser(u)} className="text-[10px] px-2 py-0.5 bg-red-500 text-white rounded hover:bg-red-600">✗ Tolak</button>
                                                    </>
                                                )}
                                                <button onClick={() => {
                                                    setEditingUser({ id: u.id, username: u.username, fullName: u.fullName, roleId: u.role.id, password: '' });
                                                    setShowUserForm(true);
                                                }} className="text-blue-600 hover:text-blue-800 text-[10px] font-medium">Edit</button>
                                                <button onClick={() => handleDeleteUser(u.id)} className="text-red-500 hover:text-red-700 text-[10px] font-medium">Hapus</button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* User form */}
                        {showUserForm && editingUser && (
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                                <p className="text-xs font-semibold text-blue-700 mb-3">{editingUser.id ? 'Edit User' : 'Tambah User Baru'}</p>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                    <div>
                                        <label className="text-[10px] text-gray-500 block mb-0.5">Username</label>
                                        <input type="text" value={editingUser.username || ''} onChange={e => setEditingUser(p => ({ ...p!, username: e.target.value }))}
                                            className="w-full text-xs border rounded px-2 py-1.5 bg-white" disabled={!!editingUser.id} />
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-gray-500 block mb-0.5">{editingUser.id ? 'Reset Password' : 'Password'}</label>
                                        <input type="password" value={editingUser.password || ''} onChange={e => setEditingUser(p => ({ ...p!, password: e.target.value }))}
                                            className="w-full text-xs border rounded px-2 py-1.5 bg-white" placeholder={editingUser.id ? 'Kosongkan jika tidak reset' : 'Min 6 karakter'} />
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-gray-500 block mb-0.5">Nama Lengkap</label>
                                        <input type="text" value={editingUser.fullName || ''} onChange={e => setEditingUser(p => ({ ...p!, fullName: e.target.value }))}
                                            className="w-full text-xs border rounded px-2 py-1.5 bg-white" />
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-gray-500 block mb-0.5">Role</label>
                                        <select value={editingUser.roleId || ''} onChange={e => setEditingUser(p => ({ ...p!, roleId: parseInt(e.target.value) }))}
                                            className="w-full text-xs border rounded px-2 py-1.5 bg-white">
                                            {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                                        </select>
                                    </div>
                                </div>
                                <div className="flex gap-2 mt-3">
                                    <button onClick={handleSaveUser} disabled={saving}
                                        className="text-xs bg-blue-600 text-white px-4 py-1.5 rounded hover:bg-blue-700 disabled:opacity-50">
                                        {saving ? 'Menyimpan...' : 'Simpan'}
                                    </button>
                                    <button onClick={() => { setShowUserForm(false); setEditingUser(null); }}
                                        className="text-xs bg-gray-200 text-gray-600 px-4 py-1.5 rounded hover:bg-gray-300">Batal</button>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* ═══════════════════════════════════════════════ */}
            {/* ROLE MANAGEMENT TAB */}
            {/* ═══════════════════════════════════════════════ */}
            {tab === 'roles' && (
                <Card className="border">
                    <CardContent className="p-4 space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-bold text-gray-700">🔐 Daftar Role</h3>
                            <button
                                onClick={() => { setEditingRole({ name: '', description: '', allowedMenus: [], hiddenColumns: [], isDefault: false }); setShowRoleForm(true); }}
                                className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 transition"
                            >+ Tambah Role</button>
                        </div>

                        {/* Roles grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                            {roles.map(role => (
                                <div key={role.id} className="border rounded-lg p-3 bg-white hover:shadow-sm transition">
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-bold text-gray-800">🔑 {role.name}</span>
                                            {role.isDefault && <span className="text-[9px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded">Default</span>}
                                        </div>
                                        <span className="text-[10px] text-gray-400">{role._count?.users || 0} users</span>
                                    </div>
                                    {role.description && <p className="text-[10px] text-gray-500 mb-2">{role.description}</p>}

                                    <div className="mb-2">
                                        <p className="text-[9px] text-gray-400 font-semibold mb-1">MENU AKSES ({(role.allowedMenus as string[]).length}/{menuRegistry.length})</p>
                                        <div className="flex flex-wrap gap-1">
                                            {(role.allowedMenus as string[]).slice(0, 6).map(m => {
                                                const reg = menuRegistry.find(r => r.id === m);
                                                return <span key={m} className="text-[9px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{reg?.icon} {reg?.label || m}</span>;
                                            })}
                                            {(role.allowedMenus as string[]).length > 6 && <span className="text-[9px] text-gray-400">+{(role.allowedMenus as string[]).length - 6} lainnya</span>}
                                        </div>
                                    </div>

                                    {(role.hiddenColumns as string[]).length > 0 && (
                                        <div className="mb-2">
                                            <p className="text-[9px] text-gray-400 font-semibold mb-1">DATA TERSEMBUNYI</p>
                                            <div className="flex flex-wrap gap-1">
                                                {(role.hiddenColumns as string[]).map(c => {
                                                    const reg = columnRegistry.find(r => r.id === c);
                                                    return <span key={c} className="text-[9px] bg-red-50 text-red-600 px-1.5 py-0.5 rounded">🔒 {reg?.label || c}</span>;
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    <div className="flex gap-2 mt-2 pt-2 border-t">
                                        <button onClick={() => { setEditingRole(role); setShowRoleForm(true); }}
                                            className="text-[10px] text-blue-600 hover:text-blue-800 font-medium">Edit</button>
                                        <button onClick={() => handleDeleteRole(role.id)}
                                            className="text-[10px] text-red-500 hover:text-red-700 font-medium">Hapus</button>
                                    </div>
                                </div>
                            ))}
                            {roles.length === 0 && (
                                <div className="col-span-full text-center text-gray-400 py-8 text-sm">
                                    Belum ada role. Klik "+ Tambah Role" untuk membuat.
                                </div>
                            )}
                        </div>

                        {/* Role edit form */}
                        {showRoleForm && editingRole && (
                            <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
                                <p className="text-xs font-semibold text-indigo-700 mb-3">{editingRole.id ? `Edit Role: ${editingRole.name}` : 'Tambah Role Baru'}</p>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                                    <div>
                                        <label className="text-[10px] text-gray-500 block mb-0.5">Nama Role</label>
                                        <input type="text" value={editingRole.name || ''} onChange={e => setEditingRole(p => ({ ...p!, name: e.target.value }))}
                                            className="w-full text-xs border rounded px-2 py-1.5 bg-white" placeholder="Staff" />
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-gray-500 block mb-0.5">Deskripsi</label>
                                        <input type="text" value={editingRole.description || ''} onChange={e => setEditingRole(p => ({ ...p!, description: e.target.value }))}
                                            className="w-full text-xs border rounded px-2 py-1.5 bg-white" placeholder="Role untuk staff gudang" />
                                    </div>
                                    <div className="flex items-end">
                                        <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                                            <input type="checkbox" checked={editingRole.isDefault || false}
                                                onChange={e => setEditingRole(p => ({ ...p!, isDefault: e.target.checked }))}
                                                className="rounded" />
                                            Default role untuk user baru
                                        </label>
                                    </div>
                                </div>

                                {/* Menu access checkboxes */}
                                <div className="mb-4">
                                    <div className="flex items-center justify-between mb-2">
                                        <p className="text-[10px] text-gray-500 font-semibold">📋 MENU YANG BISA DIAKSES</p>
                                        <div className="flex gap-2">
                                            <button onClick={selectAllMenus} className="text-[9px] text-blue-600 hover:underline">Pilih Semua</button>
                                            <button onClick={clearAllMenus} className="text-[9px] text-red-500 hover:underline">Hapus Semua</button>
                                        </div>
                                    </div>
                                    {/* Group by category */}
                                    {['Inventory', 'Sales', 'Logistics', 'Admin'].map(cat => (
                                        <div key={cat} className="mb-2">
                                            <p className="text-[9px] text-gray-400 font-semibold uppercase mb-1">{cat}</p>
                                            <div className="flex flex-wrap gap-2">
                                                {menuRegistry.filter(m => m.category === cat).map(m => (
                                                    <label key={m.id} className="flex items-center gap-1.5 text-[11px] cursor-pointer bg-white border rounded px-2 py-1 hover:bg-blue-50">
                                                        <input type="checkbox"
                                                            checked={(editingRole.allowedMenus || []).includes(m.id)}
                                                            onChange={() => toggleMenu(m.id)}
                                                            className="rounded h-3 w-3" />
                                                        <span>{m.icon} {m.label}</span>
                                                    </label>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {/* Hidden columns checkboxes */}
                                <div className="mb-4">
                                    <p className="text-[10px] text-gray-500 font-semibold mb-2">🔒 DATA YANG DISEMBUNYIKAN (kolom yang di-hide untuk role ini)</p>
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                        {columnRegistry.map(col => (
                                            <label key={col.id} className="flex items-start gap-2 text-[11px] cursor-pointer bg-white border rounded px-2 py-1.5 hover:bg-red-50">
                                                <input type="checkbox"
                                                    checked={(editingRole.hiddenColumns || []).includes(col.id)}
                                                    onChange={() => toggleColumn(col.id)}
                                                    className="rounded h-3 w-3 mt-0.5 text-red-600" />
                                                <div>
                                                    <span className="font-medium text-gray-700">🔒 {col.label}</span>
                                                    <p className="text-[9px] text-gray-400">{col.description}</p>
                                                </div>
                                            </label>
                                        ))}
                                    </div>
                                </div>

                                <div className="flex gap-2">
                                    <button onClick={handleSaveRole} disabled={saving}
                                        className="text-xs bg-indigo-600 text-white px-4 py-1.5 rounded hover:bg-indigo-700 disabled:opacity-50">
                                        {saving ? 'Menyimpan...' : 'Simpan Role'}
                                    </button>
                                    <button onClick={() => { setShowRoleForm(false); setEditingRole(null); }}
                                        className="text-xs bg-gray-200 text-gray-600 px-4 py-1.5 rounded hover:bg-gray-300">Batal</button>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}
        </div>
    );
};
