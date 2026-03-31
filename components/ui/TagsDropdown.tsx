'use client';

import { useRef, useState } from 'react';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { usePlannerStore } from '@/store/usePlannerStore';

// Preset light colors user can pick from
const COLOR_OPTIONS: { color: string; colorDark: string; label: string }[] = [
  { color: '#dbeafe', colorDark: '#3b82f6', label: 'Blue' },
  { color: '#ede9fe', colorDark: '#8b5cf6', label: 'Purple' },
  { color: '#dcfce7', colorDark: '#22c55e', label: 'Green' },
  { color: '#fef9c3', colorDark: '#eab308', label: 'Yellow' },
  { color: '#ffedd5', colorDark: '#f97316', label: 'Orange' },
  { color: '#fce7f3', colorDark: '#ec4899', label: 'Pink' },
  { color: '#cffafe', colorDark: '#06b6d4', label: 'Cyan' },
  { color: '#f1f5f9', colorDark: '#64748b', label: 'Slate' },
];

interface TagsDropdownProps {
  onClose: () => void;
}

type Mode = 'list' | 'add' | { edit: string };

export function TagsDropdown({ onClose }: TagsDropdownProps) {
  const { tags, activeTagFilter, setActiveTagFilter, addTag, updateTag, deleteTag } = usePlannerStore();
  const [mode, setMode] = useState<Mode>('list');
  const [name, setName] = useState('');
  const [pickedColor, setPickedColor] = useState(COLOR_OPTIONS[0]);

  const startEdit = (id: string) => {
    const tag = tags.find((t) => t.id === id);
    if (!tag) return;
    setName(tag.name);
    setPickedColor(COLOR_OPTIONS.find((c) => c.color === tag.color) ?? COLOR_OPTIONS[0]);
    setMode({ edit: id });
  };

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (mode === 'add') {
      addTag({ name: trimmed, color: pickedColor.color, colorDark: pickedColor.colorDark });
    } else if (typeof mode === 'object') {
      updateTag(mode.edit, { name: trimmed, color: pickedColor.color, colorDark: pickedColor.colorDark });
    }
    setName('');
    setPickedColor(COLOR_OPTIONS[0]);
    setMode('list');
  };

  const isFormMode = mode === 'add' || typeof mode === 'object';

  return (
    <div className="flex flex-col w-max">
      {/* Tag list */}
      {!isFormMode && (
        <>
          {/* All / clear filter */}
          <button
            onClick={() => { setActiveTagFilter(null); onClose(); }}
            className={[
              'flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-left transition-colors',
              activeTagFilter === null
                ? 'font-semibold text-[var(--color-accent)]'
                : 'text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)] cursor-pointer',
            ].join(' ')}
          >
            <span className="w-3 h-3 rounded-full border-2 border-[var(--color-border)] flex-shrink-0" />
            All tasks
            {activeTagFilter === null && <Check size={11} className="ml-auto" />}
          </button>

          <div className="my-1 border-t border-[var(--color-border-subtle)]" />

          {tags.map((tag) => (
            <div key={tag.id} className="group flex items-center gap-2 px-3 py-1.5">
              <button
                onClick={() => { setActiveTagFilter(activeTagFilter === tag.id ? null : tag.id); onClose(); }}
                className="flex items-center gap-2 flex-1 text-[12px] text-left cursor-pointer"
              >
                <span
                  className="w-3 h-3 rounded-full flex-shrink-0 border"
                  style={{ background: tag.color, borderColor: tag.colorDark }}
                />
                <span className="text-[var(--color-text-primary)]">{tag.name}</span>
                {activeTagFilter === tag.id && <Check size={11} className="ml-auto text-[var(--color-accent)]" />}
              </button>
              <button
                onClick={() => startEdit(tag.id)}
                className="opacity-0 group-hover:opacity-60 hover:!opacity-100 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-opacity cursor-pointer"
              >
                <Pencil size={11} strokeWidth={2} />
              </button>
              <button
                onClick={() => deleteTag(tag.id)}
                className="opacity-0 group-hover:opacity-60 hover:!opacity-100 text-[var(--color-text-muted)] hover:text-red-500 transition-opacity cursor-pointer"
              >
                <Trash2 size={11} strokeWidth={2} />
              </button>
            </div>
          ))}

          {tags.length === 0 && (
            <p className="px-3 py-2 text-[11px] text-[var(--color-text-muted)] italic">No tags yet</p>
          )}

          <div className="my-1 border-t border-[var(--color-border-subtle)]" />

          <button
            onClick={() => { setName(''); setPickedColor(COLOR_OPTIONS[0]); setMode('add'); }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)] transition-colors cursor-pointer"
          >
            <Plus size={12} strokeWidth={2.5} /> New tag
          </button>
        </>
      )}

      {/* Add / Edit form */}
      {isFormMode && (
        <div className="flex flex-col gap-3 p-3 min-w-[200px]">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
            {mode === 'add' ? 'New tag' : 'Edit tag'}
          </p>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setMode('list'); }}
            placeholder="Tag name…"
            className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)] text-[12px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
          />
          <div className="flex flex-wrap gap-1.5">
            {COLOR_OPTIONS.map((opt) => (
              <button
                key={opt.color}
                onClick={() => setPickedColor(opt)}
                title={opt.label}
                className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 cursor-pointer"
                style={{
                  background: opt.color,
                  borderColor: pickedColor.color === opt.color ? opt.colorDark : 'transparent',
                  boxShadow: pickedColor.color === opt.color ? `0 0 0 1px ${opt.colorDark}` : 'none',
                }}
              />
            ))}
          </div>
          {/* Preview */}
          <div className="flex items-center gap-1.5">
            <span
              className="px-2.5 py-0.5 rounded-full text-[11px] font-medium border"
              style={{ background: pickedColor.color, borderColor: pickedColor.colorDark, color: pickedColor.colorDark }}
            >
              {name || 'Preview'}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={!name.trim()}
              className="flex-1 px-3 py-1.5 rounded-lg bg-[var(--color-accent)] text-white text-[12px] font-medium hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Save
            </button>
            <button
              onClick={() => setMode('list')}
              className="px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-[12px] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-raised)] transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
