'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Archive, CheckCircle2, ChevronRight, Loader2, Mail, RefreshCw, Sparkles, Tag as TagIcon, Undo2, X } from 'lucide-react';
import * as api from '@/lib/api';
import { usePlannerStore } from '@/store/usePlannerStore';
import type {
  EmailContent,
  EmailTaskSuggestion,
  RecentEmail,
  TaskLocation,
  TextDraftMode,
  TextDraftResponse,
} from '@/types';
import { PopoverField, PopoverInput } from './PopoverField';

type DraftTask = {
  title: string;
  notes: string;
  taskDate: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  tagName: string;
  projectTitle: string;
  targetLocation: Exclude<TaskLocation, 'upcoming'>;
};

type ArchivedEmailState = {
  email: RecentEmail;
  index: number;
  selectedBeforeArchive: string | null;
};

const DEFAULT_WIDTH = 1140;
const DEFAULT_HEIGHT = 700;
const MIN_WIDTH = 900;
const MIN_HEIGHT = 540;

const DRAFT_CONTROL =
  'w-full min-w-0 rounded-[0.95rem] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] transition-all duration-150 placeholder:text-[var(--color-text-muted)] hover:border-[var(--color-border)] hover:bg-[var(--color-surface)] focus:outline-none focus:border-[var(--color-accent)] focus:bg-[var(--color-surface)] focus:shadow-[0_0_0_3px_var(--color-focus-ring)]';
const INLINE_CONTROL =
  'h-11 rounded-[0.95rem] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 text-[13px] text-[var(--color-text-primary)] transition-all duration-150 hover:border-[var(--color-border)] hover:bg-[var(--color-surface)] focus:outline-none focus:border-[var(--color-accent)] focus:bg-[var(--color-surface)] focus:shadow-[0_0_0_3px_var(--color-focus-ring)]';
const CARD_SURFACE =
  'rounded-[1.1rem] border border-[var(--color-border-subtle)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--color-surface)_96%,transparent),color-mix(in_srgb,var(--color-surface-secondary)_92%,var(--color-canvas)_8%))] shadow-[0_18px_36px_rgba(19,23,38,0.08)]';
const PANEL_LABEL = 'ui-section-label';

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
    allDay: false,
    tagName: suggestion?.tagName?.trim() || '',
    projectTitle: suggestion?.projectTitle?.trim() || '',
    targetLocation: 'today',
  };
}

function textDraftToEmailDraft(draft: TextDraftResponse, fallbackTitle = ''): DraftTask {
  return {
    title: draft.title?.trim() || fallbackTitle,
    notes: draft.notes?.trim() || '',
    taskDate: draft.taskDate || '',
    startTime: toLocalTime(draft.startTime),
    endTime: toLocalTime(draft.endTime),
    allDay: Boolean(draft.allDay),
    tagName: '',
    projectTitle: '',
    targetLocation: draft.location === 'myday' && draft.startTime ? 'myday' : 'today',
  };
}

function looksLikeTimedSuggestion(draft: DraftTask): boolean {
  return Boolean(draft.startTime || draft.endTime);
}

function PaneLabel({ children, accent = false }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <span className={`${PANEL_LABEL}${accent ? ' text-[var(--color-accent)]' : ''}`}>
      {children}
    </span>
  );
}

function HeaderIcon() {
  return (
    <div className="pointer-events-none flex h-9 w-9 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--color-accent)_14%,white_86%)] text-[var(--color-accent)] shadow-[0_10px_24px_rgba(93,109,244,0.12)]">
      <Mail size={16} strokeWidth={2.1} />
    </div>
  );
}

