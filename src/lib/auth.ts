import crypto from 'crypto';

// Auth credentials from environment variables
const AUTH_USERNAME = process.env.AUTH_USERNAME || 'admin';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || 'admin123';

// Session token secret — used to sign/verify tokens
const TOKEN_SECRET = process.env.AUTH_TOKEN_SECRET || 'inventory-warehouse-secret-key-2025';
const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

export const SESSION_COOKIE_NAME = 'inventory-session';

export interface SessionPayload {
    username: string;
    exp: number; // expiration timestamp
}

/**
 * Validate login credentials against environment variables
 */
export function validateCredentials(username: string, password: string): boolean {
    return username === AUTH_USERNAME && password === AUTH_PASSWORD;
}

/**
 * Create a signed session token
 */
export function createSessionToken(username: string): string {
    const payload: SessionPayload = {
        username,
        exp: Date.now() + TOKEN_EXPIRY_MS,
    };
    const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
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

        // Verify signature
        const expectedSig = crypto.createHmac('sha256', TOKEN_SECRET).update(data).digest('base64url');
        if (signature !== expectedSig) return null;

        // Decode payload
        const payload: SessionPayload = JSON.parse(Buffer.from(data, 'base64url').toString());

        // Check expiry
        if (Date.now() > payload.exp) return null;

        return payload;
    } catch {
        return null;
    }
}
