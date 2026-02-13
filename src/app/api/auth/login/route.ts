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

        if (!validateCredentials(username, password)) {
            return NextResponse.json(
                { error: 'Username atau password salah' },
                { status: 401 }
            );
        }

        // Create session token
        const token = createSessionToken(username);

        // Set cookie
        const response = NextResponse.json({ success: true, message: 'Login berhasil' });
        response.cookies.set(SESSION_COOKIE_NAME, token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 24 * 60 * 60, // 24 hours in seconds
            path: '/',
        });

        return response;
    } catch (err: any) {
        return NextResponse.json({ error: 'Terjadi kesalahan' }, { status: 500 });
    }
}
