import type { MandalaDocument, MandalaLayoutSettings, MandalaNode } from '@/types';

export const MANDALA_WORLD = { width: 3000, height: 3000 } as const;
export const MANDALA_CENTER = { x: 1500, y: 1500 } as const;
export const DEFAULT_MANDALA_LAYOUT_SETTINGS: MandalaLayoutSettings = {
  levelOneDistance: 195,
  levelTwoDistance: 175,
  levelThreeDistance: 175,
  levelTwoSpacing: 28,
  levelThreeSpacing: 12,
};

const TILE_SIZE = 104;
const TILE_HALF = TILE_SIZE / 2;

export interface MandalaNodeLayout {
  node: MandalaNode;
  x: number;
  y: number;
  depth: 1 | 2 | 3;
  branchId: string;
}

export interface MandalaEdgeLayout {
  id: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  color: string;
  axis: 'horizontal' | 'vertical';
  /** Override the normal half-tile inset when an edge ends at a group boundary. */
  toInset?: number;
}

export interface MandalaLayout {
  nodes: MandalaNodeLayout[];
  looseNodes: MandalaNodeLayout[];
  edges: MandalaEdgeLayout[];
  mainRadius: number;
}

function ordered(nodes: MandalaNode[]) {
  return [...nodes].sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
}

function pointAt(angle: number, radius: number) {
  return {
    x: MANDALA_CENTER.x + Math.cos(angle) * radius,
    y: MANDALA_CENTER.y + Math.sin(angle) * radius,
  };
}

function spread(center: number, count: number, step: number) {
  if (count <= 1) return [center];
  const start = center - ((count - 1) * step) / 2;
  return Array.from({ length: count }, (_, index) => start + index * step);
}

function groupedCenters(center: number, spans: number[], gap: number) {
  if (spans.length === 0) return [];
  const totalSpan = spans.reduce((sum, span) => sum + span, 0) + gap * (spans.length - 1);
  let cursor = center - totalSpan / 2;
  return spans.map((span) => {
    const nextCenter = cursor + span / 2;
    cursor += span + gap;
    return nextCenter;
  });
}

interface GridCell {
  column: number;
  row: number;
}

function thirdLevelGridCells(count: number): { columns: number; rows: number; cells: GridCell[] } {
  if (count <= 0) return { columns: 1, rows: 1, cells: [] };
  if (count === 1) return { columns: 1, rows: 1, cells: [{ column: 0, row: 0 }] };
  if (count === 2) {
    return {
      columns: 1,
      rows: 2,
      cells: [{ column: 0, row: 0 }, { column: 0, row: 1 }],
    };
  }
  if (count === 3) {
    return {
      columns: 2,
      rows: 2,
      cells: [
        { column: 0, row: 0 },
        { column: 1, row: 0 },
        { column: 1, row: 1 },
      ],
    };
  }

  const columns = 2;
  const rows = Math.ceil(count / columns);
  return {
    columns,
    rows,
    cells: Array.from({ length: count }, (_, index) => ({
      column: index % columns,
      row: Math.floor(index / columns),
    })),
  };
}

