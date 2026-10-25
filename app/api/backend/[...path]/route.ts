import { NextRequest, NextResponse } from 'next/server';
import { allowedRequest, appOrigin, backendRequest, privateHeaders, sessionToken } from '@/lib/server/auth';

const resources = new Set(['tasks', 'projects', 'planner', 'goals', 'milestones', 'tags', 'recurrent-tasks', 'generate-recurring-tasks', 'google', 'apple-birthdays', 'email', 'ai', 'media', 'workload', 'mandala', 'notepad']);
type Context = { params: Promise<{ path: string[] }> };

async function handle(request: NextRequest, context: Context) {
  const { path } = await context.params;
  const reconnect = path.join('/') === 'auth/google/login' && request.method === 'GET';
  if ((!resources.has(path[0]) && !reconnect) || path.some(segment => !segment || segment === '.' || segment === '..' || /[\\/%?#]/.test(segment))) {
    return new NextResponse(null, { status: 404, headers: privateHeaders });
  }
  if ((request.method !== 'GET' || reconnect) && !allowedRequest(request)
      && !(reconnect && request.headers.get('sec-fetch-site') === 'same-origin')) {
    return new NextResponse(null, { status: 403, headers: privateHeaders });
  }
  const token = await sessionToken();
  if (!token) return NextResponse.json({ detail: 'Sign in to Planner' }, { status: 401, headers: { ...privateHeaders, 'X-Planner-Auth': 'required' } });
  try {
    if (Number(request.headers.get('content-length') || 0) > 2_000_000) return new NextResponse(null, { status: 413, headers: privateHeaders });
    const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text();
    if (body && Buffer.byteLength(body) > 2_000_000) return new NextResponse(null, { status: 413, headers: privateHeaders });
    const search = reconnect ? `?return_to=${encodeURIComponent(appOrigin())}` : request.nextUrl.search;
    const response = await backendRequest(`/${path.map(encodeURIComponent).join('/')}${search}`, { method: request.method, body }, token);
    if (reconnect && response.status === 307) {
      const location = new URL(response.headers.get('location') || '');
      if (location.protocol !== 'https:' || location.hostname !== 'accounts.google.com') throw new Error('Invalid redirect');
      return NextResponse.redirect(location, { status: 303, headers: privateHeaders });
    }
    // Never pass backend cookies, credentials, or arbitrary redirect headers to clients.
    if (response.status >= 300 && response.status < 400) throw new Error('Unexpected redirect');
    return new NextResponse(response.status === 204 ? null : response.body, {
      status: response.status,
      headers: { ...privateHeaders, 'Content-Type': response.headers.get('content-type') || 'application/json', 'X-Content-Type-Options': 'nosniff',
        ...(response.headers.get('x-planner-auth') === 'required' ? { 'X-Planner-Auth': 'required' } : {}),
      },
    });
  } catch {
    return NextResponse.json({ detail: 'Planner is temporarily unavailable' }, { status: 503, headers: privateHeaders });
  }
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
