'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { ChevronLeft, ChevronRight, Loader2, Mail, RefreshCw, Sparkles, Tag as TagIcon, X } from 'lucide-react';
import * as api from '@/lib/api';
import { usePlannerStore } from '@/store/usePlannerStore';
import type { EmailContent, EmailTaskSuggestion, RecentEmail, TaskLocation } from '@/types';
import { PopoverField, PopoverInput } from './PopoverField';

type DraftTask = {
  title: string;
  notes: string;
  taskDate: string;
  startTime: string;
  endTime: string;
  tagName: string;
  projectTitle: string;
  targetLocation: Exclude<TaskLocation, 'upcoming'>;
};

const DEFAULT_WIDTH = 1140;
const DEFAULT_HEIGHT = 700;
const MIN_WIDTH = 900;
const MIN_HEIGHT = 540;

const GHOST_INPUT =
  'w-full min-w-0 rounded-[0.95rem] border border-transparent bg-[var(--color-surface-secondary)]/72 px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] transition-all duration-150 placeholder:text-[var(--color-text-muted)] hover:bg-[var(--color-surface-secondary)] hover:border-[var(--color-border-subtle)] focus:outline-none focus:border-[var(--color-accent)] focus:bg-[var(--color-surface)] focus:shadow-[0_0_0_3px_var(--color-focus-ring)]';
const GHOST_TEXTAREA =
  'w-full min-w-0 rounded-[1rem] border border-transparent bg-[var(--color-surface-secondary)]/72 px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] transition-all duration-150 placeholder:text-[var(--color-text-muted)] hover:bg-[var(--color-surface-secondary)] hover:border-[var(--color-border-subtle)] focus:outline-none focus:border-[var(--color-accent)] focus:bg-[var(--color-surface)] focus:shadow-[0_0_0_3px_var(--color-focus-ring)]';

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getViewportBoundedSize(width: number, height: number) {
  if (typeof window === 'undefined') return { width, height };
  return {
    width: Math.min(width, Math.max(MIN_WIDTH, window.innerWidth - 24)),
    height: Math.min(height, Math.max(MIN_HEIGHT, window.innerHeight - 24)),
  };
}

function toLocalTime(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw.length >= 5 ? raw.slice(0, 5) : raw;
}

function quickFollowUpTitle(subject: string): string {
  const cleaned = subject.trim().replace(/\s+/g, ' ');
  if (!cleaned) return 'Email follow-up';
  const words = cleaned.split(' ').slice(0, 6).join(' ');
  return `Email follow-up: ${words}${cleaned.split(' ').length > 6 ? '...' : ''}`;
}

function suggestionToDraft(suggestion: EmailTaskSuggestion | null, fallbackTitle = ''): DraftTask {
  return {
    title: suggestion?.title?.trim() || fallbackTitle,
    notes: suggestion?.notes?.trim() || '',
    taskDate: suggestion?.taskDate || '',
    startTime: toLocalTime(suggestion?.startTime),
    endTime: toLocalTime(suggestion?.endTime),
    tagName: suggestion?.tagName?.trim() || '',
    projectTitle: suggestion?.projectTitle?.trim() || '',
    targetLocation: 'today',
  };
}

function looksLikeTimedSuggestion(draft: DraftTask): boolean {
  return Boolean(draft.startTime || draft.endTime);
}

