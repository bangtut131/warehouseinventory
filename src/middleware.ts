import { NextRequest, NextResponse } from 'next/server';

const SESSION_COOKIE_NAME = 'inventory-session';

// Routes that don't require authentication
const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/auth/logout'];

export function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // Allow public paths
    if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
        return NextResponse.next();
    }

    // Allow static assets and Next.js internals
    if (
        pathname.startsWith('/_next') ||
        pathname.startsWith('/favicon') ||
        pathname.endsWith('.ico') ||
        pathname.endsWith('.png') ||
        pathname.endsWith('.svg')
    ) {
        return NextResponse.next();
    }

    // Check session cookie
    const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;

    if (!token) {
        // No token — redirect to login for page requests, return 401 for API
        if (pathname.startsWith('/api/')) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        return NextResponse.redirect(new URL('/login', request.url));
    }

    // Basic token structure validation (full crypto verification happens server-side)
    const parts = token.split('.');
    if (parts.length !== 2) {
        if (pathname.startsWith('/api/')) {
            return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
        }
        return NextResponse.redirect(new URL('/login', request.url));
    }

    // Token exists and has valid structure — allow through
    // Full verification with HMAC check happens in API routes if needed
    return NextResponse.next();
}

export const config = {
    matcher: [
        // Match all routes except static files
        '/((?!_next/static|_next/image|favicon.ico).*)',
    ],
};