function DraftActionButton({
  children,
  active = false,
  disabled = false,
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        'inline-flex h-11 min-w-[120px] items-center justify-center gap-1.5 rounded-[0.95rem] px-3 text-[13px] whitespace-nowrap transition-all',
        active
          ? 'relative overflow-hidden border border-[var(--color-accent)]/25 bg-[var(--color-surface)]/94 font-semibold text-[var(--color-accent)] shadow-[0_8px_18px_rgba(93,109,244,0.08)] hover:brightness-[0.99]'
          : 'border border-[var(--color-border-subtle)] bg-[var(--color-surface)]/92 font-medium text-[var(--color-text-secondary)] shadow-[0_2px_8px_rgba(19,23,38,0.04)] hover:bg-[var(--color-surface-raised)]',
        disabled ? 'opacity-40 cursor-not-allowed' : '',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function EmailPreviewCard({
  email,
  active,
  onClick,
}: {
  email: RecentEmail;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'w-full text-left px-4 py-3 transition-all',
        CARD_SURFACE,
        active
          ? 'border-[var(--color-accent)] ring-1 ring-[var(--color-accent)] shadow-[0_22px_42px_rgba(93,109,244,0.16)]'
          : 'hover:border-[var(--color-border)] hover:shadow-[0_20px_38px_rgba(19,23,38,0.14)]',
      ].join(' ')}
    >
      <div className="flex justify-end">
        <span className="text-[11px] whitespace-nowrap text-[var(--color-text-muted)]">
          {format(parseISO(email.receivedAt), 'p')}
        </span>
      </div>
      <div className="mt-1 text-[13px] font-medium leading-5 tracking-tight text-[var(--color-text-primary)] line-clamp-3">
        {email.subject || '(No subject)'}
      </div>
      <div className="mt-1.5 text-[11px] text-[var(--color-text-muted)] line-clamp-1">
        {email.sender || email.receivers[0] || 'Unknown sender'}
      </div>
      <div className="mt-1.5 text-[12px] leading-5 text-[var(--color-text-muted)] line-clamp-2">
        {email.snippet}
      </div>
    </button>
  );
}

