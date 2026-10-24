import Link from 'next/link';

export function AboutPrivacyLinks({ touchFriendly = false }: { touchFriendly?: boolean }) {
  const linkClass = `inline-flex items-center rounded transition-colors hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] ${touchFriendly ? 'min-h-10 px-1' : 'py-1'}`;

  return (
    <nav aria-label="About and privacy" className="flex items-center justify-end gap-2 text-[11px] text-[var(--color-text-secondary)]">
      <Link href="/about" target="_blank" rel="noopener noreferrer" prefetch={false} className={linkClass}>About</Link>
      <span aria-hidden="true" className="text-[var(--color-text-muted)]">·</span>
      <Link href="/privacy" target="_blank" rel="noopener noreferrer" prefetch={false} className={linkClass}>Privacy</Link>
    </nav>
  );
}
