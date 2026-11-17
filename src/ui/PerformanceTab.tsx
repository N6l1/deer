import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp, liveDepth, subscribeDepth } from '../state/store';
import { setTracking } from '../state/session';
import { useT } from '../i18n';
import { layoutFor, PRESETS, type Layout } from '../device/layouts';
import { findModel, travelRange, type TravelRange } from '../device/models';
import { Button, Card, ExperimentalBadge, Row, Slider, Toggle, confirmAsk, cx } from './common';
import { KeyboardMap } from './KeyboardMap';
import type { Profile } from '../device/profile';

const fmt = (v: number, step: number) => v.toFixed(step < 0.1 ? 2 : 1);
/** compact keycap number: 2.00 → 2.0, 1.89 → 1.89, 0 → 0.0 */
const capNum = (v: number) => (Math.round(v * 100) % 10 === 0 ? v.toFixed(1) : v.toFixed(2));
const MAX_TRAVEL = 4.0;

export function useModelAndRange() {
  const conn = useApp((s) => s.connection);
  const profile = useApp((s) => s.profiles.find((p) => p.id === s.activeId) ?? s.profiles[0]!);
  const model = conn.model ?? findModel(profile.model);
  const range = travelRange(conn.dialect ?? 'oldHighPrec');
  const layout = useMemo(() => layoutFor(model), [model]);
  return { model, range, layout, profile };
}

export function QuickSelect({ layout }: { layout: Layout }) {
  const t = useT();
  const setSel = useApp((s) => s.setSelection);
  const n = useApp((s) => s.selection.length);
  const valid = new Set(layout.keys.map((k) => k.slot));
  const pick = (slots: number[]) => setSel(slots.filter((s) => valid.has(s)));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button variant="solid" onClick={() => pick(PRESETS.wasd)}>{t('wasd')}</Button>
      <Button variant="solid" onClick={() => pick(layout.keys.map((k) => k.slot))}>{t('allKeys')}</Button>
      <Button variant="solid" onClick={() => pick(PRESETS.character)}>{t('character')}</Button>
      <Button variant="solid" onClick={() => pick(PRESETS.numerals)}>{t('numerals')}</Button>
      <Button variant="ghost" onClick={() => setSel([])}>{t('clear')}</Button>
      <span className="ms-2 text-xs text-mute">{n ? t('selected', { n }) : t('selectHint')}</span>
    </div>
  );
}

export function PerformanceTab() {
  const t = useT();
  const { layout, range, profile } = useModelAndRange();
  const selection = useApp((s) => s.selection);
  const setSelection = useApp((s) => s.setSelection);
  const update = useApp((s) => s.updateActive);
  const baseline = useApp((s) => s.synced[profile.id]);
  const mapRef = useRef<HTMLDivElement | null>(null);
  const tracking = profile.keystrokeTracking;

  // arrow-key fine tuning (↑ shallower, ↓ deeper; Shift = ×10)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!['ArrowUp', 'ArrowDown'].includes(e.key) || !selection.length) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      const d = (e.key === 'ArrowDown' ? 1 : -1) * range.step * (e.shiftKey ? 10 : 1);
      update((p) => selection.forEach((s) => (p.ap[s] = clamp(round((p.ap[s] ?? range.defaultAp) + d, range.step), range.apMin, range.apMax))));
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [selection, range, update]);

  // live depth → CSS var on each cap (no React re-render)
  useEffect(() => {
    if (!tracking) {
      mapRef.current?.querySelectorAll<HTMLElement>('[data-slot]').forEach((el) => el.style.setProperty('--depth', '0'));
      return;
    }
    return subscribeDepth(() => {
      mapRef.current?.querySelectorAll<HTMLElement>('[data-slot]').forEach((el) => {
        el.style.setProperty('--depth', String(Math.min(1, (liveDepth[Number(el.dataset.slot)] ?? 0) / MAX_TRAVEL)));
      });
    });
  }, [tracking]);

  const changed = (arr: 'ap' | 'ds' | 'us', s: number) => !!baseline && Math.abs((baseline[arr][s] ?? 0) - (profile[arr][s] ?? 0)) > 1e-6;

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
      <div className="flex min-w-0 flex-col gap-4">
        <Card>
          <div className="mb-3">
            <QuickSelect layout={layout} />
          </div>
          <KeyboardMap
            layout={layout}
            selection={selection}
            onSelect={setSelection}
            containerRef={mapRef}
            renderCap={(k, u) => (
              <div className="flex h-full flex-col justify-between leading-none" style={{ padding: u * 0.08 }}>
                <span className="truncate font-medium" style={{ fontSize: Math.max(9, u * 0.21) }}>{k.label}</span>
                {u > 38 && (
                  <span className="num flex gap-[0.3em] tracking-tight" style={{ fontSize: Math.max(8, u * 0.155) }}>
                    <span className={changed('ap', k.slot) ? 'text-hl font-bold' : 'text-ink/85'}>{capNum(profile.ap[k.slot] ?? 0)}</span>
                    <span className={cx(changed('ds', k.slot) ? 'text-hl font-bold' : 'text-mute', !profile.rapidTrigger && 'opacity-40')}>{capNum(profile.ds[k.slot] ?? 0)}</span>
                    <span className={cx(changed('us', k.slot) ? 'text-hl font-bold' : 'text-mute', !profile.rapidTrigger && 'opacity-40')}>{capNum(profile.us[k.slot] ?? 0)}</span>
                  </span>
                )}
              </div>
            )}
          />
          <p className="mt-2 text-center text-[11px] text-mute">actuation · downstroke · upstroke ({t('mm')})</p>
        </Card>
        {tracking && <LiveGraph profile={profile} focus={selection[selection.length - 1] ?? 44} />}
      </div>

      <div className="flex flex-col gap-4">
        <ActionPointPanel range={range} />
        <RapidTriggerPanel range={range} />
        <ModesPanel />
        <PairsPanel layout={layout} />
        <Button
          variant="danger"
          onClick={() => {
            if (!confirmAsk(t('confirmReset'))) return;
            update((p) => {
              p.ap = p.ap.map(() => range.defaultAp);
              p.ds = p.ds.map(() => 0);
              p.us = p.us.map(() => 0);
            });
          }}
        >
          {t('resetAll')}
        </Button>
      </div>
    </div>
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round = (v: number, step: number) => Math.round(v / step) * step;

