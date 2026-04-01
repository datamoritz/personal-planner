'use client';

import { useEffect, useRef, useState } from 'react';

interface InlineTaskInputProps {
  placeholder?: string;
  onSubmit: (title: string) => void;
  onCancel: () => void;
}

export function InlineTaskInput({
  placeholder = 'Task name…',
  onSubmit,
  onCancel,
}: InlineTaskInputProps) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { ref.current?.focus(); }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      const trimmed = value.trim();
      if (trimmed) onSubmit(trimmed);
      else onCancel();
    } else if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <div className="flex items-center gap-2 px-2.5 py-2 rounded-[1rem] border border-dashed bg-[var(--color-task-draft)] border-[var(--color-task-draft-border)]">
      {/* Placeholder circle */}
      <div className="flex-shrink-0 w-4 h-4 rounded-full border-2 border-[var(--color-task-draft-border)] opacity-70" />
      <input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          const trimmed = value.trim();
          if (trimmed) onSubmit(trimmed);
          else onCancel();
        }}
        placeholder={placeholder}
        className="flex-1 bg-transparent text-[14px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none"
      />
    </div>
  );
}
