import type { MandalaDocument, MandalaNode } from '@/types';

export const MANDALA_WORLD = { width: 1600, height: 1400 } as const;
export const MANDALA_CENTER = { x: 800, y: 680 } as const;

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
}

export interface MandalaLayout {
  nodes: MandalaNodeLayout[];
  looseNodes: MandalaNodeLayout[];
  edges: MandalaEdgeLayout[];
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
  const connected = document.nodes.filter((node) => node.kind === 'connected');
  const mainNodes = ordered(connected.filter((node) => node.parentId === null));
  const layouts: MandalaNodeLayout[] = [];
  const edges: MandalaEdgeLayout[] = [];
  const branchCount = Math.max(1, mainNodes.length);
  const sector = (Math.PI * 2) / branchCount;
  const mainRadius = 205;
  const childDistance = 400;
  const outerDistance = 600;
  const secondaryOffset = 520;

  mainNodes.forEach((branch, branchIndex) => {
    const branchAngle = -Math.PI / 2 + branchIndex * sector;
    const branchPosition = pointAt(branchAngle, mainRadius);
    const branchColor = branch.color ?? '#5D6DF4';
    const cos = Math.cos(branchAngle);
    const sin = Math.sin(branchAngle);
    const axis: 'horizontal' | 'vertical' = Math.abs(cos) >= Math.abs(sin) ? 'horizontal' : 'vertical';
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
    const allGrandchildren = children.flatMap((child) => grandchildrenByParent.get(child.id) ?? []);
    const childSecondaryCenter = axis === 'horizontal'
      ? MANDALA_CENTER.y + sin * secondaryOffset
      : MANDALA_CENTER.x + cos * secondaryOffset;
    const childSecondary = spread(childSecondaryCenter, children.length, axis === 'horizontal' ? 118 : 132);
    const outerSecondary = spread(childSecondaryCenter, allGrandchildren.length, 112);
    const outerSecondaryById = new Map(allGrandchildren.map((node, index) => [node.id, outerSecondary[index]]));
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
      grandchildren.forEach((grandchild) => {
        const grandchildSecondary = outerSecondaryById.get(grandchild.id) ?? childSecondary[childIndex];
        const grandchildPosition = axis === 'horizontal'
          ? { x: MANDALA_CENTER.x + Math.sign(cos || 1) * outerDistance, y: grandchildSecondary }
          : { x: grandchildSecondary, y: MANDALA_CENTER.y + Math.sign(sin || 1) * outerDistance };
        layouts.push({ node: grandchild, ...grandchildPosition, depth: 3, branchId: branch.id });
        edges.push({
          id: `${child.id}-${grandchild.id}`,
          from: childPosition,
          to: grandchildPosition,
          color: branchColor,
          axis,
        });
      });
    });
  });

  const looseNodes = ordered(document.nodes.filter((node) => node.kind === 'loose')).map((node, index) => ({
    node,
    x: 1160 + (index % 3) * 118,
    y: 1290 - Math.floor(index / 3) * 118,
    depth: 1 as const,
    branchId: node.id,
  }));

  return { nodes: layouts, looseNodes, edges };
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
