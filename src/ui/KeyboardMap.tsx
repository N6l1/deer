import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { KeyCap, Layout } from '../device/layouts';
import { cx } from './common';

export interface KeyboardMapProps {
  layout: Layout;
  selection: number[];
  onSelect?: (next: number[]) => void;
  mode?: 'select' | 'paint' | 'single';
  onPaint?: (slot: number) => void;
  renderCap: (k: KeyCap, u: number) => ReactNode;
  capStyle?: (k: KeyCap) => CSSProperties | undefined;
  capClass?: (k: KeyCap) => string | undefined;
  knob?: ReactNode;
  onKnob?: () => void;
  knobActive?: boolean;
  /** exposes the container so overlays (live depth) can style caps without re-rendering */
  containerRef?: React.RefObject<HTMLDivElement | null>;
}

const GAP = 0.08; // in key units

export function KeyboardMap(p: KeyboardMapProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [u, setU] = useState(52);
  const drag = useRef<{ x: number; y: number; base: number[]; additive: boolean; moved: boolean; slot: number | null; painting: boolean } | null>(null);
  const anchor = useRef<number | null>(null);
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const mode = p.mode ?? 'select';

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const w = e?.contentRect.width ?? 800;
      setU(Math.max(26, Math.min(62, w / (p.layout.width + (p.layout.knob ? 0.2 : 0)))));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [p.layout]);

  useEffect(() => {
    if (p.containerRef) (p.containerRef as React.MutableRefObject<HTMLDivElement | null>).current = inner.current;
  });

  const order = p.layout.keys.map((k) => k.slot);
  const local = (e: React.PointerEvent | PointerEvent) => {
    const r = inner.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const slotAt = (e: React.PointerEvent | PointerEvent): number | null => {
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-slot]') as HTMLElement | null;
    return el && inner.current?.contains(el) ? Number(el.dataset.slot) : null;
  };

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const slot = slotAt(e);
    const additive = e.ctrlKey || e.metaKey || e.shiftKey;
    const pt = local(e);
    if (mode === 'paint') {
      drag.current = { ...pt, base: [], additive, moved: false, slot, painting: true };
      if (slot !== null) p.onPaint?.(slot);
    } else drag.current = { ...pt, base: p.selection, additive, moved: false, slot, painting: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.painting) {
      const s = slotAt(e);
      if (s !== null) p.onPaint?.(s);
      return;
    }
    if (mode !== 'select') return;
    const pt = local(e);
    if (!d.moved && Math.hypot(pt.x - d.x, pt.y - d.y) < 6) return;
    d.moved = true;
    const b = { x0: Math.min(d.x, pt.x), y0: Math.min(d.y, pt.y), x1: Math.max(d.x, pt.x), y1: Math.max(d.y, pt.y) };
    setBox(b);
    const hit = p.layout.keys
      .filter((k) => k.x * u < b.x1 && (k.x + k.w) * u > b.x0 && k.y * u < b.y1 && (k.y + 1) * u > b.y0)
      .map((k) => k.slot);
    p.onSelect?.([...new Set([...d.base, ...hit])]);
  };

  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    setBox(null);
    if (!d || d.painting || d.moved) return;
    const slot = d.slot;
    // Clicking empty space does nothing: selections only change by clicking keys, dragging, or the Clear button.
    if (slot === null) return;
    if (mode === 'single') return p.onSelect?.([slot]);
    if (e.shiftKey && anchor.current !== null) {
      const [a, b] = [order.indexOf(anchor.current), order.indexOf(slot)].sort((x, y) => x - y);
      p.onSelect?.([...new Set([...p.selection, ...order.slice(a, (b ?? 0) + 1)])]);
    } else {
      // Every click toggles: a selected key stays selected until it is clicked again.
      p.onSelect?.(p.selection.includes(slot) ? p.selection.filter((s) => s !== slot) : [...p.selection, slot]);
      anchor.current = slot;
    }
  };

  const sel = new Set(p.selection);
  const width = (p.layout.width + (p.layout.knob ? 0.15 : 0)) * u;
  return (
    <div ref={wrap} className="w-full" dir="ltr">
      <div
        ref={inner}
        role="grid"
        aria-label="keyboard"
        className={cx('relative mx-auto touch-none select-none rounded-[18px] border border-line bg-panel2/70 p-0', mode === 'paint' ? 'cursor-crosshair' : 'cursor-default')}
        style={{ width, height: p.layout.height * u + 2, boxShadow: 'inset 0 1px 0 #ffffff08, 0 30px 60px -40px #000' }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => ((drag.current = null), setBox(null))}
      >
        {p.layout.keys.map((k) => (
          <div
            key={k.slot}
            role="gridcell"
            aria-selected={sel.has(k.slot)}
            aria-label={k.label}
            data-slot={k.slot}
            className={cx(
              'absolute overflow-hidden rounded-[9px] border transition-[border-color,box-shadow] duration-100',
              sel.has(k.slot) ? 'border-accent shadow-[0_0_0_2px_#ff6a1a66]' : 'border-black/30 hover:border-accent/50',
              p.capClass?.(k),
            )}
            style={{
              left: (k.x + GAP / 2) * u,
              top: (k.y + GAP / 2) * u,
              width: (k.w - GAP) * u,
              height: (1 - GAP) * u,
              background: 'linear-gradient(180deg, var(--cap-top), var(--cap))',
              ...p.capStyle?.(k),
            }}
          >
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-accent/70 to-accent2/40" style={{ height: 'calc(var(--depth, 0) * 100%)' }} />
            <div className="pointer-events-none relative h-full">{p.renderCap(k, u)}</div>
          </div>
        ))}
        {p.layout.knob && (
          <button
            type="button"
            aria-label="knob"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={p.onKnob}
            className={cx(
              'absolute grid place-items-center rounded-full border-2 transition',
              p.knobActive ? 'border-accent shadow-[0_0_0_3px_#ff6a1a55]' : 'border-line hover:border-accent/60',
            )}
            style={{
              left: p.layout.knob.x * u,
              top: (p.layout.knob.y + 0.02) * u,
              width: 0.96 * u,
              height: 0.96 * u,
              background: 'repeating-conic-gradient(from 0deg, #3a3a44 0 4deg, #24242b 4deg 8deg)',
            }}
          >
            {p.knob}
          </button>
        )}
        {box && (
          <div className="pointer-events-none absolute rounded border border-accent bg-accent/10" style={{ left: box.x0, top: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0 }} />
        )}
      </div>
    </div>
  );
}
