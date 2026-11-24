'use client';

import { useLayoutEffect, useRef } from 'react';

const MAX_TEXT_LENGTH = 100000;
const isBlock = (node: Node) => node instanceof HTMLElement && /^(DIV|P)$/.test(node.tagName);
const isList = (node: Node) => node.nodeName === 'UL';
function flowText(node: Node, skipLists = false): string {
  const lines: string[] = [];
  let inline = '', hasInline = false, lastInline: Node | null = null;
  const flush = (last = false) => {
    if (!hasInline) return;
    // A final <br> is a browser caret stop rather than an extra stored newline.
    if (last && lastInline?.nodeName === 'BR') inline = inline.slice(0, -1);
    lines.push(inline);inline = '';hasInline = false;lastInline = null;
  };
  for (const child of node.childNodes) {
    if (isList(child)) {
      if (!skipLists) { flush();lines.push(...listLines(child)); }
    } else if (isBlock(child)) {
      flush();lines.push(flowText(child, skipLists));
    } else {
      const value = child.nodeType === Node.TEXT_NODE ? child.textContent ?? '' : child.nodeName === 'BR' ? '\n' : flowText(child, skipLists);
      inline += value;hasInline ||= !!value;lastInline = child;
    }
  }
  flush(true);
  return lines.join('\n');
}
function blockText(node: Node): string { return flowText(node, true); }
function listLines(list: Node, depth = 0): string[] {
  return Array.from(list.childNodes).flatMap(item => {
    if (isList(item)) return listLines(item, depth + 1);
    if (item.nodeName !== 'LI') return [];
    const [first, ...continuations] = blockText(item).split('\n');
    const indent = '\t'.repeat(depth);
    return [`${indent}- ${first}`, ...continuations.map(line => `${indent}  ${line}`),
      ...Array.from(item.childNodes).filter(isList).flatMap(child => listLines(child, depth + 1))];
  });
}
function readText(element: HTMLElement): string { return flowText(element); }
function decorate(element: HTMLElement) {
  for (const child of element.childNodes) {
    if (isBlock(child)) (child as HTMLElement).dataset.noteEmpty = String(!blockText(child).trim());
  }
}
function renderText(element: HTMLElement, text: string) {
  const fragment = document.createDocumentFragment();
  const lists: HTMLUListElement[] = [];
  for (const line of text.split('\n')) {
    const bullet = /^(\t*)- (.*)$/.exec(line);
    const depth = bullet?.[1].length ?? 0;
    if (bullet && depth <= lists.length) {
      lists.length = Math.min(lists.length, depth + 1);
      if (!lists[depth]) {
        const list = document.createElement('ul');
        if (!depth) fragment.append(list);
        else lists[depth - 1].lastElementChild!.append(list);
        lists[depth] = list;
      }
      const item = document.createElement('li');
      item.append(bullet[2] ? document.createTextNode(bullet[2]) : document.createElement('br'));
      lists[depth].append(item);
      continue;
    }
    const continuation = /^(\t*) {2}(.*)$/.exec(line);
    const item = continuation && lists[continuation[1].length]?.lastElementChild;
    if (continuation && item) {
      if (item.lastChild?.nodeName === 'BR') item.lastChild.remove();
      item.append(document.createElement('br'), document.createTextNode(continuation[2]));
      if (!continuation[2]) item.append(document.createElement('br'));
      continue;
    }
    lists.length = 0;
    const block = document.createElement('div');
    block.append(line ? document.createTextNode(line) : document.createElement('br'));
    fragment.append(block);
  }
  element.replaceChildren(fragment);
  decorate(element);
}

