import { NextResponse } from 'next/server';
import { privateHeaders, validSession } from '@/lib/server/auth';

export async function GET() {
  try {
    const valid = await validSession();
    return NextResponse.json({ authenticated: valid }, { status: valid ? 200 : 401, headers: privateHeaders });
  } catch {
    return NextResponse.json({ detail: 'Could not verify access' }, { status: 503, headers: privateHeaders });
  }
}
