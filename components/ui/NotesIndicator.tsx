import { AlignLeft } from 'lucide-react';

export function NotesIndicator({ notes, size = 11, className = '' }: {
  notes?: string | null;
  size?: number;
  className?: string;
}) {
  if (!notes?.trim()) return null;
  return (
    <span role="img" aria-label="Has notes" title="Has notes" className={`inline-flex flex-shrink-0 items-center opacity-75 ${className}`}>
      <AlignLeft size={size} strokeWidth={2.2} aria-hidden="true" />
    </span>
  );
}
