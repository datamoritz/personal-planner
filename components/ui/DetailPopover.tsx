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
import { useCallback, useEffect } from 'react';
import { X } from 'lucide-react';
import { useIsMobile } from '@/lib/useIsMobile';

interface DetailPopoverProps {
  anchor: HTMLElement;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
  className?: string;   // overrides the default w-72 (desktop only)
  noPadding?: boolean;
  headerActions?: React.ReactNode;
  hideCloseButton?: boolean;
}

export function DetailPopover({
  anchor,
  onClose,
  children,
  title,
  className,
  noPadding,
  headerActions,
  hideCloseButton = false,
}: DetailPopoverProps) {
  // All hooks unconditional — required by React rules
  const { refs, floatingStyles, context } = useFloating({
    open: true,
    onOpenChange: (open) => { if (!open) onClose(); },
    middleware: [offset(10), flip({ padding: 12 }), shift({ padding: 12 })],
    whileElementsMounted: autoUpdate,
  });

  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'dialog' });
  const { getFloatingProps } = useInteractions([dismiss, role]);
  const setFloating = useCallback((node: HTMLDivElement | null) => {
    refs.setFloating(node);
  }, [refs]);

  useEffect(() => {
    refs.setReference(anchor);
  }, [anchor, refs]);

  const isMobile = useIsMobile();

  // ── Mobile: full-width bottom sheet ────────────────────────────────────────
  if (isMobile) {
    return (
      <FloatingPortal>
        <div className="fixed inset-0 z-[119] bg-black/40" onClick={onClose} />
        <div className="fixed inset-x-0 bottom-0 z-[120] flex flex-col rounded-t-[1.5rem] bg-[var(--color-popover)] border-t border-x border-[var(--color-popover-border)] max-h-[85dvh] sheet-enter shadow-[0_-8px_40px_rgba(0,0,0,0.16)]">
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
            <div className="w-8 h-[3px] rounded-full bg-[var(--color-border)]" />
          </div>

          {/* Header */}
          {(title || !hideCloseButton || headerActions) && (
            <div className={[
              'flex items-center justify-between px-4 py-3 flex-shrink-0',
              title ? 'border-b border-[var(--color-popover-border)]' : '',
            ].join(' ')}>
              {title
                ? <span className="ui-section-label">{title}</span>
                : <div />}
              <div className="flex items-center gap-1.5">
                {headerActions}
                {!hideCloseButton && (
                  <button onClick={onClose} className="ui-icon-button">
                    <X size={14} strokeWidth={2.5} />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Content */}
          <div className={`overflow-y-auto flex-1 min-h-0 ${noPadding ? '' : 'p-4'}`}>
            {children}
          </div>
        </div>
      </FloatingPortal>
    );
  }

  // ── Desktop: floating popover (unchanged) ──────────────────────────────────
  return (
    <FloatingPortal>
      <FloatingFocusManager context={context} modal={false} initialFocus={-1}>
        <div
          ref={setFloating}
          style={{ ...floatingStyles, zIndex: 120 }}
          {...getFloatingProps()}
          className={`${className ?? 'w-72'} ui-floating-surface bg-[var(--color-popover)]`}
        >
          {title && (
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-[var(--color-popover-border)]">
              <span className="ui-section-label">{title}</span>
              <div className="flex items-center gap-1.5">
                {headerActions}
                {!hideCloseButton && (
                  <button onClick={onClose} className="ui-icon-button">
                    <X size={12} strokeWidth={2.5} />
                  </button>
                )}
              </div>
            </div>
          )}
          {!title && (
            <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
              {headerActions}
              {!hideCloseButton && (
                <button onClick={onClose} className="ui-icon-button">
                  <X size={12} strokeWidth={2.5} />
                </button>
              )}
            </div>
          )}
          <div className={noPadding ? '' : 'p-4 md:p-[1.125rem]'}>{children}</div>
        </div>
      </FloatingFocusManager>
    </FloatingPortal>
  );
}