function thirdLevelCluster(
  count: number,
  axis: 'horizontal' | 'vertical',
  direction: number,
  levelThreeSpacing: number,
) {
  const grid = thirdLevelGridCells(count);
  const step = TILE_SIZE + levelThreeSpacing;
  const positionedCells = grid.cells.map((cell, index) => ({
    ...cell,
    index,
    x: (cell.column - (grid.columns - 1) / 2) * step,
    y: (cell.row - (grid.rows - 1) / 2) * step,
  }));
  const radialValue = (cell: { x: number; y: number }) => direction * (axis === 'horizontal' ? cell.x : cell.y);
  const tangentialValue = (cell: { x: number; y: number }) => axis === 'horizontal' ? cell.y : cell.x;
  const lead = [...positionedCells].sort((a, b) => (
    radialValue(a) - radialValue(b)
    || Math.abs(tangentialValue(a)) - Math.abs(tangentialValue(b))
    || a.index - b.index
  ))[0];

  if (!lead) {
    return {
      offsets: [] as Array<{ x: number; y: number }>,
      connectionOffset: { x: 0, y: 0 },
      tangentialSpan: 0,
    };
  }

  const leadProjection = radialValue(lead);
  const orderedCells = [lead, ...positionedCells.filter((cell) => cell.index !== lead.index)];
  const offsets = orderedCells.map((cell) => axis === 'horizontal'
    ? { x: cell.x - direction * leadProjection, y: cell.y }
    : { x: cell.x, y: cell.y - direction * leadProjection });
  const minX = Math.min(...offsets.map((offset) => offset.x));
  const maxX = Math.max(...offsets.map((offset) => offset.x));
  const minY = Math.min(...offsets.map((offset) => offset.y));
  const maxY = Math.max(...offsets.map((offset) => offset.y));
  const connectionOffset = axis === 'horizontal'
    ? {
        x: direction > 0 ? minX - TILE_HALF : maxX + TILE_HALF,
        y: (minY + maxY) / 2,
      }
    : {
        x: (minX + maxX) / 2,
        y: direction > 0 ? minY - TILE_HALF : maxY + TILE_HALF,
      };
  return {
    offsets,
    connectionOffset,
    tangentialSpan: axis === 'horizontal'
      ? maxY - minY + TILE_SIZE
      : maxX - minX + TILE_SIZE,
  };
}

export function nodeDepth(nodeId: string, nodes: MandalaNode[]): number {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  let current = byId.get(nodeId);
  let depth = current?.kind === 'connected' ? 1 : 0;
  const seen = new Set<string>();
  while (current?.parentId) {
    if (seen.has(current.id)) return 99;
    seen.add(current.id);
    current = byId.get(current.parentId);
    depth += 1;
  }
  return depth;
}

export function descendantsOf(nodeId: string, nodes: MandalaNode[]): Set<string> {
  const result = new Set<string>();
  const visit = (parentId: string) => {
    nodes.filter((node) => node.parentId === parentId).forEach((node) => {
      if (result.has(node.id)) return;
      result.add(node.id);
      visit(node.id);
    });
  };
  visit(nodeId);
  return result;
}

