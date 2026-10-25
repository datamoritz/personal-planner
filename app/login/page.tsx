import Link from 'next/link';
import { redirect } from 'next/navigation';
import { validSession } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign in | Planner', robots: { index: false, follow: false } };

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  let signedIn = false;
  try { signedIn = await validSession(); } catch { /* The login page remains usable during outages. */ }
  if (signedIn) redirect('/');
  const { error } = await searchParams;
  return (
    <main data-theme="light" className="flex h-dvh items-center justify-center overflow-auto bg-[#f2f3f7] p-6 text-[#202434]">
      <div className="w-full max-w-sm rounded-3xl border border-[#e0e4ee] bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold tracking-widest text-[#68728b]">PLANNER</p>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">Your private planner</h1>
        <p className="mt-3 text-sm leading-6 text-[#68728b]">Sign in with your allowed Google account. This device will remember you between visits.</p>
        {error && <p role="alert" className="mt-4 text-sm leading-6 text-[#a43c36]">{error === 'unavailable' ? 'Sign-in is temporarily unavailable. Please try again.' : 'Sign-in could not be completed. Use your allowed Google account and try again.'}</p>}
        <form action="/api/auth/start" method="post" className="mt-6">
          <button className="min-h-11 w-full rounded-xl bg-[#5865d9] px-4 py-3 text-sm font-semibold text-white hover:bg-[#4854bf] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#5865d9]">Continue with Google</button>
        </form>
        <nav aria-label="About and privacy" className="mt-6 flex justify-center gap-3 text-xs text-[#68728b]">
          <Link href="/about">About</Link><span aria-hidden="true">·</span><Link href="/privacy">Privacy</Link>
        </nav>
      </div>
    </main>
  );
}
