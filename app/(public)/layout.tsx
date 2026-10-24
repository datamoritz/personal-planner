import type { Viewport } from 'next';
import Link from 'next/link';
import { CalendarDays } from 'lucide-react';
import { plannerPublicDetails } from '@/lib/publicSite';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
};

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-theme="light" className="h-dvh overflow-y-auto bg-[#f5f6fa] text-[#202434] selection:bg-[#e3e6ff]">
      <a href="#page-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-3">
        Skip to content
      </a>
      <header className="border-b border-[#e2e5ee] bg-white/80">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-5 gap-y-3 px-5 py-5 sm:px-8">
          <Link href="/about" className="flex items-center gap-2.5 text-[15px] font-semibold tracking-tight">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#eceeff] text-[#5d6df4]">
              <CalendarDays size={17} strokeWidth={1.8} aria-hidden="true" />
            </span>
            {plannerPublicDetails.name}
          </Link>
          <nav aria-label="Public pages" className="flex items-center gap-4 text-[13px] sm:gap-6">
            <Link href="/about" className="text-[#55607a] transition-colors hover:text-[#202434]">About</Link>
            <Link href="/privacy" className="text-[#55607a] transition-colors hover:text-[#202434]">Privacy policy</Link>
          </nav>
        </div>
      </header>

      <main id="page-content" className="mx-auto max-w-5xl px-5 py-12 sm:px-8 sm:py-16">
        {children}
      </main>

      <footer className="border-t border-[#e2e5ee]">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-5 py-7 text-[12px] text-[#667087] sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p>Planner · A personal-use project by {plannerPublicDetails.maintainer}</p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <Link href="/about" className="hover:text-[#202434]">About Planner</Link>
            <Link href="/privacy" className="underline decoration-[#b9c0d2] underline-offset-4 hover:text-[#202434]">Privacy policy</Link>
            <a href={`mailto:${plannerPublicDetails.supportEmail}`} className="hover:text-[#202434]">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