export function calculateMandalaLayout(document: MandalaDocument): MandalaLayout {
  const settings = { ...DEFAULT_MANDALA_LAYOUT_SETTINGS, ...document.layout };
  const connected = document.nodes.filter((node) => node.kind === 'connected');
  const mainNodes = ordered(connected.filter((node) => node.parentId === null));
  const layouts: MandalaNodeLayout[] = [];
  const edges: MandalaEdgeLayout[] = [];
  const branchCount = Math.max(1, mainNodes.length);
  const sector = (Math.PI * 2) / branchCount;
  const mainRadius = settings.levelOneDistance;
  const childDistance = mainRadius + settings.levelTwoDistance;
  const outerDistance = childDistance + settings.levelThreeDistance;
  const secondaryOffset = outerDistance - 25;

  mainNodes.forEach((branch, branchIndex) => {
    const branchAngle = -Math.PI / 2 + branchIndex * sector;
    const branchPosition = pointAt(branchAngle, mainRadius);
    const branchColor = branch.color ?? '#5D6DF4';
    const cos = Math.cos(branchAngle);
    const sin = Math.sin(branchAngle);
    const axis: 'horizontal' | 'vertical' = Math.abs(cos) >= Math.abs(sin) ? 'horizontal' : 'vertical';
    const direction = axis === 'horizontal' ? Math.sign(cos || 1) : Math.sign(sin || 1);
    layouts.push({ node: branch, ...branchPosition, depth: 1, branchId: branch.id });
    edges.push({
      id: `center-${branch.id}`,
      from: MANDALA_CENTER,
      to: branchPosition,
      color: branchColor,
      axis,
    });

    const children = ordered(connected.filter((node) => node.parentId === branch.id));
    const grandchildrenByParent = new Map(
      children.map((child) => [child.id, ordered(connected.filter((node) => node.parentId === child.id))]),
    );
    const childSecondaryCenter = axis === 'horizontal'
      ? MANDALA_CENTER.y + sin * secondaryOffset
      : MANDALA_CENTER.x + cos * secondaryOffset;
    const thirdLevelClusters = new Map(
      children.map((child) => {
        const grandchildren = grandchildrenByParent.get(child.id) ?? [];
        return [child.id, thirdLevelCluster(grandchildren.length, axis, direction, settings.levelThreeSpacing)] as const;
      }),
    );
    const childSecondary = spread(
      childSecondaryCenter,
      children.length,
      TILE_SIZE + settings.levelTwoSpacing,
    );
    const activeThirdLevelGroups = children
      .map((child, childIndex) => ({
        child,
        childIndex,
        cluster: thirdLevelClusters.get(child.id),
      }))
      .filter((group) => group.cluster && group.cluster.offsets.length > 0);
    const activeGroupCenter = activeThirdLevelGroups.length > 0
      ? activeThirdLevelGroups.reduce((sum, group) => sum + childSecondary[group.childIndex], 0) / activeThirdLevelGroups.length
      : childSecondaryCenter;
    const activeGroupSecondary = groupedCenters(
      activeGroupCenter,
      activeThirdLevelGroups.map((group) => group.cluster?.tangentialSpan ?? TILE_SIZE),
      settings.levelTwoSpacing,
    );
    const thirdLevelSecondaryByParent = new Map(
      activeThirdLevelGroups.map((group, index) => [group.child.id, activeGroupSecondary[index]]),
    );
    children.forEach((child, childIndex) => {
      const childPosition = axis === 'horizontal'
        ? { x: MANDALA_CENTER.x + Math.sign(cos || 1) * childDistance, y: childSecondary[childIndex] }
        : { x: childSecondary[childIndex], y: MANDALA_CENTER.y + Math.sign(sin || 1) * childDistance };
      layouts.push({ node: child, ...childPosition, depth: 2, branchId: branch.id });
      edges.push({
        id: `${branch.id}-${child.id}`,
        from: branchPosition,
        to: childPosition,
        color: branchColor,
        axis,
      });

      const grandchildren = grandchildrenByParent.get(child.id) ?? [];
      const cluster = thirdLevelClusters.get(child.id)
        ?? thirdLevelCluster(0, axis, direction, settings.levelThreeSpacing);
      const thirdLevelSecondary = thirdLevelSecondaryByParent.get(child.id) ?? childSecondary[childIndex];
      grandchildren.forEach((grandchild, grandchildIndex) => {
        const gridOffset = cluster.offsets[grandchildIndex] ?? { x: 0, y: 0 };
        const grandchildPosition = axis === 'horizontal'
          ? {
              x: MANDALA_CENTER.x + direction * outerDistance + gridOffset.x,
              y: thirdLevelSecondary + gridOffset.y,
            }
          : {
              x: thirdLevelSecondary + gridOffset.x,
              y: MANDALA_CENTER.y + direction * outerDistance + gridOffset.y,
            };
        layouts.push({ node: grandchild, ...grandchildPosition, depth: 3, branchId: branch.id });
      });
      if (grandchildren.length > 0) {
        const connectionPosition = axis === 'horizontal'
          ? {
              x: MANDALA_CENTER.x + direction * outerDistance + cluster.connectionOffset.x,
              y: thirdLevelSecondary + cluster.connectionOffset.y,
            }
          : {
              x: thirdLevelSecondary + cluster.connectionOffset.x,
              y: MANDALA_CENTER.y + direction * outerDistance + cluster.connectionOffset.y,
            };
        edges.push({
          id: `${child.id}-group`,
          from: childPosition,
          to: connectionPosition,
          color: branchColor,
          axis,
          toInset: 0,
        });
      }
    });
  });

  const looseNodes = ordered(document.nodes.filter((node) => node.kind === 'loose')).map((node, index) => ({
    node,
    x: MANDALA_CENTER.x + 420 + (index % 3) * 118,
    y: MANDALA_CENTER.y + 640 - Math.floor(index / 3) * 118,
    depth: 1 as const,
    branchId: node.id,
  }));

  return { nodes: layouts, looseNodes, edges, mainRadius };
}

function hexToRgb(hex: string) {
  const normalized = hex.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return { r: 93, g: 109, b: 244 };
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

export function mixWithWhite(hex: string, amount: number) {
  const { r, g, b } = hexToRgb(hex);
  const mix = (channel: number) => Math.round(channel + (255 - channel) * amount);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

export function readableTextColor(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.62 ? '#171923' : '#ffffff';
}
