import { NextRequest, NextResponse } from 'next/server';
import { appOrigin, backendRequest, cookieOptions, LOGIN_COOKIE, privateHeaders, SESSION_COOKIE } from '@/lib/server/auth';

export async function GET(request: NextRequest) {
  const verifier = request.cookies.get(LOGIN_COOKIE)?.value;
  const code = request.nextUrl.searchParams.get('code');
  let result = NextResponse.redirect(`${appOrigin()}/login?error=signin`, 303);
  if (verifier && code && code.length <= 256) {
    try {
      const response = await backendRequest('/auth/session/exchange', { method: 'POST', body: JSON.stringify({ code, verifier }) });
      if (response.ok) {
        const { token, expires_at } = await response.json() as { token: string; expires_at: string };
        result = NextResponse.redirect(`${appOrigin()}/`, 303);
        result.cookies.set(SESSION_COOKIE, token, { ...cookieOptions, expires: new Date(expires_at) });
      }
    } catch { /* Keep the login screen on a failed or interrupted exchange. */ }
  }
  result.cookies.set(LOGIN_COOKIE, '', { ...cookieOptions, maxAge: 0 });
  for (const [key, value] of Object.entries(privateHeaders)) result.headers.set(key, value);
  return result;
}
