'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  CircleDot,
  Link2,
  Link2Off,
  Loader2,
  LocateFixed,
  Maximize2,
  Minimize2,
  Plus,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import * as api from '@/lib/api';
import {
  MANDALA_CENTER,
  MANDALA_WORLD,
  calculateMandalaLayout,
  descendantsOf,
  mixWithWhite,
  nodeDepth,
  readableTextColor,
  type MandalaEdgeLayout,
  type MandalaNodeLayout,
} from '@/lib/mandalaLayout';
import type { MandalaDocument, MandalaNode } from '@/types';

const DEFAULT_WIDTH = 1220;
const DEFAULT_HEIGHT = 780;
const MIN_WIDTH = 980;
const MIN_HEIGHT = 620;
const PANEL_GAP = 12;
const TILE_SIZE = 104;
const TILE_HALF = TILE_SIZE / 2;
const PALETTE = ['#8B8061', '#D70FA3', '#F2C20C', '#718096', '#078A1B', '#1872DD', '#6357F5', '#E76F51'];

type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

function viewportSize() {
  if (typeof window === 'undefined') return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
  return {
    width: Math.min(DEFAULT_WIDTH, window.innerWidth - PANEL_GAP * 2),
    height: Math.min(DEFAULT_HEIGHT, window.innerHeight - PANEL_GAP * 2),
  };
}

