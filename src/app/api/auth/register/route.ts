export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth';

export async function POST(request: NextRequest) {
    try {
        const { username, password, fullName } = await request.json();

        if (!username || !password) {
            return NextResponse.json({ error: 'Username dan password wajib diisi' }, { status: 400 });
        }

        if (password.length < 6) {
            return NextResponse.json({ error: 'Password minimal 6 karakter' }, { status: 400 });
        }

        // Check if username already exists
        const existing = await prisma.appUser.findUnique({ where: { username } });
        if (existing) {
            return NextResponse.json({ error: 'Username sudah terdaftar' }, { status: 409 });
        }

        // Find default role (or first role)
        let defaultRole = await prisma.appRole.findFirst({ where: { isDefault: true } });
        if (!defaultRole) {
            // Auto-create default Staff role if no roles exist
            const roleCount = await prisma.appRole.count();
            if (roleCount === 0) {
                defaultRole = await prisma.appRole.create({
                    data: {
                        name: 'Staff',
                        description: 'Default role untuk user baru',
                        allowedMenus: ['dashboard', 'so', 'routing', 'regional', 'sla'],
                        hiddenColumns: ['col:value', 'col:cost', 'col:margin'],
                        isDefault: true,
                    },
                });
            } else {
                defaultRole = await prisma.appRole.findFirst({ orderBy: { id: 'asc' } });
            }
        }

        if (!defaultRole) {
            return NextResponse.json({ error: 'Tidak ada role tersedia. Hubungi admin.' }, { status: 500 });
        }

        const hashed = await hashPassword(password);

        const user = await prisma.appUser.create({
            data: {
                username: username.trim().toLowerCase(),
                password: hashed,
                fullName: fullName?.trim() || null,
                roleId: defaultRole.id,
                status: 'pending', // needs admin approval
            },
        });

        return NextResponse.json({
            success: true,
            message: 'Registrasi berhasil! Menunggu persetujuan admin.',
            user: { username: user.username, fullName: user.fullName, status: user.status },
        });
    } catch (err: any) {
        console.error('[Register] Error:', err.message);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
