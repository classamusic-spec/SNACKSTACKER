/**
 * Tiny vanilla-DOM helpers. No framework, no dependencies.
 *
 * `h()` builds HTML elements, `s()` builds SVG elements, `Bag` owns every
 * timer / frame / listener a screen creates so `dispose()` is exhaustive.
 */

export type Child = Node | string | number | false | null | undefined;

export type Handlers = {
  [K in keyof HTMLElementEventMap]?: (ev: HTMLElementEventMap[K]) => void;
};

export interface ElProps {
  class?: string;
  id?: string;
  /** textContent, applied before children. */
  text?: string;
  role?: string;
  type?: 'button' | 'submit';
  tabIndex?: number;
  disabled?: boolean;
  /** Set with setProperty so `--custom` props work. */
  style?: Record<string, string>;
  attrs?: Record<string, string | number | boolean | null | undefined>;
  /** `{ label: 'x' }` -> `aria-label="x"`. */
  aria?: Record<string, string | number | boolean | null | undefined>;
  /** `{ sku: 'candy' }` -> `data-sku="candy"`. */
  data?: Record<string, string | number | boolean | null | undefined>;
  on?: Handlers;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function setAttr(
  el: Element,
  name: string,
  value: string | number | boolean | null | undefined,
): void {
  if (value === null || value === undefined || value === false) {
    el.removeAttribute(name);
  } else if (value === true) {
    el.setAttribute(name, '');
  } else {
    el.setAttribute(name, String(value));
  }
}

export function append(parent: Node, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (typeof child === 'string' || typeof child === 'number') {
      parent.appendChild(document.createTextNode(String(child)));
    } else {
      parent.appendChild(child);
    }
  }
}

function applyProps(el: HTMLElement, props?: ElProps | null): void {
  if (!props) return;
  if (props.class) el.className = props.class;
  if (props.id) el.id = props.id;
  if (props.role) el.setAttribute('role', props.role);
  if (props.type) el.setAttribute('type', props.type);
  if (props.tabIndex !== undefined) el.tabIndex = props.tabIndex;
  if (props.disabled) el.setAttribute('disabled', '');
  if (props.text !== undefined) el.textContent = props.text;
  if (props.style) {
    for (const key of Object.keys(props.style)) {
      const v = props.style[key];
      if (v !== undefined) el.style.setProperty(key, v);
    }
  }
  if (props.attrs) {
    for (const key of Object.keys(props.attrs)) setAttr(el, key, props.attrs[key]);
  }
  if (props.aria) {
    for (const key of Object.keys(props.aria)) setAttr(el, `aria-${key}`, props.aria[key]);
  }
  if (props.data) {
    for (const key of Object.keys(props.data)) setAttr(el, `data-${key}`, props.data[key]);
  }
  if (props.on) {
    const map = props.on as Record<string, EventListener | undefined>;
    for (const key of Object.keys(map)) {
      const fn = map[key];
      if (fn) el.addEventListener(key, fn);
    }
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: ElProps | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  applyProps(el, props);
  append(el, children);
  return el;
}

/** SVG element factory. Attributes only — SVG needs no event plumbing here. */
export function s(
  tag: string,
  attrs?: Record<string, string | number> | null,
  ...children: Child[]
): SVGElement {
  const el = document.createElementNS(SVG_NS, tag) as SVGElement;
  if (attrs) {
    for (const key of Object.keys(attrs)) el.setAttribute(key, String(attrs[key]));
  }
  append(el, children);
  return el;
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export function toggleClass(el: Element, name: string, on: boolean): void {
  el.classList.toggle(name, on);
}

/** Grouped thousands, tabular-safe. */
export function formatInt(n: number): string {
  const v = Math.max(0, Math.round(n));
  return v.toLocaleString('en-US');
}

/** Owns disposable resources for one screen or component. */
export class Bag {
  private timeouts = new Set<number>();
  private frames = new Set<number>();
  private offs: Array<() => void> = [];
  private disposed = false;

  after(fn: () => void, ms: number): number {
    if (this.disposed) return 0;
    const id = window.setTimeout(() => {
      this.timeouts.delete(id);
      fn();
    }, ms);
    this.timeouts.add(id);
    return id;
  }

  cancel(id: number): void {
    if (!id) return;
    window.clearTimeout(id);
    this.timeouts.delete(id);
  }

  frame(fn: (t: number) => void): number {
    if (this.disposed) return 0;
    const id = window.requestAnimationFrame((t) => {
      this.frames.delete(id);
      fn(t);
    });
    this.frames.add(id);
    return id;
  }

  cancelFrame(id: number): void {
    if (!id) return;
    window.cancelAnimationFrame(id);
    this.frames.delete(id);
  }

  /** Track an arbitrary teardown function. */
  own(off: () => void): void {
    if (this.disposed) {
      off();
      return;
    }
    this.offs.push(off);
  }

  listen<K extends keyof WindowEventMap>(
    target: Window,
    type: K,
    fn: (ev: WindowEventMap[K]) => void,
    opts?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, fn as EventListener, opts);
    this.own(() => target.removeEventListener(type, fn as EventListener, opts));
  }

  disposeAll(): void {
    this.disposed = true;
    for (const id of this.timeouts) window.clearTimeout(id);
    this.timeouts.clear();
    for (const id of this.frames) window.cancelAnimationFrame(id);
    this.frames.clear();
    for (const off of this.offs.splice(0)) off();
  }
}
