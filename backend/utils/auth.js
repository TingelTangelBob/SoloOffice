import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(crypto.scrypt);

export const SESSION_COOKIE = 'solooffice_session';
export const CSRF_COOKIE = 'solooffice_csrf';
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const INVITATION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const AUTH_ROLES = new Set(['owner', 'admin', 'member', 'viewer']);

function secureCookies() {
  return process.env.COOKIE_SECURE === 'true';
}

function cookieSameSite() {
  return process.env.COOKIE_SAME_SITE || 'lax';
}

export function normaliseEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function validatePassword(value) {
  if (typeof value !== 'string' || value.length < 10 || value.length > 200) {
    return 'Das Passwort muss zwischen 10 und 200 Zeichen enthalten.';
  }
  return null;
}

export function createOpaqueToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashOpaqueToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derivedKey = await scryptAsync(password, salt, 64, {
    N: 16_384,
    r: 8,
    p: 1,
  });
  return `scrypt$${salt.toString('base64')}$${Buffer.from(derivedKey).toString('base64')}`;
}

export async function verifyPassword(password, storedHash) {
  if (typeof storedHash !== 'string' || !storedHash.startsWith('scrypt$')) return false;
  const [, saltValue, hashValue] = storedHash.split('$');
  if (!saltValue || !hashValue) return false;

  try {
    const expected = Buffer.from(hashValue, 'base64');
    const actual = Buffer.from(await scryptAsync(password, Buffer.from(saltValue, 'base64'), expected.length, {
      N: 16_384,
      r: 8,
      p: 1,
    }));
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function parseCookies(header = '') {
  return header.split(';').reduce((cookies, part) => {
    const separator = part.indexOf('=');
    if (separator <= 0) return cookies;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

export function cookieOptions(maxAge) {
  return {
    httpOnly: true,
    sameSite: cookieSameSite(),
    secure: secureCookies(),
    path: '/',
    maxAge,
  };
}

export function clearCookieOptions() {
  return {
    httpOnly: true,
    sameSite: cookieSameSite(),
    secure: secureCookies(),
    path: '/',
  };
}

export function createWorkspaceSlug(name) {
  const slug = String(name || 'workspace')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return `${slug || 'workspace'}-${crypto.randomBytes(3).toString('hex')}`;
}

export function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name || '',
    lastName: row.last_name || '',
    displayName: [row.first_name, row.last_name].filter(Boolean).join(' ') || row.email,
    createdAt: row.created_at,
  };
}

export function publicWorkspace(row, role) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    role,
    createdAt: row.created_at,
  };
}