function ActionPointPanel({ range }: { range: TravelRange }) {
  const t = useT();
  const selection = useApp((s) => s.selection);
  const profile = useApp((s) => s.active());
  const update = useApp((s) => s.updateActive);
  const value = selection.length ? (profile.ap[selection[0]!] ?? range.defaultAp) : range.defaultAp;
  const set = (v: number) => update((p) => selection.forEach((s) => (p.ap[s] = clamp(round(v, range.step), range.apMin, range.apMax))));
  const disabled = !selection.length;
  return (
    <Card title={t('actionPoint')}>
      <div className="flex gap-4">
        <VerticalTravel value={value} min={range.apMin} max={range.apMax} step={range.step} onChange={set} disabled={disabled} />
        <div className="flex flex-1 flex-col justify-between gap-3">
          <p className="text-xs leading-relaxed text-mute">{disabled ? t('noSelection') : t('actionPointHint')}</p>
          <div>
            <div className="num grad-text text-4xl font-bold">{fmt(value, range.step)}</div>
            <div className="text-xs text-mute">{t('mm')} · {range.apMin}–{range.apMax}</div>
          </div>
          <div className="flex items-center gap-1.5">
            <Button variant="solid" disabled={disabled} onClick={() => set(value - range.step)} title="↑">↑</Button>
            <input
              type="number"
              aria-label={t('actionPoint')}
              disabled={disabled}
              min={range.apMin}
              max={range.apMax}
              step={range.step}
              value={fmt(value, range.step)}
              onChange={(e) => set(Number(e.target.value))}
              className="num w-20 rounded-lg border border-line bg-panel2 px-2 py-1.5 text-sm disabled:opacity-40"
            />
            <Button variant="solid" disabled={disabled} onClick={() => set(value + range.step)} title="↓">↓</Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

/** Vertical travel slider with a switch illustration: top = shallow, bottom = deep. */
function VerticalTravel({ value, min, max, step, onChange, disabled }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; disabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const H = 200;
  const frac = (value - min) / (max - min);
  const fromY = (clientY: number) => {
    const r = ref.current!.getBoundingClientRect();
    onChange(min + clamp((clientY - r.top) / r.height, 0, 1) * (max - min));
  };
  return (
    <div className={cx('relative flex w-20 shrink-0 flex-col items-center', disabled && 'opacity-40')}>
      <svg width="64" height="54" viewBox="0 0 64 54" aria-hidden="true">
        <rect x="22" y={4 + frac * 14} width="20" height="16" rx="3" fill="#ff6a1a" />
        <rect x="28" y={18 + frac * 14} width="8" height="14" fill="#ff6a1a" opacity=".6" />
        <rect x="6" y="32" width="52" height="18" rx="5" fill="var(--panel2)" stroke="var(--line)" />
      </svg>
      <div
        ref={ref}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-orientation="vertical"
        className="relative mt-1 w-3 cursor-ns-resize rounded-full bg-line"
        style={{ height: H }}
        onPointerDown={(e) => {
          if (disabled) return;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          fromY(e.clientY);
        }}
        onPointerMove={(e) => !disabled && e.buttons === 1 && fromY(e.clientY)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            e.stopPropagation();
            onChange(value + (e.key === 'ArrowDown' ? 1 : -1) * step * (e.shiftKey ? 10 : 1));
          }
        }}
      >
        <div className="grad absolute inset-x-0 top-0 rounded-full" style={{ height: `${frac * 100}%` }} />
        <div className="absolute -start-1.5 h-6 w-6 -translate-y-1/2 rounded-full border-2 border-white bg-accent shadow" style={{ top: `${frac * 100}%` }} />
      </div>
      <div className="mt-1 flex w-full justify-between text-[10px] text-mute">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

function RapidTriggerPanel({ range }: { range: TravelRange }) {
  const t = useT();
  const profile = useApp((s) => s.active());
  const selection = useApp((s) => s.selection);
  const update = useApp((s) => s.updateActive);
  const first = selection[0];
  const setArr = (arr: 'ds' | 'us', v: number) => update((p) => selection.forEach((s) => (p[arr][s] = clamp(round(v, range.step), range.rtMin, range.rtMax))));
  return (
    <Card>
      <Row label={t('rapidTrigger')} tip={t('rtHint')}>
        <Toggle
          label={t('rapidTrigger')}
          checked={profile.rapidTrigger}
          onChange={(v) =>
            update((p) => {
              p.rapidTrigger = v;
              if (!v) (p.lastWin.enabled = false), (p.rdt.enabled = false);
            })
          }
        />
      </Row>
      {profile.rapidTrigger && (
        <div className="mt-2 space-y-3 border-t border-line pt-3">
          {!selection.length && <p className="text-xs text-mute">{t('noSelection')}</p>}
          <div>
            <div className="mb-1 text-xs text-mute">{t('downstroke')}</div>
            <Slider label={t('downstroke')} value={first !== undefined ? (profile.ds[first] ?? 0) : 0} min={range.rtMin} max={range.rtMax} step={range.step} onChange={(v) => setArr('ds', v)} disabled={!selection.length} suffix=" mm" />
          </div>
          <div>
            <div className="mb-1 text-xs text-mute">{t('upstroke')}</div>
            <Slider label={t('upstroke')} value={first !== undefined ? (profile.us[first] ?? 0) : 0} min={range.rtMin} max={range.rtMax} step={range.step} onChange={(v) => setArr('us', v)} disabled={!selection.length} suffix=" mm" />
          </div>
        </div>
      )}
    </Card>
  );
}

function ModesPanel() {
  const t = useT();
  const profile = useApp((s) => s.active());
  const update = useApp((s) => s.updateActive);
  return (
    <Card>
      <Row label={t('turbo')} tip={t('turboHint')}>
        <Toggle
          label={t('turbo')}
          checked={profile.turbo}
          onChange={(v) =>
            update((p) => {
              p.turbo = v;
              if (v) {
                // official driver couplings: Turbo ⊥ tracking, Turbo ⊥ LW/RDT
                if (p.keystrokeTracking) void setTracking(false);
                p.keystrokeTracking = false;
                p.lastWin.enabled = false;
                p.rdt.enabled = false;
              }
            })
          }
        />
      </Row>
      <Row label={t('tracking')} tip={t('trackingHint')}>
        <Toggle
          label={t('tracking')}
          checked={profile.keystrokeTracking}
          onChange={(v) => {
            update((p) => {
              p.keystrokeTracking = v;
              if (v) p.turbo = false;
            });
            void setTracking(v);
          }}
        />
      </Row>
      <Row label={t('lastWin')} tip={t('lastWinHint')} badge={<ExperimentalBadge />}>
        <Toggle
          label={t('lastWin')}
          checked={profile.lastWin.enabled}
          onChange={(v) =>
            update((p) => {
              p.lastWin.enabled = v;
              if (v) (p.rapidTrigger = true), (p.turbo = false);
            })
          }
        />
      </Row>
      <Row label={t('rdt')} tip={t('rdtHint')} badge={<ExperimentalBadge />}>
        <Toggle
          label={t('rdt')}
          checked={profile.rdt.enabled}
          onChange={(v) =>
            update((p) => {
              p.rdt.enabled = v;
              if (v) (p.rapidTrigger = true), (p.turbo = false);
            })
          }
        />
      </Row>
    </Card>
  );
}

function PairsPanel({ layout }: { layout: Layout }) {
  const t = useT();
  const profile = useApp((s) => s.active());
  const selection = useApp((s) => s.selection);
  const update = useApp((s) => s.updateActive);
  const label = (s: number) => layout.keys.find((k) => k.slot === s)?.label ?? `#${s}`;
  if (!profile.lastWin.enabled && !profile.rdt.enabled) return null;
  const two = selection.length === 2 ? ([selection[0]!, selection[1]!] as [number, number]) : null;
  return (
    <Card>
      {profile.lastWin.enabled && (
        <div className="mb-3">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span>{t('lastWin')}</span>
            <Button variant="solid" disabled={!two} title={t('pickTwo')} onClick={() => two && update((p) => void p.lastWin.pairs.push(two))}>+ {t('addPair')}</Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {profile.lastWin.pairs.map(([a, b], i) => (
              <Chip key={i} onRemove={() => update((p) => void p.lastWin.pairs.splice(i, 1))}>{label(a)} ⇄ {label(b)}</Chip>
            ))}
          </div>
        </div>
      )}
      {profile.rdt.enabled && (
        <div>
          <div className="mb-2 flex items-center justify-between text-sm">
            <span>{t('rdt')}</span>
            <Button variant="solid" disabled={!two} title={t('pickTwo')} onClick={() => two && update((p) => {
              p.rdt.pairs.push(two);
              // the official driver bumps the release key's upstroke to 1.5 mm so firmware treats it as a release target
              if ((p.us[two[1]] ?? 0) <= 0) p.us[two[1]] = 1.5;
            })}>+ {t('addPair')}</Button>
          </div>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {profile.rdt.pairs.map(([a, b], i) => (
              <Chip key={i} onRemove={() => update((p) => void p.rdt.pairs.splice(i, 1))}>{label(a)} → {label(b)}</Chip>
            ))}
          </div>
          <div className="text-xs text-mute">{t('activeAt')}</div>
          <Slider label={t('activeAt')} value={profile.rdt.activeMm} min={0.05} max={0.25} step={0.01} onChange={(v) => update((p) => void (p.rdt.activeMm = v))} suffix=" mm" />
          <div className="mt-2 text-xs text-mute">{t('resetAt')}</div>
          <Slider label={t('resetAt')} value={profile.rdt.resetMm} min={1.5} max={2.5} step={0.05} onChange={(v) => update((p) => void (p.rdt.resetMm = v))} suffix=" mm" />
        </div>
      )}
      <p className="mt-2 text-[11px] text-mute">{t('pickTwo')}</p>
    </Card>
  );
}

function Chip({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-line bg-panel2 py-0.5 ps-2.5 pe-1 text-xs">
      {children}
      <button type="button" onClick={onRemove} className="grid h-4 w-4 place-items-center rounded-full text-mute hover:bg-line hover:text-ink" aria-label="remove">×</button>
    </span>
  );
}

function LiveGraph({ profile, focus }: { profile: Profile; focus: number }) {
  const t = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const hist = useRef<number[]>([]);
  const [now, setNow] = useState(0);
  useEffect(() => {
    hist.current = [];
    return subscribeDepth(() => {
      hist.current.push(liveDepth[focus] ?? 0);
      if (hist.current.length > 240) hist.current.shift();
      setNow(liveDepth[focus] ?? 0);
      const c = canvas.current;
      const g = c?.getContext('2d');
      if (!c || !g) return;
      const w = (c.width = c.clientWidth * devicePixelRatio);
      const h = (c.height = c.clientHeight * devicePixelRatio);
      g.clearRect(0, 0, w, h);
      const y = (mm: number) => (mm / MAX_TRAVEL) * (h - 8) + 4;
      const css = getComputedStyle(document.documentElement);
      const lineAt = (mm: number, colour: string, text: string) => {
        g.strokeStyle = colour;
        g.setLineDash([6, 6]);
        g.beginPath();
        g.moveTo(0, y(mm));
        g.lineTo(w, y(mm));
        g.stroke();
        g.setLineDash([]);
        g.fillStyle = colour;
        g.font = `${11 * devicePixelRatio}px sans-serif`;
        g.fillText(`${text} ${mm.toFixed(2)}`, 6, y(mm) - 4);
      };
      const ap = profile.ap[focus] ?? 2;
      lineAt(ap, '#ff6a1a', t('actuationLine'));
      if (profile.rapidTrigger && (profile.us[focus] ?? 0) > 0) lineAt(Math.max(0, ap - (profile.us[focus] ?? 0)), '#38bdf8', t('resetLine'));
      g.strokeStyle = css.getPropertyValue('--ink') || '#fff';
      g.lineWidth = 2 * devicePixelRatio;
      g.beginPath();
      hist.current.forEach((v, i) => {
        const x = (i / 239) * w;
        if (i === 0) g.moveTo(x, y(v));
        else g.lineTo(x, y(v));
      });
      g.stroke();
    });
  }, [focus, profile, t]);
  return (
    <Card title={`${t('liveView')} · #${focus}`} right={<span className="num font-mono text-sm">{t('depth')} {now.toFixed(2)} {t('mm')}</span>}>
      <canvas ref={canvas} className="h-40 w-full rounded-lg bg-panel2" />
    </Card>
  );
}
