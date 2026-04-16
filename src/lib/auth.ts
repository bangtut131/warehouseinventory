import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { ALL_MENUS, ALL_DATA_COLUMNS, ALL_BUTTONS } from '@/lib/menu-constants';

// Re-export for backward compatibility
export { ALL_MENUS, ALL_DATA_COLUMNS, ALL_BUTTONS };

// Auth credentials from environment variables (superadmin fallback)
const AUTH_USERNAME = process.env.AUTH_USERNAME || 'admin';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || 'admin123';

// Session token secret
const TOKEN_SECRET = process.env.AUTH_TOKEN_SECRET || 'inventory-warehouse-secret-key-2025';
const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

export const SESSION_COOKIE_NAME = 'inventory-session';

export interface SessionPayload {
    username: string;
    fullName?: string;
    roleId: number;
    roleName: string;
    allowedMenus: string[];
    hiddenColumns: string[];
    isSuperAdmin: boolean;
    exp: number;
}

/**
 * Validate login — check DB users first, then env fallback for superadmin
 */
export async function validateCredentials(username: string, password: string): Promise<{
    valid: boolean;
    payload?: Omit<SessionPayload, 'exp'>;
}> {
    // 1. Check DB users first
    try {
        const user = await prisma.appUser.findUnique({
            where: { username },
            include: { role: true },
        });

        if (user && user.isActive && user.status === 'approved') {
            const passwordMatch = await bcrypt.compare(password, user.password);
            if (passwordMatch) {
                return {
                    valid: true,
                    payload: {
                        username: user.username,
                        fullName: user.fullName || undefined,
                        roleId: user.role.id,
                        roleName: user.role.name,
                        allowedMenus: (user.role.allowedMenus as string[]) || [],
                        hiddenColumns: (user.role.hiddenColumns as string[]) || [],
                        isSuperAdmin: false,
                    },
                };
            }
        }

        if (user && user.status === 'pending') {
            return { valid: false }; // pending approval
        }
    } catch (e) {
        // DB might not be available, fall through to env check
        console.warn('[Auth] DB check failed:', (e as any).message);
    }

    // 2. Fallback: check env-based superadmin
    if (username === AUTH_USERNAME && password === AUTH_PASSWORD) {
        return {
            valid: true,
            payload: {
                username,
                fullName: 'Administrator',
                roleId: 0,
                roleName: 'Superadmin',
                allowedMenus: [...ALL_MENUS.map(m => m.id), ...ALL_BUTTONS.map(b => b.id)],
                hiddenColumns: [],
                isSuperAdmin: true,
            },
        };
    }

    return { valid: false };
}

/**
 * Create a signed session token
 */
export function createSessionToken(payload: Omit<SessionPayload, 'exp'>): string {
    const full: SessionPayload = {
        ...payload,
        exp: Date.now() + TOKEN_EXPIRY_MS,
    };
    const data = Buffer.from(JSON.stringify(full)).toString('base64url');
    const signature = crypto.createHmac('sha256', TOKEN_SECRET).update(data).digest('base64url');
    return `${data}.${signature}`;
}

/**
 * Verify and decode a session token
 */
export function verifySessionToken(token: string): SessionPayload | null {
    try {
        const [data, signature] = token.split('.');
        if (!data || !signature) return null;

        const expectedSig = crypto.createHmac('sha256', TOKEN_SECRET).update(data).digest('base64url');
        if (signature !== expectedSig) return null;

        const payload: SessionPayload = JSON.parse(Buffer.from(data, 'base64url').toString());
        if (Date.now() > payload.exp) return null;

        return payload;
    } catch {
        return null;
    }
}

/**
 * Hash a password
 */
export async function hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
}
