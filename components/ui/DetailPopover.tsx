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

interface DetailPopoverProps {
  anchor: HTMLElement;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
  className?: string;   // overrides the default w-72
  noPadding?: boolean;  // removes the p-4 content wrapper
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

  return (
    <FloatingPortal>
      <FloatingFocusManager context={context} modal={false} initialFocus={-1}>
        <div
          ref={setFloating}
          style={{ ...floatingStyles, zIndex: 120 }}
          {...getFloatingProps()}
          className={`${className ?? 'w-72'} ui-floating-surface bg-[var(--color-popover)]`}
        >
          {/* Header */}
          {title && (
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-[var(--color-popover-border)]">
              <span className="ui-section-label">
                {title}
              </span>
              <div className="flex items-center gap-1.5">
                {headerActions}
                {!hideCloseButton && (
                  <button
                    onClick={onClose}
                    className="ui-icon-button"
                  >
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
                <button
                  onClick={onClose}
                  className="ui-icon-button"
                >
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