/** Native editing with plain-text persistence, compact blank lines and hanging dash lists. */
export function MandalaNoteEditor({ text, onChange, label, today, focus }: {
  text: string; onChange: (text: string) => void; label: string; today: boolean; focus: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const lastText = useRef<string | null>(null);
  const formatting = useRef(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || lastText.current === text) return;
    const selection = window.getSelection();
    const focused = document.activeElement === element;
    let offset = 0;
    if (focused && selection?.anchorNode && element.contains(selection.anchorNode)) {
      const range = document.createRange();
      range.selectNodeContents(element);
      range.setEnd(selection.anchorNode, selection.anchorOffset);
      offset = range.toString().length;
    }
    renderText(element, text);
    lastText.current = text;
    if (focused && selection) {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node && offset > (node.textContent?.length ?? 0)) { offset -= node.textContent?.length ?? 0; node = walker.nextNode(); }
      const range = document.createRange();
      if (node) range.setStart(node, Math.min(offset, node.textContent?.length ?? 0));
      else { range.selectNodeContents(element); range.collapse(false); }
      range.collapse(true); selection.removeAllRanges(); selection.addRange(range);
    }
  }, [text]);
  useLayoutEffect(() => { if (focus) ref.current?.focus({ preventScroll: true }); }, [focus]);
  const changed = () => {
    const element = ref.current;
    if (!element || formatting.current) return;
    const selection = window.getSelection();
    const node = selection?.anchorNode;
    const parent = node instanceof Element ? node : node?.parentElement;
    const block = parent?.closest<HTMLElement>('p,div');
    if (selection?.isCollapsed && node && block && !parent?.closest('li') && element.contains(node)) {
      const before = document.createRange();before.selectNodeContents(block);before.setEnd(node, selection.anchorOffset);
      if (before.toString().replace(/\u00a0/g, ' ') === '- ') {
        // Keep native undo/redo while converting only the current line, never earlier prose.
        formatting.current = true;
        try {
          if (block === element) document.execCommand('formatBlock', false, 'div');
          selection.modify('extend', 'backward', 'character');selection.modify('extend', 'backward', 'character');
          document.execCommand('delete');document.execCommand('insertUnorderedList');
        } finally { formatting.current = false; }
      }
    }
    decorate(element);
    const next = readText(element);
    if (next.length > MAX_TEXT_LENGTH) { renderText(element, lastText.current ?? text); return; }
    lastText.current = next;
    onChange(next);
  };
  return <div ref={ref} role="textbox" aria-multiline="true" aria-label={label} contentEditable suppressContentEditableWarning
    data-mandala-note-editor data-empty={!text} data-placeholder={today ? 'A few thoughts on today…' : ''}
    onInput={changed}
    onKeyDown={event => {
      if (event.nativeEvent.isComposing) return;
      const selection = window.getSelection();
      const node = selection?.anchorNode;
      const parent = node instanceof Element ? node : node?.parentElement;
      const item = parent?.closest('li');
      if (event.key === 'Tab' && item && ref.current?.contains(item)) {
        event.preventDefault();
        if (event.shiftKey || item.previousElementSibling) document.execCommand(event.shiftKey ? 'outdent' : 'indent');
        changed();return;
      }
      if (event.key !== 'Enter') return;
      event.preventDefault();
      if (event.shiftKey) document.execCommand('insertLineBreak');
      else {
        if (!item && parent?.closest('p,div') === ref.current) document.execCommand('formatBlock', false, 'div');
        document.execCommand('insertParagraph');
      }
      changed();
    }}
    onPaste={event => {
      event.preventDefault();
      const pasted = event.clipboardData.getData('text/plain');
      if (!pasted || !ref.current) return;
      const content = document.createElement('div');
      const selected = window.getSelection()?.toString().length ?? 0;
      const available = Math.max(0, MAX_TEXT_LENGTH - (readText(ref.current).length - selected));
      renderText(content, pasted.slice(0, available));
      document.execCommand('insertHTML', false, content.innerHTML);
      changed();
    }}
    style={{ minHeight: today ? 100 : 36 }}
    className="relative block w-full whitespace-pre-wrap break-words border-0 bg-transparent py-1 text-[12px] leading-[1.5] text-[var(--color-text-primary)] outline-none [&>:is(p,div)]:m-0 [&>:is(p,div)]:min-h-[1lh] [&>[data-note-empty=true]:not(:last-child)]:min-h-0 [&>[data-note-empty=true]:not(:last-child)]:h-[0.75em] [&>[data-note-empty=true]:not(:last-child)]:leading-[0.75] [&_ul]:m-0 [&_ul]:list-disc [&_ul]:pl-3 [&_li]:m-0 [&_li]:pl-0 [&_li::marker]:content-['-_'] data-[empty=true]:before:pointer-events-none data-[empty=true]:before:absolute data-[empty=true]:before:text-[var(--color-text-muted)]/65 data-[empty=true]:before:content-[attr(data-placeholder)]" />;
}
