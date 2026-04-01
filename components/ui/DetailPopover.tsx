'use client';

import {
  autoUpdate,
  flip,
  FloatingFocusManager,
  FloatingPortal,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from '@floating-ui/react';
import { useEffect } from 'react';
import { X } from 'lucide-react';

interface DetailPopoverProps {
  anchor: HTMLElement;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
  className?: string;   // overrides the default w-72
  noPadding?: boolean;  // removes the p-4 content wrapper
  headerActions?: React.ReactNode;
}

export function DetailPopover({
  anchor,
  onClose,
  children,
  title,
  className,
  noPadding,
  headerActions,
}: DetailPopoverProps) {
  const { refs, floatingStyles, context } = useFloating({
    open: true,
    onOpenChange: (open) => { if (!open) onClose(); },
    middleware: [offset(10), flip({ padding: 12 }), shift({ padding: 12 })],
    whileElementsMounted: autoUpdate,
  });

  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'dialog' });
  const { getFloatingProps } = useInteractions([dismiss, role]);

  useEffect(() => {
    refs.setReference(anchor);
  }, [anchor, refs]);

  return (
    <FloatingPortal>
      <FloatingFocusManager context={context} modal={false} initialFocus={-1}>
        <div
          ref={refs.setFloating}
          style={{ ...floatingStyles, zIndex: 50 }}
          {...getFloatingProps()}
          className={`${className ?? 'w-72'} rounded-xl border border-[var(--color-popover-border)] bg-[var(--color-popover)] shadow-2xl`}
        >
          {/* Header */}
          {title && (
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-popover-border)]">
              <span className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
                {title}
              </span>
              <div className="flex items-center gap-1">
                {headerActions}
                <button
                  onClick={onClose}
                  className="w-5 h-5 flex items-center justify-center rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)] transition-colors cursor-pointer outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
                >
                  <X size={12} strokeWidth={2.5} />
                </button>
              </div>
            </div>
          )}
          {!title && (
            <div className="absolute top-2.5 right-2.5 z-10 flex items-center gap-1">
              {headerActions}
              <button
                onClick={onClose}
                className="w-5 h-5 flex items-center justify-center rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)] transition-colors cursor-pointer outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
              >
                <X size={12} strokeWidth={2.5} />
              </button>
            </div>
          )}
          <div className={noPadding ? '' : 'p-4'}>{children}</div>
        </div>
      </FloatingFocusManager>
    </FloatingPortal>
  );
}