export function EmailToTaskPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const addTask = usePlannerStore((s) => s.addTask);
  const updateTask = usePlannerStore((s) => s.updateTask);
  const setTaskTag = usePlannerStore((s) => s.setTaskTag);
  const tags = usePlannerStore((s) => s.tags);
  const projects = usePlannerStore((s) => s.projects);
  const currentDate = usePlannerStore((s) => s.currentDate);

  const [emails, setEmails] = useState<RecentEmail[]>([]);
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [selectedEmail, setSelectedEmail] = useState<EmailContent | null>(null);
  const [draft, setDraft] = useState<DraftTask>(() => suggestionToDraft(null));
  const [extraInstruction, setExtraInstruction] = useState('');
  const [isLoadingEmails, setIsLoadingEmails] = useState(false);
  const [isLoadingEmail, setIsLoadingEmail] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [draftCollapsed, setDraftCollapsed] = useState(false);

  const [size, setSize] = useState(() => getViewportBoundedSize(DEFAULT_WIDTH, DEFAULT_HEIGHT));
  const [position, setPosition] = useState(() => {
    const initialSize = getViewportBoundedSize(DEFAULT_WIDTH, DEFAULT_HEIGHT);
    return {
      x: Math.max(12, Math.round((typeof window === 'undefined' ? 1400 : window.innerWidth) / 2 - initialSize.width / 2)),
      y: 52,
    };
  });

  const dragRef = useRef<{ startX: number; startY: number; x: number; y: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; width: number; height: number } | null>(null);
  const tagPickerRef = useRef<HTMLDivElement | null>(null);

  const selectedListItem = useMemo(
    () => emails.find((email) => email.id === selectedEmailId) ?? null,
    [emails, selectedEmailId],
  );
  const selectedTag = useMemo(
    () => tags.find((tag) => tag.name === draft.tagName) ?? null,
    [draft.tagName, tags],
  );
  const selectedProject = useMemo(
    () => projects.find((project) => project.title === draft.projectTitle) ?? null,
    [draft.projectTitle, projects],
  );
  const showTimeFields = useMemo(
    () => draft.targetLocation === 'myday' || looksLikeTimedSuggestion(draft),
    [draft],
  );

  const loadEmails = useCallback(async () => {
    setIsLoadingEmails(true);
    setError(null);
    try {
      const recent = await api.getRecentEmails();
      setEmails(recent);
      setSelectedEmailId((prev) => prev ?? recent[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load emails');
    } finally {
      setIsLoadingEmails(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadEmails();
  }, [open, loadEmails]);

  useEffect(() => {
    if (!open || !selectedEmailId) {
      setSelectedEmail(null);
      return;
    }
    let cancelled = false;
    setIsLoadingEmail(true);
    setError(null);
    api.getEmailContent(selectedEmailId)
      .then((email) => {
        if (cancelled) return;
        setSelectedEmail(email);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load email');
        setSelectedEmail(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingEmail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, selectedEmailId]);

  useEffect(() => {
    if (!open || !tagPickerOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!tagPickerRef.current?.contains(event.target as Node)) {
        setTagPickerOpen(false);
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, [open, tagPickerOpen]);

  useEffect(() => {
    if (!open) return;
    const onMouseMove = (event: MouseEvent) => {
      if (dragRef.current) {
        const { startX, startY, x, y } = dragRef.current;
        const nextX = clamp(x + (event.clientX - startX), 12, window.innerWidth - size.width - 12);
        const nextY = clamp(y + (event.clientY - startY), 12, window.innerHeight - size.height - 12);
        setPosition({ x: nextX, y: nextY });
      }
      if (resizeRef.current) {
        const { startX, startY, width, height } = resizeRef.current;
        const nextWidth = clamp(width + (event.clientX - startX), MIN_WIDTH, window.innerWidth - position.x - 12);
        const nextHeight = clamp(height + (event.clientY - startY), MIN_HEIGHT, window.innerHeight - position.y - 12);
        setSize({ width: nextWidth, height: nextHeight });
      }
    };
    const onMouseUp = () => {
      dragRef.current = null;
      resizeRef.current = null;
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [open, position.x, position.y, size.height, size.width]);

  useEffect(() => {
    if (!open) return;
    const clampToViewport = () => {
      const bounded = getViewportBoundedSize(size.width, size.height);
      setSize(bounded);
      setPosition((prev) => ({
        x: clamp(prev.x, 12, Math.max(12, window.innerWidth - bounded.width - 12)),
        y: clamp(prev.y, 12, Math.max(12, window.innerHeight - bounded.height - 12)),
      }));
    };
    clampToViewport();
    window.addEventListener('resize', clampToViewport);
    return () => window.removeEventListener('resize', clampToViewport);
  }, [open, size.height, size.width]);

  const handleSuggest = useCallback(async () => {
    if (!selectedEmailId) return;
    setIsSuggesting(true);
    setError(null);
    try {
      const suggestion = await api.suggestTaskFromEmail(selectedEmailId, extraInstruction);
      const fallbackTitle = selectedEmail?.subject ? quickFollowUpTitle(selectedEmail.subject) : '';
      setDraft(suggestionToDraft(suggestion, fallbackTitle));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate task suggestion');
    } finally {
      setIsSuggesting(false);
    }
  }, [extraInstruction, selectedEmail?.subject, selectedEmailId]);

  const handleQuickFollowUp = useCallback(() => {
    if (!selectedEmail) return;
    setDraft((prev) => ({
      ...prev,
      title: quickFollowUpTitle(selectedEmail.subject),
    }));
    setError(null);
  }, [selectedEmail]);

  const handleSave = useCallback(async () => {
    const title = draft.title.trim();
    if (!title) {
      setError('Title is required');
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const project = projects.find(
        (candidate) => candidate.title.trim().toLowerCase() === draft.projectTitle.trim().toLowerCase(),
      );
      const tag = tags.find(
        (candidate) => candidate.name.trim().toLowerCase() === draft.tagName.trim().toLowerCase(),
      );

      const location = draft.targetLocation;
      const effectiveDate =
        location === 'today' || location === 'myday'
          ? (draft.taskDate || currentDate)
          : undefined;

      if (location === 'project' && !project) {
        setError('Choose a project for project tasks');
        setIsSaving(false);
        return;
      }

      if (location === 'myday' && (!draft.startTime || !draft.endTime)) {
        setError('Choose a start and end time for My Day tasks');
        setIsSaving(false);
        return;
      }

      const taskId = addTask({
        title,
        location,
        date: effectiveDate,
        projectId: location === 'project' ? project?.id : undefined,
      });

      if (
        draft.notes.trim() ||
        (location === 'myday' && (draft.startTime || draft.endTime)) ||
        (location !== 'backlog' && location !== 'project' && effectiveDate)
      ) {
        updateTask(taskId, {
          notes: draft.notes.trim() || undefined,
          date: effectiveDate,
          startTime: location === 'myday' ? draft.startTime || undefined : undefined,
          endTime: location === 'myday' ? draft.endTime || undefined : undefined,
        });
      }

      if (tag) setTaskTag(taskId, tag.id);

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save task');
    } finally {
      setIsSaving(false);
    }
  }, [addTask, currentDate, draft, onClose, projects, setTaskTag, tags, updateTask]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] pointer-events-none">
      <div
        className="pointer-events-auto absolute ui-floating-surface bg-[var(--color-popover)] border border-[var(--color-popover-border)] rounded-[1.6rem] overflow-hidden"
        style={{
          left: position.x,
          top: position.y,
          width: size.width,
          height: size.height,
        }}
      >
        <div
          className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-popover-border)]/80 cursor-move select-none"
          onMouseDown={(event) => {
            if ((event.target as HTMLElement).closest('button, input, textarea')) return;
            dragRef.current = {
              startX: event.clientX,
              startY: event.clientY,
              x: position.x,
              y: position.y,
            };
          }}
        >
          <div className="flex items-center gap-2.5">
            <div className="ui-icon-button pointer-events-none bg-[var(--color-surface-secondary)]/72">
              <Mail size={14} strokeWidth={2.1} />
            </div>
            <div>
              <div className="text-[15px] font-semibold tracking-tight text-[var(--color-text-primary)]">Email to Task</div>
              <div className="text-[11px] text-[var(--color-text-muted)]">Inbox emails from the last 24 hours</div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => void loadEmails()} className="ui-icon-button" title="Refresh emails">
              <RefreshCw size={14} strokeWidth={2} />
            </button>
            <button type="button" onClick={onClose} className="ui-icon-button" title="Close">
              <X size={14} strokeWidth={2.4} />
            </button>
          </div>
        </div>

        <div
          className="grid h-[calc(100%-54px)] min-h-0"
          style={{
            gridTemplateColumns: draftCollapsed ? '290px minmax(0,1fr) 42px' : '290px minmax(320px,1fr) 260px',
            gridTemplateRows: '78px minmax(0,1fr)',
          }}
        >
          <div className="col-span-2 flex min-w-0 items-center gap-5 border-b border-[var(--color-popover-border)]/65 bg-[var(--color-surface-secondary)]/22 px-6">
            <div className="min-w-0">
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
                Selected Email
              </div>
              <div className="mt-1 truncate text-[15px] font-semibold tracking-tight text-[var(--color-text-primary)]">
                {selectedListItem?.subject || 'Select an email'}
              </div>
              {selectedListItem && (
                <div className="mt-1 truncate text-[11px] text-[var(--color-text-muted)]">
                  {[selectedListItem.sender, selectedListItem.receivers.join(', ')].filter(Boolean).join(' -> ')}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 border-b border-l border-[var(--color-popover-border)]/65 bg-[linear-gradient(180deg,rgba(93,109,244,0.08),rgba(93,109,244,0.02))] px-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setDraftCollapsed((value) => !value)}
                className="ui-icon-button"
                title={draftCollapsed ? 'Expand task draft' : 'Collapse task draft'}
              >
                {draftCollapsed ? <ChevronLeft size={14} strokeWidth={2.2} /> : <ChevronRight size={14} strokeWidth={2.2} />}
              </button>
              {!draftCollapsed && <span className="ui-section-label text-[var(--color-accent)]">Task Draft</span>}
            </div>
            {!draftCollapsed && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleQuickFollowUp}
                  disabled={!selectedEmail}
                  className="px-3 py-1.5 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]/84 text-[12px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Quick follow-up
                </button>
                <button
                  type="button"
                  onClick={() => void handleSuggest()}
                  disabled={!selectedEmailId || isSuggesting}
                  className="relative inline-flex items-center gap-1.5 overflow-hidden rounded-xl border border-[var(--color-accent)]/25 bg-[var(--color-surface)]/92 px-3 py-1.5 text-[12px] font-semibold text-[var(--color-accent)] shadow-[0_8px_18px_rgba(93,109,244,0.08)] hover:brightness-[0.99] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(115deg,transparent_0%,rgba(93,109,244,0.00)_35%,rgba(93,109,244,0.16)_50%,rgba(93,109,244,0.00)_65%,transparent_100%)] opacity-70 [background-size:220%_100%] animate-[emailSuggestShimmer_2.8s_linear_infinite]" />
                  <span className="relative inline-flex items-center gap-1.5">
                    {isSuggesting ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} strokeWidth={2} />}
                    Suggest task
                  </span>
                </button>
              </div>
            )}
          </div>

          <div className="flex min-h-0 flex-col bg-[var(--color-surface-secondary)]/56">
            <div className="px-6 pt-5 pb-2">
              <span className="ui-section-label">Inbox</span>
            </div>
            <div className="flex-1 overflow-y-auto px-5 pt-1 pb-4">
              {isLoadingEmails ? (
                <div className="space-y-3">
                  {[0, 1, 2].map((index) => (
                    <div key={index} className="rounded-[1.05rem] bg-[var(--color-surface)]/96 px-4 py-3 shadow-[0_18px_36px_rgba(19,23,38,0.08)]">
                      <div className="h-4 w-3/4 rounded bg-[var(--color-surface-raised)] animate-pulse" />
                      <div className="mt-2 h-3 w-1/3 rounded bg-[var(--color-surface-raised)] animate-pulse" />
                      <div className="mt-3 h-3 w-full rounded bg-[var(--color-surface-raised)] animate-pulse" />
                      <div className="mt-2 h-3 w-4/5 rounded bg-[var(--color-surface-raised)] animate-pulse" />
                    </div>
                  ))}
                </div>
              ) : emails.length === 0 ? (
                <div className="px-2 py-3 text-sm text-[var(--color-text-muted)]">No recent inbox emails found.</div>
              ) : (
                <div className="space-y-3">
                  {emails.map((email) => {
                    const active = email.id === selectedEmailId;
                    return (
                      <button
                        key={email.id}
                        type="button"
                        onClick={() => setSelectedEmailId(email.id)}
                        className={[
                          'w-full text-left rounded-[1.05rem] px-4 py-3 transition-all shadow-[0_18px_36px_rgba(19,23,38,0.08)]',
                          active
                            ? 'bg-[linear-gradient(180deg,rgba(247,249,255,1),rgba(241,245,253,0.98))] ring-2 ring-[var(--color-accent)] shadow-[0_22px_42px_rgba(93,109,244,0.16)]'
                            : 'bg-[linear-gradient(180deg,rgba(248,250,255,0.98),rgba(241,245,252,0.96))] hover:shadow-[0_20px_38px_rgba(19,23,38,0.1)]',
                        ].join(' ')}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-[13px] font-medium leading-5 text-[var(--color-text-primary)] line-clamp-2">
                            {email.subject || '(No subject)'}
                          </span>
                          <span className="text-[11px] whitespace-nowrap text-[var(--color-text-muted)]">
                            {format(parseISO(email.receivedAt), 'p')}
                          </span>
                        </div>
                        <div className="mt-1 text-[11px] text-[var(--color-text-muted)] line-clamp-1">
                          {email.sender || email.receivers[0] || 'Unknown sender'}
                        </div>
                        <div className="mt-1.5 text-[12px] leading-5 text-[var(--color-text-muted)] line-clamp-2">
                          {email.snippet}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="min-h-0 flex flex-col px-6 pt-5 pb-4">
            {isLoadingEmail ? (
              <div className="space-y-3">
                <div>
                  <div className="h-3 w-28 rounded bg-[var(--color-surface-raised)] animate-pulse" />
                  <div className="mt-2 h-9 max-w-[460px] rounded-[0.95rem] bg-[var(--color-surface)]/82 animate-pulse" />
                </div>
                <div className="rounded-[1.2rem] bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(239,243,250,0.78))] px-5 py-4 shadow-[0_20px_44px_rgba(19,23,38,0.09)] ring-1 ring-white/78 backdrop-blur-[12px]">
                  <div className="h-3 w-24 rounded bg-[var(--color-surface-raised)] animate-pulse" />
                  <div className="mt-4 space-y-3">
                    {[0, 1, 2, 3, 4].map((line) => (
                      <div
                        key={line}
                        className="h-3 rounded bg-[var(--color-surface-raised)] animate-pulse"
                        style={{ width: `${line === 4 ? 68 : 100 - line * 6}%` }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            ) : selectedEmail ? (
              <div className="flex min-h-0 flex-1 flex-col gap-3">
                <div>
                  <span className="ui-section-label">Extra Instruction</span>
                  <input
                    type="text"
                    value={extraInstruction}
                    onChange={(event) => setExtraInstruction(event.target.value)}
                    placeholder="Optional: focus on one specific action, deadline, or follow-up..."
                    className={`mt-2 max-w-[460px] ${GHOST_INPUT}`}
                  />
                </div>
                <div className="min-h-0 flex-1 rounded-[1.2rem] bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(239,243,250,0.78))] px-5 py-4 shadow-[0_20px_44px_rgba(19,23,38,0.09)] ring-1 ring-white/78 backdrop-blur-[12px]">
                  <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
                    Cleaned body
                  </div>
                  <div className="mt-3 min-h-0 h-[calc(100%-1.75rem)] overflow-y-auto">
                    <div className="text-[14px] font-semibold tracking-tight text-[var(--color-text-primary)]">
                      {selectedEmail.subject || selectedListItem?.subject || '(No subject)'}
                    </div>
                    {selectedListItem?.sender && (
                      <div className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                        {selectedListItem.sender}
                      </div>
                    )}
                    <pre className="mt-4 whitespace-pre-wrap break-words font-sans text-[13px] leading-7 text-[var(--color-text-secondary)]">
                      {selectedEmail.body || '(No readable body found)'}
                    </pre>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-[var(--color-text-muted)]">Choose an email to preview and generate a task suggestion.</div>
            )}
          </div>

          <div className="min-h-0 border-l border-[var(--color-popover-border)]/65 flex flex-col bg-[linear-gradient(180deg,rgba(252,253,255,0.98),rgba(247,249,253,0.98))]">
            {draftCollapsed ? (
              <div className="flex flex-1 items-start justify-center pt-3">
                <button
                  type="button"
                  onClick={() => setDraftCollapsed(false)}
                  className="ui-icon-button h-7 w-7 rounded-full bg-[var(--color-surface)]/88 shadow-[0_6px_16px_rgba(19,23,38,0.08)]"
                  title="Expand task draft"
                >
                  <ChevronLeft size={14} strokeWidth={2.2} />
                </button>
              </div>
            ) : (
              <>
                <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-3 flex flex-col gap-2.5 relative">
                  <PopoverField label="Title">
                    <PopoverInput
                      value={draft.title}
                      onChange={(value) => setDraft((prev) => ({ ...prev, title: value }))}
                      placeholder="Suggested task title"
                      className={GHOST_INPUT}
                    />
                  </PopoverField>
                  <PopoverField label="Notes">
                    <PopoverInput
                      value={draft.notes}
                      onChange={(value) => setDraft((prev) => ({ ...prev, notes: value }))}
                      placeholder="Optional task notes"
                      multiline
                      minHeight={54}
                      className={GHOST_TEXTAREA}
                    />
                  </PopoverField>
                  <div className="grid grid-cols-[1.05fr_1fr] gap-2.5">
                    <PopoverField label="Date">
                      <input
                        type="date"
                        value={draft.taskDate}
                        onChange={(event) => setDraft((prev) => ({ ...prev, taskDate: event.target.value }))}
                        className={GHOST_INPUT}
                      />
                    </PopoverField>
                    <PopoverField label="Create In">
                      <select
                        value={draft.targetLocation}
                        onChange={(event) =>
                          setDraft((prev) => ({
                            ...prev,
                            targetLocation: event.target.value as DraftTask['targetLocation'],
                          }))}
                        className={GHOST_INPUT}
                      >
                        <option value="today">Tasks Today</option>
                        <option value="myday">My Day</option>
                        <option value="backlog">Backlog</option>
                        <option value="project">Project</option>
                      </select>
                    </PopoverField>
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_52px] gap-2.5 items-end">
                    <PopoverField label="Project">
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setTagPickerOpen(false)}
                          className={`${GHOST_INPUT} flex items-center gap-2 text-left`}
                        >
                          <span
                            className="inline-flex max-w-full items-center gap-2 rounded-full border px-2.5 py-1 text-[12px] font-medium shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
                            style={{
                              background: selectedProject
                                ? `${selectedProject.tagId
                                    ? tags.find((t) => t.id === selectedProject.tagId)?.colorDark ?? 'var(--color-surface-raised)'
                                    : 'var(--color-surface-raised)'}24`
                                : 'var(--color-surface)',
                              borderColor: selectedProject
                                ? tags.find((t) => t.id === selectedProject.tagId)?.colorDark ?? 'var(--color-border)'
                                : 'var(--color-border)',
                              color: 'var(--color-text-primary)',
                            }}
                          >
                            {selectedProject ? selectedProject.title : 'No project'}
                          </span>
                          <span className="ml-auto text-[10px] text-[var(--color-text-muted)]">Change</span>
                        </button>
                        <select
                          value={draft.projectTitle}
                          onChange={(event) => setDraft((prev) => ({ ...prev, projectTitle: event.target.value }))}
                          className="absolute inset-0 h-full w-full opacity-0 cursor-pointer"
                        >
                          <option value="">No project</option>
                          {projects.map((project) => (
                            <option key={project.id} value={project.title}>
                              {project.title}
                            </option>
                          ))}
                        </select>
                      </div>
                    </PopoverField>
                    <div className="flex flex-col gap-1.5" ref={tagPickerRef}>
                      <span className="ui-section-label opacity-0 pointer-events-none select-none">Tag</span>
                      <div className="relative">
                        <button
                          type="button"
                          title="Tag"
                          onClick={() => setTagPickerOpen((open) => !open)}
                          className={`${GHOST_INPUT} flex min-h-[34px] items-center justify-center px-0`}
                        >
                          {selectedTag ? (
                            <span
                              className="h-2.5 w-2.5 rounded-full border border-white/70"
                              style={{ backgroundColor: selectedTag.colorDark }}
                            />
                          ) : (
                            <TagIcon size={13} strokeWidth={2.1} className="text-[var(--color-text-muted)]" />
                          )}
                        </button>
                        {tagPickerOpen && (
                          <div className="absolute right-0 top-[calc(100%+8px)] z-[5] min-w-[180px] rounded-2xl border border-[var(--color-border)] bg-[var(--color-popover)] p-1.5 shadow-[0_18px_36px_rgba(15,23,42,0.14)]">
                            <button
                              type="button"
                              onClick={() => {
                                setDraft((prev) => ({ ...prev, tagName: '' }));
                                setTagPickerOpen(false);
                              }}
                              className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[13px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)]"
                            >
                              <span className="h-2.5 w-2.5 rounded-full border border-[var(--color-border)] bg-transparent" />
                              None
                            </button>
                            {tags.map((tag) => (
                              <button
                                key={tag.id}
                                type="button"
                                onClick={() => {
                                  setDraft((prev) => ({ ...prev, tagName: tag.name }));
                                  setTagPickerOpen(false);
                                }}
                                className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[13px] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-secondary)]"
                              >
                                <span
                                  className="h-2.5 w-2.5 rounded-full border border-white/70"
                                  style={{ backgroundColor: tag.colorDark }}
                                />
                                {tag.name}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  {showTimeFields ? (
                    <div className="grid grid-cols-2 gap-2.5">
                      <PopoverField label="Start Time">
                        <input
                          type="time"
                          value={draft.startTime}
                          onChange={(event) => setDraft((prev) => ({ ...prev, startTime: event.target.value }))}
                          className={GHOST_INPUT}
                        />
                      </PopoverField>
                      <PopoverField label="End Time">
                        <input
                          type="time"
                          value={draft.endTime}
                          onChange={(event) => setDraft((prev) => ({ ...prev, endTime: event.target.value }))}
                          className={GHOST_INPUT}
                        />
                      </PopoverField>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setDraft((prev) => ({ ...prev, startTime: prev.startTime || '09:00', endTime: prev.endTime || '10:00' }))}
                      className="self-start rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface-secondary)]/65 px-3 py-1.5 text-[12px] font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-secondary)]"
                    >
                      Add time
                    </button>
                  )}

                  {error && (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-800/40 dark:bg-red-950/20 dark:text-red-300">
                      {error}
                    </div>
                  )}

                  {isSuggesting && (
                    <div className="absolute inset-0 bg-[var(--color-popover)]/74 backdrop-blur-[2px] px-5 pt-0 pb-3">
                      <div className="space-y-3">
                        <div className="h-3 w-20 rounded bg-[var(--color-surface-raised)] animate-pulse" />
                        <div className="h-9 rounded-[0.95rem] bg-[var(--color-surface-secondary)] animate-pulse" />
                        <div className="h-3 w-16 rounded bg-[var(--color-surface-raised)] animate-pulse" />
                        <div className="h-28 rounded-[1rem] bg-[var(--color-surface-secondary)] animate-pulse" />
                        <div className="grid grid-cols-[1.05fr_1fr] gap-2.5">
                          <div className="h-16 rounded-[0.95rem] bg-[var(--color-surface-secondary)] animate-pulse" />
                          <div className="h-16 rounded-[0.95rem] bg-[var(--color-surface-secondary)] animate-pulse" />
                        </div>
                        <div className="h-16 rounded-[0.95rem] bg-[var(--color-surface-secondary)] animate-pulse" />
                      </div>
                    </div>
                  )}
                </div>
                <div className="mt-auto px-5 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={onClose}
                      className="px-3 py-1.5 rounded-xl border border-[var(--color-border-subtle)] text-[12px] font-medium text-[var(--color-text-secondary)] bg-[var(--color-surface-secondary)]/72 hover:bg-[var(--color-surface-raised)]"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSave()}
                      disabled={isSaving || !draft.title.trim()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--color-accent-soft)] text-[var(--color-accent)] border border-[var(--color-accent)]/15 text-[12px] font-semibold hover:brightness-[0.985] disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {isSaving && <Loader2 size={13} className="animate-spin" />}
                      Save task
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <div
          className="absolute right-1.5 bottom-1.5 h-4 w-4 cursor-se-resize rounded-sm opacity-60 hover:opacity-100"
          onMouseDown={(event) => {
            resizeRef.current = {
              startX: event.clientX,
              startY: event.clientY,
              width: size.width,
              height: size.height,
            };
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <div className="absolute inset-x-1 bottom-1 h-px bg-[var(--color-border)]" />
          <div className="absolute right-1 inset-y-1 w-px bg-[var(--color-border)]" />
        </div>
      </div>
    </div>
  );
}
