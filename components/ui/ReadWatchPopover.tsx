'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { BookOpen, Clapperboard, GripVertical, Sparkles, Trash2, X } from 'lucide-react';
import { usePlannerStore } from '@/store/usePlannerStore';
import * as api from '@/lib/api';
import type { MediaItem, MediaKind, MediaStatus, WatchSearchResult } from '@/types';

function stopInputShortcutPropagation(event: React.KeyboardEvent<HTMLInputElement>) {
  event.stopPropagation();
}

function mediaStatusLabel(kind: MediaKind, status: MediaStatus) {
  if (status === 'finished') return 'Finished';
  if (status === 'in_progress') return kind === 'read' ? 'Reading' : 'Watching';
  return kind === 'read' ? 'To read' : 'To watch';
}

function formatAddedDate(value: string) {
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatResultType(type: string) {
  return type === 'tv_series' ? 'TV' : 'Movie';
}

function SortableMediaRow({
  item,
  expanded,
  onToggleExpanded,
  onLookupStreaming,
  lookupLoading,
}: {
  item: MediaItem;
  expanded: boolean;
  onToggleExpanded: () => void;
  onLookupStreaming: () => void;
  lookupLoading: boolean;
}) {
  const updateMediaItem = usePlannerStore((s) => s.updateMediaItem);
  const deleteMediaItem = usePlannerStore((s) => s.deleteMediaItem);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={[
        'rounded-[1.15rem] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 transition',
        isDragging ? 'opacity-60 shadow-[0_10px_24px_rgba(15,23,42,0.08)]' : '',
      ].join(' ')}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="ui-icon-button mt-0.5 !h-6 !w-6 flex-shrink-0 cursor-grab active:cursor-grabbing text-[var(--color-text-muted)]"
          aria-label="Reorder item"
        >
          <GripVertical size={12} strokeWidth={2.1} />
        </button>
        <button
          type="button"
          onClick={onToggleExpanded}
          className="min-w-0 flex-1 text-left"
        >
          <div className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">
            {item.title}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
            <span>{formatAddedDate(item.dateAdded)}</span>
            {item.recommendedBy ? <span>by {item.recommendedBy}</span> : null}
          </div>
          {item.kind === 'watch' && (
            <div className="mt-2 flex min-h-6 flex-wrap items-center gap-1.5">
              {item.streamingOn?.length
                ? item.streamingOn.map((provider) => (
                  <span
                    key={provider}
                    className="rounded-full border border-[var(--color-border)] bg-[var(--color-canvas)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-secondary)]"
                  >
                    {provider}
                  </span>
                ))
                : item.streamingCheckedAt
                  ? (
                    <span className="text-[10px] text-[var(--color-text-muted)]">
                      No free streaming available
                    </span>
                  )
                  : null}
            </div>
          )}
        </button>
        {item.kind === 'watch' && (
          <button
            type="button"
            onClick={onLookupStreaming}
            className="ui-icon-button !h-6 !w-6 flex-shrink-0 text-[var(--color-text-muted)] hover:text-[var(--color-accent)]"
            aria-label="Find streaming services"
            title="Find streaming services"
          >
            <Sparkles size={11} strokeWidth={2.1} className={lookupLoading ? 'animate-pulse' : ''} />
          </button>
        )}
        <button
          type="button"
          onClick={() => deleteMediaItem(item.id)}
          className="ui-icon-button ui-icon-button--danger !h-6 !w-6 flex-shrink-0"
          aria-label="Delete item"
        >
          <Trash2 size={11} strokeWidth={2.1} />
        </button>
      </div>

      {expanded && (
        <div className="mt-2.5 flex flex-col gap-2.5 border-t border-[var(--color-border)]/70 pt-2.5">
          <input
            value={item.title}
            onChange={(event) => updateMediaItem(item.id, { title: event.target.value })}
            onKeyDown={stopInputShortcutPropagation}
            className="ui-input h-10 text-[13px]"
            placeholder="Title"
          />
          <input
            value={item.recommendedBy ?? ''}
            onChange={(event) => updateMediaItem(item.id, { recommendedBy: event.target.value })}
            onKeyDown={stopInputShortcutPropagation}
            className="ui-input h-10 text-[13px]"
            placeholder="Recommended by"
          />
          <div className="flex flex-wrap gap-2">
            {(['queued', 'in_progress', 'finished'] as const).map((status) => {
              const active = item.status === status;
              return (
                <button
                  key={status}
                  type="button"
                  onClick={() => updateMediaItem(item.id, { status })}
                  className={[
                    'rounded-full border px-3 py-0.5 text-[11px] font-medium transition',
                    active
                      ? 'border-[var(--color-text-primary)] bg-[var(--color-text-primary)] text-white'
                      : 'border-[var(--color-border)] bg-[var(--color-canvas)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
                  ].join(' ')}
                >
                  {mediaStatusLabel(item.kind, status)}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function ReadWatchPopover({
  anchor,
  onClose,
}: {
  anchor: HTMLElement;
  onClose: () => void;
}) {
  void anchor;
  const mediaItems = usePlannerStore((s) => s.mediaItems);
  const addMediaItem = usePlannerStore((s) => s.addMediaItem);
  const updateMediaItem = usePlannerStore((s) => s.updateMediaItem);
  const reorderMediaItems = usePlannerStore((s) => s.reorderMediaItems);

  const [tab, setTab] = useState<MediaKind>('read');
  const [showFinished, setShowFinished] = useState<Record<MediaKind, boolean>>({ read: false, watch: false });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftRecommendedBy, setDraftRecommendedBy] = useState('');
  const [lookupLoadingId, setLookupLoadingId] = useState<string | null>(null);
  const [lookupItemId, setLookupItemId] = useState<string | null>(null);
  const [lookupResults, setLookupResults] = useState<WatchSearchResult[]>([]);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const sortedItems = useMemo(
    () => mediaItems
      .filter((item) => item.kind === tab)
      .sort((a, b) => {
        const rank = (item: MediaItem) => (item.status === 'in_progress' ? 0 : item.status === 'queued' ? 1 : 2);
        const rankDiff = rank(a) - rank(b);
        if (rankDiff !== 0) return rankDiff;
        return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
      }),
    [mediaItems, tab],
  );

  const visibleItems = showFinished[tab]
    ? sortedItems
    : sortedItems.filter((item) => item.status !== 'finished');

  const handleAdd = () => {
    if (!draftTitle.trim()) return;
    addMediaItem({
      title: draftTitle.trim(),
      kind: tab,
      recommendedBy: draftRecommendedBy.trim() || undefined,
    });
    setDraftTitle('');
    setDraftRecommendedBy('');
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    reorderMediaItems(tab, String(active.id), String(over.id));
  };

  const closeLookupModal = () => {
    setLookupItemId(null);
    setLookupResults([]);
    setLookupError(null);
  };

  const handleLookupStreaming = async (item: MediaItem) => {
    setLookupLoadingId(item.id);
    setLookupError(null);
    try {
      const results = await api.searchWatchTitles(item.title);
      setLookupItemId(item.id);
      setLookupResults(results);
      if (!results.length) {
        setLookupError('No close matches found.');
      }
    } catch (error) {
      console.error('[searchWatchTitles]', error);
      setLookupItemId(item.id);
      setLookupResults([]);
      setLookupError('Could not search streaming titles right now.');
    } finally {
      setLookupLoadingId(null);
    }
  };

  const handleSelectLookupResult = async (item: MediaItem, result: WatchSearchResult) => {
    setLookupLoadingId(item.id);
    setLookupError(null);
    try {
      const providers = await api.getWatchStreamingSources(result.id);
      updateMediaItem(item.id, {
        title: result.displayTitle,
        watchmodeId: result.id,
        streamingOn: providers,
        streamingCheckedAt: new Date().toISOString(),
      });
      closeLookupModal();
    } catch (error) {
      console.error('[getWatchStreamingSources]', error);
      setLookupError('Could not fetch streaming providers right now.');
    } finally {
      setLookupLoadingId(null);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[140] flex items-start justify-center bg-[rgba(19,23,38,0.12)] px-6 pb-8 pt-10 backdrop-blur-[2px]"
      onMouseDown={onClose}
    >
      <div
        className="relative flex h-[min(82vh,760px)] w-[min(58rem,92vw)] flex-col overflow-hidden rounded-[2rem] border border-[var(--color-border)] bg-[var(--color-canvas)] ui-raised-surface"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-5">
          <div className="flex items-center gap-4">
            <div className="flex h-[3.35rem] w-[3.35rem] items-center justify-center rounded-[1.35rem] bg-[var(--color-accent-subtle)] text-[var(--color-accent)] shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]">
              <div className="relative h-5 w-5">
                <BookOpen size={16} strokeWidth={2.05} className="absolute left-[-1px] top-[1px]" />
                <Clapperboard size={14} strokeWidth={2.05} className="absolute bottom-[-1px] right-[-2px]" />
              </div>
            </div>
            <div>
              <div className="text-[1.05rem] font-semibold tracking-tight text-[var(--color-text-primary)]">
                Read & Watch
              </div>
              <div className="mt-0.5 text-[13px] text-[var(--color-text-muted)]">
                Keep recommendations in one place and sort them your way
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="ui-icon-button"
            aria-label="Close"
          >
            <X size={14} strokeWidth={2.5} />
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-5 overflow-hidden px-6 py-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5">
              {([
                { kind: 'read' as const, label: 'Read', icon: BookOpen },
                { kind: 'watch' as const, label: 'Watch', icon: Clapperboard },
              ]).map(({ kind, label, icon: Icon }) => {
                const active = tab === kind;
                return (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => {
                      setTab(kind);
                      setExpandedId(null);
                    }}
                    className={[
                      'inline-flex h-11 min-w-[128px] items-center justify-center gap-2 rounded-full px-4 text-[13px] font-medium transition',
                      active
                        ? 'bg-[var(--color-canvas)] text-[var(--color-text-primary)] shadow-[0_1px_2px_rgba(15,23,42,0.08)]'
                        : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]',
                    ].join(' ')}
                  >
                    <Icon size={13} strokeWidth={2} />
                    {label}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setShowFinished((current) => ({ ...current, [tab]: !current[tab] }))}
              className="text-[12px] text-[var(--color-text-muted)] transition hover:text-[var(--color-text-secondary)]"
            >
              {showFinished[tab] ? 'Hide finished' : 'Show finished'}
            </button>
          </div>

          <div className="rounded-[1.65rem] border border-[var(--color-border)] bg-[var(--color-surface)] p-3.5">
            <div className="grid grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_auto] gap-3">
              <input
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.target.value)}
                onKeyDown={stopInputShortcutPropagation}
                className="ui-input h-10 text-[13px]"
                placeholder={tab === 'read' ? 'Add a book, article, or paper' : 'Add a movie or show'}
              />
              <input
                value={draftRecommendedBy}
                onChange={(event) => setDraftRecommendedBy(event.target.value)}
                onKeyDown={stopInputShortcutPropagation}
                className="ui-input h-10 text-[13px]"
                placeholder="Recommended by"
              />
              <button
                type="button"
                onClick={handleAdd}
                disabled={!draftTitle.trim()}
                className="rounded-[1rem] border border-[var(--color-accent)]/18 bg-[var(--color-accent-soft)] px-4 text-[13px] font-semibold text-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Add
              </button>
            </div>
          </div>

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={visibleItems.map((item) => item.id)} strategy={verticalListSortingStrategy}>
              <div className="flex flex-1 flex-col gap-2 overflow-y-auto pr-1">
                {visibleItems.length ? (
                  visibleItems.map((item) => (
                    <SortableMediaRow
                      key={item.id}
                      item={item}
                      expanded={expandedId === item.id}
                      onToggleExpanded={() => setExpandedId((current) => current === item.id ? null : item.id)}
                      onLookupStreaming={() => handleLookupStreaming(item)}
                      lookupLoading={lookupLoadingId === item.id}
                    />
                  ))
                ) : (
                  <div className="rounded-[1.65rem] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-6 text-[13px] text-[var(--color-text-muted)]">
                    {tab === 'read'
                      ? 'Nothing in your reading list yet.'
                      : 'Nothing in your watch list yet.'}
                  </div>
                )}
              </div>
            </SortableContext>
          </DndContext>
        </div>

        {lookupItemId && (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center bg-[rgba(19,23,38,0.12)] px-6 py-8 backdrop-blur-[1px]"
            onMouseDown={closeLookupModal}
          >
            <div
              className="flex w-[min(34rem,92vw)] max-h-[min(70vh,34rem)] flex-col overflow-hidden rounded-[1.75rem] border border-[var(--color-border)] bg-[var(--color-canvas)] ui-raised-surface"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
                <div>
                  <div className="text-[0.98rem] font-semibold text-[var(--color-text-primary)]">
                    Select title
                  </div>
                  <div className="mt-0.5 text-[12px] text-[var(--color-text-muted)]">
                    Choose the correct movie or show, then we will fetch subscription streaming providers
                  </div>
                </div>
                <button type="button" onClick={closeLookupModal} className="ui-icon-button" aria-label="Close">
                  <X size={13} strokeWidth={2.5} />
                </button>
              </div>
              <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
                {lookupError && !lookupResults.length ? (
                  <div className="rounded-[1.25rem] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-5 text-[13px] text-[var(--color-text-muted)]">
                    {lookupError}
                  </div>
                ) : (
                  lookupResults.map((result) => {
                    const item = mediaItems.find((entry) => entry.id === lookupItemId);
                    if (!item) return null;
                    return (
                      <button
                        key={result.id}
                        type="button"
                        onClick={() => handleSelectLookupResult(item, result)}
                        className="rounded-[1.2rem] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-left transition hover:border-[var(--color-accent)]/25 hover:bg-[var(--color-surface-raised)]"
                      >
                        <div className="text-[13px] font-medium text-[var(--color-text-primary)]">
                          {result.displayTitle}
                        </div>
                        <div className="mt-1 text-[11px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                          {formatResultType(result.type)}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
