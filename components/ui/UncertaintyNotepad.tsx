'use client';

import { useRef, useState } from 'react';
import { Plus, ListTodo, CalendarPlus, FolderPlus, RefreshCw, Briefcase } from 'lucide-react';
import { usePlannerStore } from '@/store/usePlannerStore';

interface UncertaintyNotepadProps {
  actionsVisible: boolean;
}

type MenuState = { lineIndex: number; anchor: { top: number; left: number } } | null;

export function UncertaintyNotepad({ actionsVisible }: UncertaintyNotepadProps) {
  const {
    uncertaintyNotes, setUncertaintyNotes,
    selectedProjectIdForNotes, projects,
    currentDate, addTask, addProject, addRecurrentTask,
  } = usePlannerStore();

  const [menu, setMenu]           = useState<MenuState>(null);
  const [doneLines, setDoneLines] = useState<Set<number>>(new Set());
  const [selected, setSelected]   = useState<Set<number>>(new Set());
  const textareaRef               = useRef<HTMLTextAreaElement>(null);
  const containerRef              = useRef<HTMLDivElement>(null);

  const lines = uncertaintyNotes.split('\n');
  const selectedProject = projects.find((p) => p.id === selectedProjectIdForNotes);

  // ── Brainstorm mode: plain textarea ──────────────────────────────────────
  if (!actionsVisible) {
    return (
      <textarea
        ref={textareaRef}
        value={uncertaintyNotes}
        onChange={(e) => setUncertaintyNotes(e.target.value)}
        placeholder="What is uncertain? Dump everything here…"
        className="flex-1 w-full resize-none bg-transparent text-[15px] text-[var(--color-text-primary)] leading-[1.8] placeholder:text-[var(--color-text-muted)] outline-none px-5 py-4"
        style={{ fontFamily: 'inherit' }}
      />
    );
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  const markDone = (indices: number[]) =>
    setDoneLines((prev) => { const next = new Set(prev); indices.forEach((i) => next.add(i)); return next; });

  const executeAction = (indices: number[], action: string) => {
    const texts = indices.map((i) => lines[i].trim()).filter(Boolean);
    if (!texts.length) return;
    switch (action) {
      case 'backlog':
        texts.forEach((t) => addTask({ title: t, location: 'backlog' }));
        break;
      case 'today':
        texts.forEach((t) => addTask({ title: t, location: 'today', date: currentDate }));
        break;
      case 'project': {
        const pid = selectedProjectIdForNotes;
        texts.forEach((t) =>
          pid ? addTask({ title: t, location: 'project', projectId: pid }) : addTask({ title: t, location: 'backlog' })
        );
        break;
      }
      case 'new-project':
        texts.forEach((t) => addProject(t));
        break;
      case 'recurrent':
        texts.forEach((t) => addRecurrentTask({ title: t, frequency: { type: 'daily' } }));
        break;
    }
    markDone(indices);
    setSelected(new Set());
    setMenu(null);
  };

  const toggleSelect = (i: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const nonEmptySelected = [...selected].filter((i) => lines[i]?.trim());
  const hasSelection = nonEmptySelected.length > 1;

  // ── Action mode: rendered lines ───────────────────────────────────────────
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div ref={containerRef} className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-1">
        {lines.map((line, i) => {
          const isEmpty    = line.trim() === '';
          const isDone     = doneLines.has(i);
          const isSelected = selected.has(i);
          const isMenuOpen = menu?.lineIndex === i;

          return (
            <div
              key={i}
              className={[
                'group relative flex items-start gap-2 min-h-[24px] rounded-xl px-2 -mx-2 transition-colors',
                isSelected ? 'bg-[var(--color-accent-subtle)]' : '',
              ].join(' ')}
            >
              {/* Checkbox for non-empty lines */}
              {!isEmpty ? (
                <button
                  onClick={() => toggleSelect(i)}
                  className={[
                    'flex-shrink-0 mt-[3px] w-3.5 h-3.5 rounded border-2 transition-colors cursor-pointer',
                    isSelected
                      ? 'bg-[var(--color-accent)] border-[var(--color-accent)]'
                      : 'border-[var(--color-border)] opacity-0 group-hover:opacity-100',
                  ].join(' ')}
                >
                  {isSelected && (
                    <svg viewBox="0 0 10 8" fill="none" className="w-full h-full p-[1px]">
                      <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              ) : (
                <div className="flex-shrink-0 w-3.5" />
              )}

              <span
                className={[
                  'flex-1 text-[15px] leading-[1.8] whitespace-pre-wrap break-words',
                  isDone ? 'line-through text-[var(--color-text-muted)]' : 'text-[var(--color-text-primary)]',
                  isEmpty ? 'text-transparent select-none' : '',
                ].join(' ')}
              >
                {isEmpty ? '·' : line}
              </span>

              {!isEmpty && !hasSelection && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isMenuOpen) { setMenu(null); return; }
                    const btn  = e.currentTarget.getBoundingClientRect();
                    const cont = containerRef.current!.getBoundingClientRect();
                    setMenu({ lineIndex: i, anchor: { top: btn.bottom - cont.top + 4, left: btn.left - cont.left } });
                  }}
                  className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-xl text-[var(--color-text-muted)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)] transition-colors opacity-0 group-hover:opacity-100 mt-0.5"
                >
                  <Plus size={11} strokeWidth={2.5} />
                </button>
              )}

              {isMenuOpen && (
                <div
                  className="absolute z-50 ui-floating-surface py-1.5 min-w-[220px]"
                  style={{ top: menu.anchor.top, left: Math.max(0, menu.anchor.left - 170) }}
                >
                  <MenuItem icon={<ListTodo size={12} />}     label="Add to Backlog"        onClick={() => executeAction([i], 'backlog')} />
                  <MenuItem icon={<CalendarPlus size={12} />}  label="Add to Today"          onClick={() => executeAction([i], 'today')} />
                  <MenuItem
                    icon={<Briefcase size={12} />}
                    label={selectedProject ? `Add to "${selectedProject.title}"` : 'Add to Project (select left)'}
                    onClick={() => executeAction([i], 'project')}
                    disabled={!selectedProjectIdForNotes}
                  />
                  <MenuItem icon={<FolderPlus size={12} />}   label="Create New Project"    onClick={() => executeAction([i], 'new-project')} />
                  <div className="my-1 border-t border-[var(--color-border-subtle)]" />
                  <MenuItem icon={<RefreshCw size={12} />}    label="Create Recurrent Task"  onClick={() => executeAction([i], 'recurrent')} />
                </div>
              )}
            </div>
          );
        })}

        {menu && <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} />}
      </div>

      {/* Multi-select action bar */}
      {hasSelection && (
        <div className="flex-shrink-0 border-t border-[#f5df93] bg-[#fff7c7] px-5 py-3 flex items-center gap-2.5 flex-wrap">
          <span className="text-[11px] font-semibold text-[var(--color-text-muted)] mr-1">
            {nonEmptySelected.length} selected:
          </span>
          <BulkButton icon={<ListTodo size={11} />}    label="Backlog"    onClick={() => executeAction(nonEmptySelected, 'backlog')} />
          <BulkButton icon={<CalendarPlus size={11} />} label="Today"     onClick={() => executeAction(nonEmptySelected, 'today')} />
          <BulkButton
            icon={<Briefcase size={11} />}
            label={selectedProject ? `"${selectedProject.title}"` : 'Project'}
            onClick={() => executeAction(nonEmptySelected, 'project')}
            disabled={!selectedProjectIdForNotes}
          />
          <BulkButton icon={<FolderPlus size={11} />}  label="New Projects" onClick={() => executeAction(nonEmptySelected, 'new-project')} />
          <BulkButton icon={<RefreshCw size={11} />}   label="Recurrent"  onClick={() => executeAction(nonEmptySelected, 'recurrent')} />
          <button
            onClick={() => setSelected(new Set())}
            className="ml-auto text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors cursor-pointer"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, label, onClick, disabled = false }: {
  icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      className={[
        'w-full flex items-center gap-2.5 px-3 py-1.5 text-[12px] text-left transition-colors',
        disabled
          ? 'text-[var(--color-text-muted)] opacity-40 cursor-not-allowed'
          : 'text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)] cursor-pointer',
      ].join(' ')}
    >
      <span className="text-[var(--color-text-muted)]">{icon}</span>
      {label}
    </button>
  );
}

function BulkButton({ icon, label, onClick, disabled = false }: {
  icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      className={[
        'ui-chip border transition-colors',
        disabled
          ? 'border-[var(--color-border)] text-[var(--color-text-muted)] opacity-40 cursor-not-allowed'
          : 'border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-white cursor-pointer',
      ].join(' ')}
    >
      {icon}{label}
    </button>
  );
}
