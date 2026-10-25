import { NextRequest, NextResponse } from 'next/server';
import { allowedRequest, backendRequest, clearSessionCookie, privateHeaders, sessionToken } from '@/lib/server/auth';

export async function POST(request: NextRequest) {
  if (!allowedRequest(request)) return new NextResponse(null, { status: 403, headers: privateHeaders });
  const token = await sessionToken();
  if (token) {
    try {
      const all = request.nextUrl.searchParams.get('all') === 'true';
      const upstream = await backendRequest(`/auth/session/logout?all_devices=${all}`, { method: 'POST' }, token);
      if (!upstream.ok && upstream.status !== 401) throw new Error('Sign-out failed');
    } catch {
      return NextResponse.json({ detail: 'Could not sign out. Please try again.' }, { status: 503, headers: privateHeaders });
    }
  }
  const response = NextResponse.json({ signed_out: true }, { headers: privateHeaders });
  clearSessionCookie(response);
  return response;
}
