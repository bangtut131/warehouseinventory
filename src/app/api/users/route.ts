export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySessionToken, SESSION_COOKIE_NAME, hashPassword } from '@/lib/auth';

function isAdmin(request: NextRequest): boolean {
    const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (!token) return false;
    const session = verifySessionToken(token);
    if (!session) return false;
    return session.isSuperAdmin || session.roleName === 'Admin';
}

// GET: List all users
export async function GET(request: NextRequest) {
    if (!isAdmin(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }
    try {
        const users = await prisma.appUser.findMany({
            orderBy: { createdAt: 'desc' },
            include: { role: { select: { id: true, name: true } } },
            select: {
                id: true,
                username: true,
                fullName: true,
                status: true,
                isActive: true,
                createdAt: true,
                updatedAt: true,
                role: { select: { id: true, name: true } },
            },
        });
        return NextResponse.json({ users });
    } catch (err: any) {
        return NextResponse.json({ users: [], fallback: true });
    }
}

// POST: Create a new user (admin-created, auto-approved)
export async function POST(request: NextRequest) {
    if (!isAdmin(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }
    try {
        const { username, password, fullName, roleId } = await request.json();

        if (!username || !password || !roleId) {
            return NextResponse.json({ error: 'Username, password, dan role wajib diisi' }, { status: 400 });
        }

        if (password.length < 6) {
            return NextResponse.json({ error: 'Password minimal 6 karakter' }, { status: 400 });
        }

        const hashed = await hashPassword(password);

        const user = await prisma.appUser.create({
            data: {
                username: username.trim().toLowerCase(),
                password: hashed,
                fullName: fullName?.trim() || null,
                roleId: parseInt(roleId),
                status: 'approved', // admin-created users are auto-approved
            },
        });

        return NextResponse.json({ user: { id: user.id, username: user.username }, message: `User "${user.username}" berhasil dibuat` });
    } catch (err: any) {
        if (err.code === 'P2002') {
            return NextResponse.json({ error: 'Username sudah terdaftar' }, { status: 409 });
        }
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

// PUT: Update user (approve, reject, change role, reset password)
export async function PUT(request: NextRequest) {
    if (!isAdmin(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }
    try {
        const body = await request.json();
        const { id, status, roleId, fullName, password, isActive } = body;

        if (!id) return NextResponse.json({ error: 'ID wajib' }, { status: 400 });

        const data: any = {};
        if (status !== undefined) data.status = status;
        if (roleId !== undefined) data.roleId = parseInt(roleId);
        if (fullName !== undefined) data.fullName = fullName?.trim() || null;
        if (isActive !== undefined) data.isActive = isActive;
        if (password) data.password = await hashPassword(password);

        const user = await prisma.appUser.update({
            where: { id: parseInt(id) },
            data,
            include: { role: { select: { name: true } } },
        });

        return NextResponse.json({ user: { id: user.id, username: user.username, status: user.status }, message: 'User berhasil diupdate' });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

// DELETE: Remove a user
export async function DELETE(request: NextRequest) {
    if (!isAdmin(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');
        if (!id) return NextResponse.json({ error: 'ID wajib' }, { status: 400 });

        await prisma.appUser.delete({ where: { id: parseInt(id) } });
        return NextResponse.json({ message: 'User berhasil dihapus' });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
