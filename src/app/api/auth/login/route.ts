export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { validateCredentials, createSessionToken, SESSION_COOKIE_NAME } from '@/lib/auth';

export async function POST(request: NextRequest) {
    try {
        const { username, password } = await request.json();

        if (!username || !password) {
            return NextResponse.json(
                { error: 'Username dan password harus diisi' },
                { status: 400 }
            );
        }

        const result = await validateCredentials(username, password);

        if (!result.valid || !result.payload) {
            return NextResponse.json(
                { error: 'Username atau password salah, atau akun belum disetujui' },
                { status: 401 }
            );
        }

        // Create session token with role info
        const token = createSessionToken(result.payload);

        // Set cookie
        const response = NextResponse.json({
            success: true,
            message: 'Login berhasil',
            user: {
                username: result.payload.username,
                fullName: result.payload.fullName,
                roleName: result.payload.roleName,
                isSuperAdmin: result.payload.isSuperAdmin,
            },
        });
        response.cookies.set(SESSION_COOKIE_NAME, token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 24 * 60 * 60,
            path: '/',
        });

        return response;
    } catch (err: any) {
        return NextResponse.json({ error: 'Terjadi kesalahan' }, { status: 500 });
    }
}
