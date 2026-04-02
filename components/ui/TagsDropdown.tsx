'use client';

import { useState } from 'react';
import { Check, Pencil, Plus, Trash2 } from 'lucide-react';
import { usePlannerStore } from '@/store/usePlannerStore';

// Preset light colors user can pick from
const COLOR_OPTIONS: { color: string; colorDark: string; label: string }[] = [
  { color: '#d8f2f8', colorDark: '#0891b2', label: 'Cyan' },
  { color: '#fef3c7', colorDark: '#d97706', label: 'Amber' },
  { color: '#e8defa', colorDark: '#7c3aed', label: 'Lilac' },
  { color: '#dbeafe', colorDark: '#2563eb', label: 'Blue' },
  { color: '#ffe3ec', colorDark: '#db2777', label: 'Rose' },
  { color: '#ddf5e8', colorDark: '#15803d', label: 'Sage' },
  { color: '#eef2ff', colorDark: '#4f46e5', label: 'Indigo' },
  { color: '#e8eef5', colorDark: '#64748b', label: 'Slate' },
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
    <div className="flex w-[212px] flex-col">
      {/* Tag list */}
      {!isFormMode && (
        <>
          {/* All / clear filter */}
          <button
            onClick={() => { setActiveTagFilter(null); onClose(); }}
            className={[
              'flex items-center gap-2.5 w-full px-3.5 py-2 text-[13px] text-left rounded-xl transition-colors',
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
            <div key={tag.id} className="group flex items-center gap-2.5 px-1">
              <button
                onClick={() => { setActiveTagFilter(activeTagFilter === tag.id ? null : tag.id); onClose(); }}
                className="flex items-center gap-2.5 flex-1 rounded-xl px-2.5 py-2 text-[13px] text-left cursor-pointer hover:bg-[var(--color-surface-raised)] transition-colors"
              >
                <span
                  className="w-3.5 h-3.5 rounded-full flex-shrink-0 border"
                  style={{ background: tag.color, borderColor: tag.colorDark }}
                />
                <span className="text-[var(--color-text-primary)]">{tag.name}</span>
                {activeTagFilter === tag.id && <Check size={11} className="ml-auto text-[var(--color-accent)]" />}
              </button>
              <button
                onClick={() => startEdit(tag.id)}
                className="ui-icon-button opacity-0 group-hover:opacity-70 hover:!opacity-100"
              >
                <Pencil size={11} strokeWidth={2} />
              </button>
              <button
                onClick={() => deleteTag(tag.id)}
                className="ui-icon-button ui-icon-button--danger opacity-0 group-hover:opacity-70 hover:!opacity-100"
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
            className="flex items-center gap-2.5 w-full rounded-xl px-3.5 py-2 text-[13px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)] transition-colors cursor-pointer"
          >
            <Plus size={12} strokeWidth={2.5} /> New tag
          </button>
        </>
      )}

      {/* Add / Edit form */}
      {isFormMode && (
        <div className="flex flex-col gap-3.5 p-3.5 min-w-[220px]">
          <p className="ui-section-label">
            {mode === 'add' ? 'New tag' : 'Edit tag'}
          </p>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setMode('list'); }}
            placeholder="Tag name…"
            className="ui-input text-[12px]"
          />
          <div className="flex flex-wrap gap-2">
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
              className="ui-chip border"
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
