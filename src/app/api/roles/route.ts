export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySessionToken, SESSION_COOKIE_NAME, ALL_MENUS, ALL_DATA_COLUMNS } from '@/lib/auth';

function isAdmin(request: NextRequest): boolean {
    const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (!token) return false;
    const session = verifySessionToken(token);
    if (!session) return false;
    return session.isSuperAdmin || session.roleName === 'Admin';
}

// GET: List all roles + menu/column registry
export async function GET(request: NextRequest) {
    if (!isAdmin(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }
    try {
        const roles = await prisma.appRole.findMany({
            orderBy: { id: 'asc' },
            include: { _count: { select: { users: true } } },
        });
        return NextResponse.json({
            roles,
            menuRegistry: ALL_MENUS,
            columnRegistry: ALL_DATA_COLUMNS,
        });
    } catch (err: any) {
        // Fallback if DB not available
        return NextResponse.json({
            roles: [],
            menuRegistry: ALL_MENUS,
            columnRegistry: ALL_DATA_COLUMNS,
            fallback: true,
        });
    }
}

// POST: Create a new role
export async function POST(request: NextRequest) {
    if (!isAdmin(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }
    try {
        const body = await request.json();
        const { name, description, allowedMenus, hiddenColumns, isDefault } = body;

        if (!name) {
            return NextResponse.json({ error: 'Nama role wajib diisi' }, { status: 400 });
        }

        // If setting as default, unset other defaults
        if (isDefault) {
            await prisma.appRole.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
        }

        const role = await prisma.appRole.create({
            data: {
                name: name.trim(),
                description: description?.trim() || null,
                allowedMenus: allowedMenus || [],
                hiddenColumns: hiddenColumns || [],
                isDefault: isDefault || false,
            },
        });

        return NextResponse.json({ role, message: `Role "${role.name}" berhasil dibuat` });
    } catch (err: any) {
        if (err.code === 'P2002') {
            return NextResponse.json({ error: 'Nama role sudah ada' }, { status: 409 });
        }
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

// PUT: Update a role
export async function PUT(request: NextRequest) {
    if (!isAdmin(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }
    try {
        const body = await request.json();
        const { id, name, description, allowedMenus, hiddenColumns, isDefault } = body;

        if (!id) return NextResponse.json({ error: 'ID wajib' }, { status: 400 });

        if (isDefault) {
            await prisma.appRole.updateMany({ where: { isDefault: true, id: { not: id } }, data: { isDefault: false } });
        }

        const role = await prisma.appRole.update({
            where: { id: parseInt(id) },
            data: {
                ...(name !== undefined && { name: name.trim() }),
                ...(description !== undefined && { description: description?.trim() || null }),
                ...(allowedMenus !== undefined && { allowedMenus }),
                ...(hiddenColumns !== undefined && { hiddenColumns }),
                ...(isDefault !== undefined && { isDefault }),
            },
        });

        return NextResponse.json({ role, message: `Role "${role.name}" berhasil diupdate` });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

// DELETE: Remove a role
export async function DELETE(request: NextRequest) {
    if (!isAdmin(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');
        if (!id) return NextResponse.json({ error: 'ID wajib' }, { status: 400 });

        // Check if role has users
        const userCount = await prisma.appUser.count({ where: { roleId: parseInt(id) } });
        if (userCount > 0) {
            return NextResponse.json({ error: `Role masih digunakan oleh ${userCount} user` }, { status: 400 });
        }

        await prisma.appRole.delete({ where: { id: parseInt(id) } });
        return NextResponse.json({ message: 'Role berhasil dihapus' });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