function centeredPosition(size: { width: number; height: number }) {
  if (typeof window === 'undefined') return { x: 90, y: 50 };
  return {
    x: Math.max(PANEL_GAP, Math.round((window.innerWidth - size.width) / 2)),
    y: Math.max(PANEL_GAP, Math.round((window.innerHeight - size.height) / 2)),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function nextSortOrder(nodes: MandalaNode[], parentId: string | null, kind: MandalaNode['kind']) {
  const siblings = nodes.filter((node) => node.kind === kind && node.parentId === parentId);
  return siblings.reduce((highest, node) => Math.max(highest, node.sortOrder), -1) + 1;
}

function branchColor(node: MandalaNode, nodes: MandalaNode[]) {
  const byId = new Map(nodes.map((candidate) => [candidate.id, candidate]));
  let current: MandalaNode | undefined = node;
  while (current?.parentId) current = byId.get(current.parentId);
  return current?.color ?? '#5D6DF4';
}

function subtreeHeight(nodeId: string, nodes: MandalaNode[]): number {
  const children = nodes.filter((node) => node.parentId === nodeId);
  if (children.length === 0) return 1;
  return 1 + Math.max(...children.map((child) => subtreeHeight(child.id, nodes)));
}

function edgePath(edge: MandalaEdgeLayout) {
  const { from, to, axis } = edge;
  if (axis === 'horizontal') {
    const direction = Math.sign(to.x - from.x) || 1;
    const startX = from.x + direction * TILE_HALF;
    const endX = to.x - direction * TILE_HALF;
    const handle = Math.max(28, Math.abs(endX - startX) * 0.42);
    return `M ${startX} ${from.y} C ${startX + direction * handle} ${from.y}, ${endX - direction * handle} ${to.y}, ${endX} ${to.y}`;
  }

  const direction = Math.sign(to.y - from.y) || 1;
  const startY = from.y + direction * TILE_HALF;
  const endY = to.y - direction * TILE_HALF;
  const handle = Math.max(28, Math.abs(endY - startY) * 0.42);
  return `M ${from.x} ${startY} C ${from.x} ${startY + direction * handle}, ${to.x} ${endY - direction * handle}, ${to.x} ${endY}`;
}

function MandalaTile({
  layout,
  nodes,
  selected,
  onSelect,
}: {
  layout: MandalaNodeLayout;
  nodes: MandalaNode[];
  selected: boolean;
  onSelect: () => void;
}) {
  const { node, x, y, depth } = layout;
  const isLoose = node.kind === 'loose';
  const color = isLoose ? '#AAB2C1' : branchColor(node, nodes);
  const background = isLoose
    ? 'color-mix(in srgb, var(--color-surface-raised) 88%, #AAB2C1 12%)'
    : depth === 1
      ? color
      : mixWithWhite(color, depth === 2 ? 0.64 : 0.82);
  const textColor = !isLoose && depth === 1 ? readableTextColor(color) : '#202431';

  return (
    <button
      type="button"
      data-mandala-node
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[0.9rem] px-3 py-2 text-center font-medium leading-[1.12] transition-[transform,box-shadow] duration-150 hover:scale-[1.035] focus:outline-none"
      style={{
        left: x,
        top: y,
        width: TILE_SIZE,
        height: TILE_SIZE,
        background,
        color: textColor,
        fontSize: depth === 1 ? 18 : depth === 2 ? 16 : 14.5,
        whiteSpace: 'pre-line',
        boxShadow: selected
          ? '0 0 0 4px var(--color-focus-ring), 0 12px 26px rgba(19,23,38,0.18)'
          : '5px 7px 16px rgba(19,23,38,0.12), 0 1px 3px rgba(19,23,38,0.08)',
        border: selected ? '2px solid var(--color-accent)' : '1px solid rgba(255,255,255,0.54)',
        zIndex: selected ? 4 : 3,
      }}
      title={`${node.title.replaceAll('\n', ' ')} — click to edit`}
    >
      {node.title}
    </button>
  );
}

export function MandalaPanel({ onClose }: { onClose: () => void }) {
  const initialSize = useMemo(viewportSize, []);
  const [size, setSize] = useState(initialSize);
  const [position, setPosition] = useState(() => centeredPosition(initialSize));
  const [restoreFrame, setRestoreFrame] = useState<{ size: typeof size; position: typeof position } | null>(null);
  const [document, setDocument] = useState<MandalaDocument | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [zoom, setZoom] = useState(0.65);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; x: number; y: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; width: number; height: number } | null>(null);
  const panRef = useRef<{ startX: number; startY: number; x: number; y: number } | null>(null);
  const lastSavedRef = useRef('');
  const saveSequenceRef = useRef(0);

  const maximized = restoreFrame !== null;
  const layout = useMemo(() => document ? calculateMandalaLayout(document) : null, [document]);
  const selectedNode = document?.nodes.find((node) => node.id === selectedId) ?? null;

  const fitView = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const nextZoom = clamp(Math.min((rect.width - 40) / MANDALA_WORLD.width, (rect.height - 40) / MANDALA_WORLD.height), 0.42, 1);
    setZoom(nextZoom);
    setOffset({
      x: (rect.width - MANDALA_WORLD.width * nextZoom) / 2,
      y: (rect.height - MANDALA_WORLD.height * nextZoom) / 2,
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.getMandala()
      .then((nextDocument) => {
        if (cancelled) return;
        setDocument(nextDocument);
        lastSavedRef.current = JSON.stringify(nextDocument);
        setSaveStatus('saved');
        window.requestAnimationFrame(fitView);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Could not load the mandala.');
      });
    return () => { cancelled = true; };
  }, [fitView]);

  const persist = useCallback(async (nextDocument: MandalaDocument, sequence: number) => {
    setSaveStatus('saving');
    try {
      await api.saveMandala(nextDocument);
      if (sequence !== saveSequenceRef.current) return;
      lastSavedRef.current = JSON.stringify(nextDocument);
      setSaveStatus('saved');
    } catch {
      if (sequence === saveSequenceRef.current) setSaveStatus('error');
    }
  }, []);

  useEffect(() => {
    if (!document) return;
    const serialized = JSON.stringify(document);
    if (serialized === lastSavedRef.current) return;
    setSaveStatus('dirty');
    const sequence = ++saveSequenceRef.current;
    const timeout = window.setTimeout(() => void persist(document, sequence), 650);
    return () => window.clearTimeout(timeout);
  }, [document, persist]);

  const closePanel = useCallback(() => {
    if (document && JSON.stringify(document) !== lastSavedRef.current) {
      const sequence = ++saveSequenceRef.current;
      void persist(document, sequence);
    }
    onClose();
  }, [document, onClose, persist]);

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      if (dragRef.current && !maximized) {
        const nextX = dragRef.current.x + event.clientX - dragRef.current.startX;
        const nextY = dragRef.current.y + event.clientY - dragRef.current.startY;
        setPosition({
          x: clamp(nextX, PANEL_GAP, window.innerWidth - size.width - PANEL_GAP),
          y: clamp(nextY, PANEL_GAP, window.innerHeight - size.height - PANEL_GAP),
        });
      }
      if (resizeRef.current && !maximized) {
        setSize({
          width: clamp(resizeRef.current.width + event.clientX - resizeRef.current.startX, MIN_WIDTH, window.innerWidth - position.x - PANEL_GAP),
          height: clamp(resizeRef.current.height + event.clientY - resizeRef.current.startY, MIN_HEIGHT, window.innerHeight - position.y - PANEL_GAP),
        });
      }
      if (panRef.current) {
        setOffset({
          x: panRef.current.x + event.clientX - panRef.current.startX,
          y: panRef.current.y + event.clientY - panRef.current.startY,
        });
      }
    };
    const stop = () => {
      dragRef.current = null;
      resizeRef.current = null;
      panRef.current = null;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePanel();
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', stop);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', stop);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [closePanel, maximized, position.x, position.y, size.height, size.width]);

  useEffect(() => {
    const onResize = () => {
      if (maximized) {
        setPosition({ x: PANEL_GAP, y: PANEL_GAP });
        setSize({ width: window.innerWidth - PANEL_GAP * 2, height: window.innerHeight - PANEL_GAP * 2 });
      } else {
        setSize((current) => ({
          width: Math.min(current.width, window.innerWidth - PANEL_GAP * 2),
          height: Math.min(current.height, window.innerHeight - PANEL_GAP * 2),
        }));
        setPosition((current) => ({
          x: clamp(current.x, PANEL_GAP, window.innerWidth - size.width - PANEL_GAP),
          y: clamp(current.y, PANEL_GAP, window.innerHeight - size.height - PANEL_GAP),
        }));
      }
      window.requestAnimationFrame(fitView);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [fitView, maximized, size.height, size.width]);

  const updateDocument = useCallback((updater: (current: MandalaDocument) => MandalaDocument) => {
    setDocument((current) => current ? updater(current) : current);
  }, []);

  const updateNode = (nodeId: string, fields: Partial<MandalaNode>) => {
    updateDocument((current) => ({
      ...current,
      nodes: current.nodes.map((node) => node.id === nodeId ? { ...node, ...fields } : node),
    }));
  };

  const addMainNode = () => {
    if (!document) return;
    const node: MandalaNode = {
      id: crypto.randomUUID(),
      title: 'New area',
      parentId: null,
      kind: 'connected',
      color: PALETTE[document.nodes.filter((candidate) => candidate.kind === 'connected' && candidate.parentId === null).length % PALETTE.length],
      sortOrder: nextSortOrder(document.nodes, null, 'connected'),
    };
    updateDocument((current) => ({ ...current, nodes: [...current.nodes, node] }));
    setSelectedId(node.id);
  };

  const addLooseNode = () => {
    if (!document) return;
    const node: MandalaNode = {
      id: crypto.randomUUID(),
      title: 'New note',
      parentId: null,
      kind: 'loose',
      sortOrder: nextSortOrder(document.nodes, null, 'loose'),
    };
    updateDocument((current) => ({ ...current, nodes: [...current.nodes, node] }));
    setSelectedId(node.id);
  };

  const addChildNode = () => {
    if (!document || !selectedNode || selectedNode.kind !== 'connected' || nodeDepth(selectedNode.id, document.nodes) >= 3) return;
    const node: MandalaNode = {
      id: crypto.randomUUID(),
      title: 'New tile',
      parentId: selectedNode.id,
      kind: 'connected',
      sortOrder: nextSortOrder(document.nodes, selectedNode.id, 'connected'),
    };
    updateDocument((current) => ({ ...current, nodes: [...current.nodes, node] }));
    setSelectedId(node.id);
  };

  const deleteSelected = () => {
    if (!document || !selectedNode) return;
    const descendants = descendantsOf(selectedNode.id, document.nodes);
    const extra = descendants.size > 0 ? ` and ${descendants.size} connected tile${descendants.size === 1 ? '' : 's'}` : '';
    if (!window.confirm(`Delete “${selectedNode.title.replaceAll('\n', ' ')}”${extra}?`)) return;
    updateDocument((current) => ({
      ...current,
      nodes: current.nodes.filter((node) => node.id !== selectedNode.id && !descendants.has(node.id)),
    }));
    setSelectedId(null);
  };

  const moveSelected = (destination: string) => {
    if (!document || !selectedNode) return;
    if (destination === '__loose__') {
      updateNode(selectedNode.id, {
        kind: 'loose',
        parentId: null,
        sortOrder: nextSortOrder(document.nodes, null, 'loose'),
      });
      return;
    }
    const parentId = destination === '__main__' ? null : destination;
    updateNode(selectedNode.id, {
      kind: 'connected',
      parentId,
      color: parentId === null ? selectedNode.color ?? PALETTE[0] : selectedNode.color,
      sortOrder: nextSortOrder(document.nodes, parentId, 'connected'),
    });
  };

  const toggleMaximize = () => {
    if (maximized && restoreFrame) {
      setSize(restoreFrame.size);
      setPosition(restoreFrame.position);
      setRestoreFrame(null);
    } else {
      setRestoreFrame({ size, position });
      setPosition({ x: PANEL_GAP, y: PANEL_GAP });
      setSize({ width: window.innerWidth - PANEL_GAP * 2, height: window.innerHeight - PANEL_GAP * 2 });
    }
    window.requestAnimationFrame(fitView);
  };

  const adjustZoom = (factor: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const nextZoom = clamp(zoom * factor, 0.35, 1.4);
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const worldX = (centerX - offset.x) / zoom;
    const worldY = (centerY - offset.y) / zoom;
    setZoom(nextZoom);
    setOffset({ x: centerX - worldX * nextZoom, y: centerY - worldY * nextZoom });
  };

  const moveOptions = useMemo(() => {
    if (!document || !selectedNode) return [];
    const blocked = descendantsOf(selectedNode.id, document.nodes);
    const height = subtreeHeight(selectedNode.id, document.nodes);
    return document.nodes
      .filter((candidate) => {
        if (candidate.kind !== 'connected' || candidate.id === selectedNode.id || blocked.has(candidate.id)) return false;
        return nodeDepth(candidate.id, document.nodes) + height <= 3;
      })
      .sort((a, b) => nodeDepth(a.id, document.nodes) - nodeDepth(b.id, document.nodes) || a.sortOrder - b.sortOrder);
  }, [document, selectedNode]);

  return (
    <div className="fixed inset-0 z-[82] pointer-events-none">
      <section
        aria-label="Life Mandala"
        className="pointer-events-auto absolute flex flex-col overflow-hidden rounded-[1.7rem] border border-[var(--color-popover-border)] bg-[var(--color-popover)] shadow-[var(--shadow-floating)]"
        style={{ left: position.x, top: position.y, width: size.width, height: size.height }}
      >
        <header
          className={`flex h-[58px] shrink-0 items-center justify-between border-b border-[var(--color-popover-border)]/75 px-5 ${maximized ? '' : 'cursor-move'}`}
          onMouseDown={(event) => {
            if (maximized || (event.target as HTMLElement).closest('button, input, select')) return;
            dragRef.current = { startX: event.clientX, startY: event.clientY, ...position };
          }}
        >
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--color-accent-subtle)] text-[var(--color-accent)]">
              <CircleDot size={18} strokeWidth={2.1} />
            </span>
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight text-[var(--color-text-primary)]">Life Mandala</h2>
              <p className="text-[11px] text-[var(--color-text-muted)]">A reminder of what keeps life in balance</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="mr-1 flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
              {saveStatus === 'saving' && <><Loader2 size={11} className="animate-spin" /> Saving</>}
              {saveStatus === 'dirty' && <>Unsaved</>}
              {saveStatus === 'saved' && <><Check size={11} /> Saved</>}
              {saveStatus === 'error' && <><AlertCircle size={11} /> Save failed</>}
            </span>
            <button type="button" onClick={toggleMaximize} className="ui-icon-button" title={maximized ? 'Restore window' : 'Maximize'}>
              {maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
            <button type="button" onClick={closePanel} className="ui-icon-button" title="Close">
              <X size={15} strokeWidth={2.4} />
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <div className="relative min-w-0 flex-1 overflow-hidden bg-[radial-gradient(circle_at_center,color-mix(in_srgb,var(--color-accent-subtle)_42%,transparent)_0%,transparent_52%)]">
            <div className="absolute left-4 top-4 z-20 flex items-center gap-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-popover)]/92 p-1 shadow-sm backdrop-blur">
              <button type="button" onClick={addMainNode} className="ui-icon-button" title="Add main area"><Plus size={14} /></button>
              <button type="button" onClick={addLooseNode} className="ui-icon-button" title="Add unconnected note"><Link2Off size={14} /></button>
              <span className="mx-0.5 h-5 w-px bg-[var(--color-border)]" />
              <button type="button" onClick={() => adjustZoom(1.14)} className="ui-icon-button" title="Zoom in"><ZoomIn size={14} /></button>
              <button type="button" onClick={() => adjustZoom(0.86)} className="ui-icon-button" title="Zoom out"><ZoomOut size={14} /></button>
              <button type="button" onClick={fitView} className="ui-icon-button" title="Fit mandala"><LocateFixed size={14} /></button>
            </div>

            <div
              ref={canvasRef}
              className="absolute inset-0 cursor-grab overflow-hidden active:cursor-grabbing"
              onMouseDown={(event) => {
                if ((event.target as HTMLElement).closest('[data-mandala-node]')) return;
                setSelectedId(null);
                panRef.current = { startX: event.clientX, startY: event.clientY, ...offset };
              }}
              onWheel={(event) => {
                event.preventDefault();
                adjustZoom(event.deltaY < 0 ? 1.08 : 0.92);
              }}
            >
              {loadError ? (
                <div className="absolute inset-0 flex items-center justify-center px-8 text-center text-sm text-[var(--color-overdue)]">
                  {loadError}
                </div>
              ) : !document || !layout ? (
                <div className="absolute inset-0 flex items-center justify-center text-[var(--color-text-muted)]">
                  <Loader2 size={22} className="animate-spin" />
                </div>
              ) : (
                <div
                  className="absolute left-0 top-0 origin-top-left"
                  style={{
                    width: MANDALA_WORLD.width,
                    height: MANDALA_WORLD.height,
                    transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
                  }}
                >
                  <svg className="absolute inset-0 z-[1] overflow-visible" width={MANDALA_WORLD.width} height={MANDALA_WORLD.height} aria-hidden="true">
                    <circle cx={MANDALA_CENTER.x} cy={MANDALA_CENTER.y} r={205} fill="none" stroke="var(--color-border)" strokeWidth="1.25" strokeDasharray="4 10" opacity="0.46" />
                    {layout.edges.map((edge) => (
                      <path key={edge.id} d={edgePath(edge)} fill="none" stroke={edge.color} strokeWidth="2" strokeLinecap="round" opacity="0.5" />
                    ))}
                  </svg>

                  <button
                    type="button"
                    data-mandala-node
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedId('__center__');
                    }}
                    className="absolute z-[3] flex h-[104px] w-[104px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[0.95rem] border border-white/15 bg-[#454B56] px-3 text-center text-[15px] font-semibold text-white shadow-[5px_8px_20px_rgba(19,23,38,0.22)]"
                    style={{ left: MANDALA_CENTER.x, top: MANDALA_CENTER.y }}
                  >
                    {document.centerTitle}
                  </button>

                  {layout.nodes.map((nodeLayout) => (
                    <MandalaTile
                      key={nodeLayout.node.id}
                      layout={nodeLayout}
                      nodes={document.nodes}
                      selected={selectedId === nodeLayout.node.id}
                      onSelect={() => setSelectedId(nodeLayout.node.id)}
                    />
                  ))}

                  {layout.looseNodes.length > 0 && (
                    <div className="absolute left-[1110px] top-[1350px] z-[2] flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
                      <Link2Off size={13} /> Loose notes
                    </div>
                  )}
                  {layout.looseNodes.map((nodeLayout) => (
                    <MandalaTile
                      key={nodeLayout.node.id}
                      layout={nodeLayout}
                      nodes={document.nodes}
                      selected={selectedId === nodeLayout.node.id}
                      onSelect={() => setSelectedId(nodeLayout.node.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          <aside className="w-[286px] shrink-0 overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-surface-secondary)]/55 px-5 py-5">
            {!document ? (
              <div className="flex justify-center py-12"><Loader2 size={18} className="animate-spin text-[var(--color-text-muted)]" /></div>
            ) : selectedId === '__center__' ? (
              <div className="space-y-5">
                <div>
                  <p className="ui-section-label">CENTER</p>
                  <h3 className="mt-1 text-base font-semibold text-[var(--color-text-primary)]">Your mandala</h3>
                </div>
                <label className="block text-[12px] font-medium text-[var(--color-text-secondary)]">
                  Center title
                  <input
                    className="ui-input mt-2"
                    value={document.centerTitle}
                    maxLength={80}
                    onChange={(event) => updateDocument((current) => ({ ...current, centerTitle: event.target.value || ' ' }))}
                  />
                </label>
              </div>
            ) : selectedNode ? (
              <div className="space-y-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="ui-section-label">EDIT TILE</p>
                    <h3 className="mt-1 text-base font-semibold text-[var(--color-text-primary)]">
                      {selectedNode.kind === 'loose' ? 'Unconnected note' : `Level ${nodeDepth(selectedNode.id, document.nodes)}`}
                    </h3>
                  </div>
                  <button type="button" onClick={deleteSelected} className="ui-icon-button ui-icon-button--danger" title="Delete tile"><Trash2 size={14} /></button>
                </div>

                <label className="block text-[12px] font-medium text-[var(--color-text-secondary)]">
                  Title
                  <textarea
                    className="ui-input mt-2 min-h-[84px] resize-none"
                    value={selectedNode.title}
                    maxLength={120}
                    autoFocus
                    onChange={(event) => updateNode(selectedNode.id, { title: event.target.value || ' ' })}
                  />
                </label>

                <label className="block text-[12px] font-medium text-[var(--color-text-secondary)]">
                  Place in
                  <select
                    className="ui-input mt-2"
                    value={selectedNode.kind === 'loose' ? '__loose__' : selectedNode.parentId ?? '__main__'}
                    onChange={(event) => moveSelected(event.target.value)}
                  >
                    <option value="__main__">Main circle</option>
                    <option value="__loose__">Unconnected notes</option>
                    {moveOptions.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {'—'.repeat(nodeDepth(candidate.id, document.nodes) - 1)} {candidate.title.replaceAll('\n', ' ')}
                      </option>
                    ))}
                  </select>
                </label>

                {selectedNode.kind === 'connected' && nodeDepth(selectedNode.id, document.nodes) === 1 && (
                  <div>
                    <p className="text-[12px] font-medium text-[var(--color-text-secondary)]">Branch color</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {PALETTE.map((color) => (
                        <button
                          key={color}
                          type="button"
                          onClick={() => updateNode(selectedNode.id, { color })}
                          className="h-7 w-7 rounded-full border-2 transition-transform hover:scale-110"
                          style={{
                            background: color,
                            borderColor: selectedNode.color === color ? 'var(--color-text-primary)' : 'rgba(255,255,255,0.75)',
                            boxShadow: '0 2px 7px rgba(19,23,38,0.13)',
                          }}
                          title={color}
                        />
                      ))}
                      <label className="relative h-7 w-7 cursor-pointer overflow-hidden rounded-full border-2 border-[var(--color-border)] bg-[conic-gradient(red,yellow,lime,aqua,blue,magenta,red)]" title="Custom color">
                        <input
                          type="color"
                          value={selectedNode.color ?? PALETTE[0]}
                          onChange={(event) => updateNode(selectedNode.id, { color: event.target.value })}
                          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                        />
                      </label>
                    </div>
                  </div>
                )}

                {selectedNode.kind === 'connected' && nodeDepth(selectedNode.id, document.nodes) < 3 && (
                  <button
                    type="button"
                    onClick={addChildNode}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-accent)] px-3 py-2.5 text-[12px] font-semibold text-white shadow-sm hover:bg-[var(--color-accent-hover)]"
                  >
                    <Plus size={14} /> Add child tile
                  </button>
                )}
              </div>
            ) : (
              <div className="flex min-h-full flex-col">
                <div>
                  <p className="ui-section-label">YOUR BALANCE</p>
                  <h3 className="mt-1 text-base font-semibold text-[var(--color-text-primary)]">Keep the whole picture visible.</h3>
                  <p className="mt-2 text-[12px] leading-relaxed text-[var(--color-text-muted)]">
                    Select a tile to edit it. The mandala rearranges itself whenever its structure changes.
                  </p>
                </div>
                <div className="mt-6 grid grid-cols-2 gap-2">
                  <button type="button" onClick={addMainNode} className="flex flex-col items-center gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-4 text-[12px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
                    <Plus size={17} className="text-[var(--color-accent)]" /> Main area
                  </button>
                  <button type="button" onClick={addLooseNode} className="flex flex-col items-center gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-4 text-[12px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
                    <Link2Off size={17} className="text-[var(--color-accent)]" /> Loose note
                  </button>
                </div>
                <div className="mt-6 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-[12px] text-[var(--color-text-muted)]">
                  <div className="flex items-center gap-2 text-[var(--color-text-secondary)]"><Link2 size={14} /> Up to three levels</div>
                  <p className="mt-2 leading-relaxed">Move tiles between branches with the “Place in” menu. Branch colors flow automatically to their children.</p>
                </div>
              </div>
            )}
          </aside>
        </div>

        {!maximized && (
          <button
            type="button"
            aria-label="Resize mandala window"
            className="absolute bottom-1.5 right-1.5 h-4 w-4 cursor-se-resize rounded-sm opacity-55 hover:opacity-100"
            onMouseDown={(event) => {
              event.preventDefault();
              resizeRef.current = { startX: event.clientX, startY: event.clientY, width: size.width, height: size.height };
            }}
          >
            <span className="absolute bottom-0 right-0 h-2.5 w-2.5 border-b-2 border-r-2 border-[var(--color-text-muted)]" />
          </button>
        )}
      </section>
    </div>
  );
}
