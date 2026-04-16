export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/auth';

export async function GET(request: NextRequest) {
    try {
        const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
        if (!token) {
            return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
        }

        const session = verifySessionToken(token);
        if (!session) {
            return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
        }

        return NextResponse.json({
            username: session.username,
            fullName: session.fullName,
            roleId: session.roleId,
            roleName: session.roleName,
            allowedMenus: session.allowedMenus,
            hiddenColumns: session.hiddenColumns,
            isSuperAdmin: session.isSuperAdmin,
        });
    } catch {
        return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }
}