export function EmailToTaskPanelV2({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const addTask = usePlannerStore((s) => s.addTask);
  const updateTask = usePlannerStore((s) => s.updateTask);
  const setTaskTag = usePlannerStore((s) => s.setTaskTag);
  const viewMode = usePlannerStore((s) => s.viewMode);
  const applyOptimisticGoogleEntry = usePlannerStore((s) => s.applyOptimisticGoogleEntry);
  const applyOptimisticGoogleAllDayEvent = usePlannerStore((s) => s.applyOptimisticGoogleAllDayEvent);
  const tags = usePlannerStore((s) => s.tags);
  const projects = usePlannerStore((s) => s.projects);
  const currentDate = usePlannerStore((s) => s.currentDate);

  const [emails, setEmails] = useState<RecentEmail[]>([]);
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [selectedEmail, setSelectedEmail] = useState<EmailContent | null>(null);
  const [draft, setDraft] = useState<DraftTask>(() => suggestionToDraft(null));
  const [draftMode, setDraftMode] = useState<TextDraftMode>('event');
  const [extraInstruction, setExtraInstruction] = useState('');
  const [isLoadingEmails, setIsLoadingEmails] = useState(false);
  const [isLoadingEmail, setIsLoadingEmail] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [isUndoingArchive, setIsUndoingArchive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [archivedEmail, setArchivedEmail] = useState<ArchivedEmailState | null>(null);

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
  const timezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    [],
  );
  const showTimeFields = useMemo(
    () =>
      draftMode === 'event'
        ? !draft.allDay
        : draft.targetLocation === 'myday' || looksLikeTimedSuggestion(draft),
    [draft, draftMode],
  );

  const loadEmails = useCallback(async () => {
    setIsLoadingEmails(true);
    setError(null);
    setSuccessMessage(null);
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
    setSuccessMessage(null);
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
    setSuccessMessage(null);
    try {
      if (draftMode === 'task') {
        const suggestion = await api.suggestTaskFromEmail(selectedEmailId, {
          promptAddition: extraInstruction,
          currentDate,
          currentDateTime: new Date().toISOString(),
          currentView: api.normalizeExecutionView(viewMode),
          timezone,
        });
        const fallbackTitle = selectedEmail?.subject ? quickFollowUpTitle(selectedEmail.subject) : '';
        setDraft(suggestionToDraft(suggestion, fallbackTitle));
        return;
      }

      if (!selectedEmail) return;

      const promptText = [
        `Subject: ${selectedEmail.subject || '(No subject)'}`,
        '',
        selectedEmail.body || '',
        extraInstruction.trim() ? `\nFocus: ${extraInstruction.trim()}` : '',
      ]
        .join('\n')
        .trim();

      const eventDraft = await api.suggestTextDraft({
        text: promptText,
        mode: 'event',
        currentDate,
        currentDateTime: new Date().toISOString(),
        currentView: api.normalizeExecutionView(viewMode),
        timezone,
      });
      const fallbackTitle = selectedEmail.subject?.trim() || 'New event';
      setDraft(textDraftToEmailDraft(eventDraft, fallbackTitle));
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to generate ${draftMode} suggestion`);
    } finally {
      setIsSuggesting(false);
    }
  }, [currentDate, draftMode, extraInstruction, selectedEmail, selectedEmailId, timezone, viewMode]);

  const handleQuickFollowUp = useCallback(() => {
    if (!selectedEmail) return;
    setDraft((prev) => ({
      ...prev,
      title: quickFollowUpTitle(selectedEmail.subject),
      allDay: false,
    }));
    setError(null);
    setSuccessMessage(null);
  }, [selectedEmail]);

  const handleSave = useCallback(async () => {
    const title = draft.title.trim();
    if (!title) {
      setError('Title is required');
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);
    try {
      if (draftMode === 'event') {
        const eventDate = draft.taskDate || currentDate;
        const notes = draft.notes.trim() || undefined;

        if (draft.allDay || (!draft.startTime && !draft.endTime)) {
          const created = await api.createGoogleAllDayEvent({
            title,
            date: eventDate,
            notes,
          });
          applyOptimisticGoogleAllDayEvent(created);
          setSuccessMessage('Event created');
          return;
        }

        const created = await api.createGoogleTimedEvent({
          title,
          date: eventDate,
          startTime: draft.startTime || '14:00',
          endTime: draft.endTime || '15:00',
          notes,
          tz: timezone,
        });
        applyOptimisticGoogleEntry(created);
        setSuccessMessage('Event created');
        return;
      }

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
      setSuccessMessage('Task created');
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to save ${draftMode}`);
    } finally {
      setIsSaving(false);
    }
  }, [
    addTask,
    applyOptimisticGoogleAllDayEvent,
    applyOptimisticGoogleEntry,
    currentDate,
    draft,
    draftMode,
    projects,
    setTaskTag,
    tags,
    timezone,
    updateTask,
  ]);

  const handleArchive = useCallback(async () => {
    if (!selectedListItem || isArchiving) return;
    setIsArchiving(true);
    setError(null);
    setSuccessMessage(null);
    try {
      await api.archiveEmail(selectedListItem.id);

      const archivedId = selectedListItem.id;
      setEmails((prev) => {
        const index = prev.findIndex((email) => email.id === archivedId);
        if (index === -1) return prev;
        const nextEmails = prev.filter((email) => email.id !== archivedId);
        setArchivedEmail({
          email: prev[index],
          index,
          selectedBeforeArchive: archivedId,
        });

        const fallback = nextEmails[index] ?? nextEmails[index - 1] ?? null;
        setSelectedEmailId(fallback?.id ?? null);
        if (!fallback) setSelectedEmail(null);
        return nextEmails;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to archive email');
    } finally {
      setIsArchiving(false);
    }
  }, [isArchiving, selectedListItem]);

  const handleUndoArchive = useCallback(async () => {
    if (!archivedEmail || isUndoingArchive) return;
    setIsUndoingArchive(true);
    setError(null);
    setSuccessMessage(null);
    try {
      await api.unarchiveEmail(archivedEmail.email.id);
      setEmails((prev) => {
        const next = [...prev];
        const insertIndex = Math.max(0, Math.min(archivedEmail.index, next.length));
        next.splice(insertIndex, 0, archivedEmail.email);
        return next;
      });
      setSelectedEmailId(archivedEmail.email.id);
      setArchivedEmail(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to undo archive');
    } finally {
      setIsUndoingArchive(false);
    }
  }, [archivedEmail, isUndoingArchive]);

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
          className="flex items-center justify-between px-5 py-2.5 border-b border-[var(--color-popover-border)]/80 cursor-move select-none"
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
            <HeaderIcon />
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
            gridTemplateColumns: '256px minmax(460px,1fr) 312px',
          }}
        >
          <div className="flex min-h-0 flex-col border-r border-[var(--color-popover-border)]/65 bg-[var(--color-surface-secondary)]/42">
            <div className="flex items-center justify-between gap-2 px-5 pt-3 pb-2">
              <PaneLabel>Inbox</PaneLabel>
              <div className="flex items-center gap-1.5">
                {archivedEmail && (
                  <button
                    type="button"
                    onClick={() => void handleUndoArchive()}
                    disabled={isUndoingArchive}
                    className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2.5 text-[11px] font-medium text-[var(--color-text-secondary)] shadow-[0_2px_8px_rgba(19,23,38,0.04)] hover:bg-[var(--color-surface-raised)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isUndoingArchive ? <Loader2 size={12} className="animate-spin" /> : <Undo2 size={12} strokeWidth={2.1} />}
                    Undo
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleArchive()}
                  disabled={!selectedListItem || isArchiving}
                  title="Archive selected email"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface)] text-[var(--color-text-muted)] shadow-[0_2px_8px_rgba(19,23,38,0.04)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isArchiving ? <Loader2 size={12} className="animate-spin" /> : <Archive size={13} strokeWidth={2.1} />}
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-4 pt-1 pb-4">
              {isLoadingEmails ? (
                <div className="space-y-3">
                  {[0, 1, 2].map((index) => (
                    <div key={index} className={`${CARD_SURFACE} px-4 py-3.5`}>
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
                <div className="space-y-2.5">
                  {emails.map((email) => {
                    return (
                      <EmailPreviewCard
                        key={email.id}
                        email={email}
                        active={email.id === selectedEmailId}
                        onClick={() => setSelectedEmailId(email.id)}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="min-h-0 flex flex-col px-6 pt-3 pb-4">
            {isLoadingEmail ? (
              <div className="space-y-3">
                <div>
                  <div className="h-3 w-28 rounded bg-[var(--color-surface-raised)] animate-pulse" />
                  <div className="mt-2 h-9 max-w-[460px] rounded-[0.95rem] bg-[var(--color-surface)]/82 animate-pulse" />
                </div>
                <div className="rounded-[1.2rem] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--color-surface)_94%,white_6%),color-mix(in_srgb,var(--color-surface-secondary)_88%,var(--color-canvas)_12%))] px-5 py-4 shadow-[0_20px_44px_rgba(19,23,38,0.16)] ring-1 ring-[color-mix(in_srgb,var(--color-border)_72%,white_28%)] backdrop-blur-[12px]">
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
                  <PaneLabel>Focus</PaneLabel>
                  <div className="mt-2 flex items-center gap-2 rounded-[1rem] border border-[color-mix(in_srgb,var(--color-border)_72%,white_28%)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--color-surface)_88%,white_12%),color-mix(in_srgb,var(--color-surface-secondary)_90%,var(--color-canvas)_10%))] px-3 py-2 shadow-[0_10px_24px_rgba(19,23,38,0.06)]">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--color-accent)_12%,white_88%)] text-[var(--color-accent)]">
                      <Sparkles size={13} strokeWidth={2} />
                    </div>
                    <input
                      type="text"
                      value={extraInstruction}
                      onChange={(event) => setExtraInstruction(event.target.value)}
                      placeholder="Optional: focus on one specific action, deadline, or follow-up..."
                      className="w-full bg-transparent text-[13px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none"
                    />
                  </div>
                </div>
                <div className="min-h-0 flex-1 rounded-[1.2rem] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--color-surface)_94%,white_6%),color-mix(in_srgb,var(--color-surface-secondary)_88%,var(--color-canvas)_12%))] px-5 py-4 shadow-[0_20px_44px_rgba(19,23,38,0.16)] ring-1 ring-[color-mix(in_srgb,var(--color-border)_72%,white_28%)] backdrop-blur-[12px]">
                  <div className="min-h-0 h-full overflow-y-auto">
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

          <div className="min-h-0 border-l border-[var(--color-popover-border)]/65 flex flex-col bg-[linear-gradient(180deg,color-mix(in_srgb,var(--color-surface)_96%,white_4%),color-mix(in_srgb,var(--color-surface-secondary)_92%,var(--color-canvas)_8%))]">
            <div className="border-b border-[var(--color-popover-border)]/55 px-4 pt-3 pb-3">
              <div className="flex items-center justify-between gap-2">
                <PaneLabel accent>{draftMode === 'event' ? 'Event Draft' : 'Task Draft'}</PaneLabel>
                <div className="inline-flex rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-0.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                  {(['event', 'task'] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setDraftMode(value)}
                      className={[
                        'rounded-full px-2.5 py-1 text-[11px] font-medium capitalize transition-all',
                        draftMode === value
                          ? 'bg-[var(--color-canvas)] text-[var(--color-text-primary)] shadow-[0_1px_2px_rgba(15,23,42,0.08)]'
                          : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]',
                      ].join(' ')}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-[7px] flex items-center gap-1.5">
                {draftMode === 'task' && (
                  <DraftActionButton onClick={handleQuickFollowUp} disabled={!selectedEmail}>
                    Follow-up
                  </DraftActionButton>
                )}
                <DraftActionButton onClick={() => void handleSuggest()} active disabled={!selectedEmailId || isSuggesting}>
                  {isSuggesting ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} strokeWidth={2} />}
                  Suggest
                </DraftActionButton>
              </div>
            </div>
            <>
                <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-3 flex flex-col gap-3 relative">
                  <PopoverField label="Title">
                    <PopoverInput
                      value={draft.title}
                      onChange={(value) => setDraft((prev) => ({ ...prev, title: value }))}
                      placeholder={draftMode === 'event' ? 'Suggested event title' : 'Suggested task title'}
                      className={DRAFT_CONTROL}
                    />
                  </PopoverField>
                  <PopoverField label="Notes">
                    <PopoverInput
                      value={draft.notes}
                      onChange={(value) => setDraft((prev) => ({ ...prev, notes: value }))}
                      placeholder={draftMode === 'event' ? 'Optional event notes' : 'Optional task notes'}
                      multiline
                      minHeight={124}
                      className={`${DRAFT_CONTROL} min-h-[124px]`}
                    />
                  </PopoverField>
                  <div className={`grid ${draftMode === 'event' ? 'grid-cols-1' : 'grid-cols-[minmax(0,1fr)_122px]'} gap-2.5`}>
                    <PopoverField label="Date">
                      <input
                        type="date"
                        value={draft.taskDate}
                        onChange={(event) => setDraft((prev) => ({ ...prev, taskDate: event.target.value }))}
                        className={`${INLINE_CONTROL} w-full`}
                      />
                    </PopoverField>
                    {draftMode === 'task' && (
                      <PopoverField label="Create In">
                        <select
                          value={draft.targetLocation}
                          onChange={(event) =>
                            setDraft((prev) => ({
                              ...prev,
                              targetLocation: event.target.value as DraftTask['targetLocation'],
                            }))}
                          className={`${INLINE_CONTROL} w-full`}
                        >
                          <option value="today">Today</option>
                          <option value="myday">My Day</option>
                          <option value="backlog">Backlog</option>
                          <option value="project">Project</option>
                        </select>
                      </PopoverField>
                    )}
                  </div>
                  {showTimeFields ? (
                    <div className="grid grid-cols-2 gap-2.5">
                      <input
                        type="time"
                        aria-label="Start time"
                        value={draft.startTime}
                        onChange={(event) =>
                          setDraft((prev) => ({
                            ...prev,
                            startTime: event.target.value,
                            allDay: false,
                          }))}
                        className={`${INLINE_CONTROL} w-full`}
                      />
                      <input
                        type="time"
                        aria-label="End time"
                        value={draft.endTime}
                        onChange={(event) =>
                          setDraft((prev) => ({
                            ...prev,
                            endTime: event.target.value,
                            allDay: false,
                          }))}
                        className={`${INLINE_CONTROL} w-full`}
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        setDraft((prev) => ({
                          ...prev,
                          allDay: false,
                          startTime: prev.startTime || '09:00',
                          endTime: prev.endTime || '10:00',
                        }))}
                      className="self-start rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface)]/92 px-3 py-1.5 text-[12px] font-medium text-[var(--color-text-muted)] shadow-[0_2px_8px_rgba(19,23,38,0.04)] hover:bg-[var(--color-surface-secondary)]"
                    >
                      Add time
                    </button>
                  )}
                  {draftMode === 'task' && (
                    <PopoverField label="Project">
                    <div className={`${INLINE_CONTROL} flex items-center gap-2 px-2.5`} ref={tagPickerRef}>
                      <div className="relative min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => setTagPickerOpen(false)}
                          className="flex w-full items-center gap-2 rounded-[0.8rem] px-1 py-0.5 text-left"
                        >
                          <span
                            className="inline-flex max-w-full items-center gap-2 rounded-full border px-2.5 py-1 text-[12px] font-medium shadow-[0_1px_2px_rgba(15,23,42,0.03)] truncate"
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
                            <span className={`truncate ${selectedProject ? '' : 'text-[var(--color-text-muted)] font-normal'}`}>{selectedProject ? selectedProject.title : 'Select'}</span>
                          </span>
                          <ChevronRight size={12} strokeWidth={2} className="ml-auto text-[var(--color-text-muted)]" />
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
                      <div className="h-7 w-px bg-[var(--color-border-subtle)]" />
                      <div className="relative shrink-0">
                        <button
                          type="button"
                          title="Tag"
                          onClick={() => setTagPickerOpen((open) => !open)}
                          className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-surface-secondary)]/72 hover:bg-[var(--color-surface-secondary)]"
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
                  </PopoverField>
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
                <div className="mt-auto border-t border-[var(--color-popover-border)]/45 bg-[var(--color-surface-secondary)]/22 px-4 pt-3.5 pb-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-h-[18px] text-[12px] text-[var(--color-text-muted)]">
                      {successMessage && !error ? (
                        <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300">
                          <CheckCircle2 size={14} />
                          {successMessage}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={onClose}
                      className="px-3 py-1.5 rounded-xl border border-[var(--color-border-subtle)] text-[12px] font-medium text-[var(--color-text-secondary)] bg-[var(--color-surface)]/92 hover:bg-[var(--color-surface-raised)]"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSave()}
                      disabled={isSaving || !draft.title.trim()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--color-accent-soft)] text-[var(--color-accent)] border border-[var(--color-accent)]/15 text-[12px] font-semibold hover:brightness-[0.985] disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {isSaving ? <Loader2 size={13} className="animate-spin" /> : successMessage && !error ? <CheckCircle2 size={13} /> : null}
                      {successMessage && !error
                        ? draftMode === 'event'
                          ? 'Event created'
                          : 'Task created'
                        : draftMode === 'event'
                          ? 'Save event'
                          : 'Save task'}
                    </button>
                    </div>
                  </div>
                </div>
              </>
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
