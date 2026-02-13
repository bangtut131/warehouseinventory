export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/lib/auth';

export async function POST() {
    const response = NextResponse.json({ success: true, message: 'Logout berhasil' });
    response.cookies.set(SESSION_COOKIE_NAME, '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 0, // expire immediately
        path: '/',
    });
    return response;
}
