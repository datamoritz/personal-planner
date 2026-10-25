import 'server-only';

import { cookies } from 'next/headers';
import type { NextRequest, NextResponse } from 'next/server';

export const secureCookies = process.env.NODE_ENV === 'production';
export const SESSION_COOKIE = secureCookies ? '__Host-planner-session' : 'planner-session';
export const LOGIN_COOKIE = secureCookies ? '__Host-planner-login' : 'planner-login';
export const cookieOptions = { httpOnly: true, secure: secureCookies, sameSite: 'lax' as const, path: '/' };
export const privateHeaders = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };

export function appOrigin() {
  return process.env.PLANNER_APP_ORIGIN || (secureCookies ? 'https://personal-planner-sooty.vercel.app' : 'http://127.0.0.1:3107');
}

export function allowedRequest(request: NextRequest) {
  const origin = request.headers.get('origin');
  return origin === appOrigin() && request.headers.get('sec-fetch-site') !== 'cross-site';
}

export async function sessionToken() {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function backendRequest(path: string, options: RequestInit = {}, token?: string) {
  const secret = process.env.PLANNER_GATEWAY_SECRET;
  if (!secret) throw new Error('Private access is not configured');
  const base = process.env.PLANNER_BACKEND_URL || 'https://planner-api.moritzknodler.com';
  const headers = new Headers({ 'Content-Type': 'application/json', 'X-Planner-Gateway': secret });
  if (token) headers.set('X-Planner-Session', token);
  return fetch(`${base}${path}`, { ...options, headers, cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(60000) });
}

export async function validSession() {
  const token = await sessionToken();
  if (!token) return false;
  const response = await backendRequest('/auth/session/current', {}, token);
  if (response.status === 401) return false;
  if (!response.ok) throw new Error('Could not verify access');
  return true;
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, '', { ...cookieOptions, maxAge: 0 });
}
