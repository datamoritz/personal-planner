import { createHash, randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { allowedRequest, appOrigin, backendRequest, cookieOptions, LOGIN_COOKIE, privateHeaders } from '@/lib/server/auth';

export async function POST(request: NextRequest) {
  if (!allowedRequest(request)) return NextResponse.json({ detail: 'Sign-in must start from Planner. Reload the sign-in page and try again.' }, { status: 403, headers: privateHeaders });
  const verifier = randomBytes(48).toString('base64url');
  try {
    const response = await backendRequest('/auth/session/start', { method: 'POST', body: JSON.stringify({
      browser_challenge: createHash('sha256').update(verifier).digest('hex'), frontend_origin: appOrigin(),
    }) });
    if (!response.ok) throw new Error('Sign-in unavailable');
    const { url } = await response.json() as { url: string };
    const destination = new URL(url);
    if (destination.protocol !== 'https:' || destination.hostname !== 'accounts.google.com') throw new Error('Invalid sign-in destination');
    const result = NextResponse.redirect(destination, 303);
    result.cookies.set(LOGIN_COOKIE, verifier, { ...cookieOptions, maxAge: 600 });
    for (const [key, value] of Object.entries(privateHeaders)) result.headers.set(key, value);
    return result;
  } catch {
    return NextResponse.redirect(`${appOrigin()}/login?error=unavailable`, 303);
  }
}
