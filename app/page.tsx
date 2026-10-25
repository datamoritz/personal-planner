import { PlannerApp } from '@/components/PlannerApp';
import { PrivateSession } from '@/components/PrivateSession';
import { validSession } from '@/lib/server/auth';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function Page() {
  let allowed = false;
  try { allowed = await validSession(); } catch { redirect('/login?error=unavailable'); }
  if (!allowed) redirect('/login');
  return <PrivateSession><PlannerApp /></PrivateSession>;
}
