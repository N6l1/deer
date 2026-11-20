import { useEffect, useRef, useState } from 'react';
import { useMad, connectMad, connectMockMad, disconnectMad, refreshMad, setMadLive, planMad, pendingMad, applyMad, type PlannedMadWrite } from '../state/madlions';
import { useApp, liveDepth, subscribeDepth } from '../state/store';
import { useT } from '../i18n';
import { isWebHidSupported } from '../device/webhid';
import { toHexTrimmed } from '../device/packets';
import { MAD68_LAYOUT, MAD68_PRESETS, MAD_EFFECTS, TRAVEL_MAX, TRAVEL_MIN, BRIGHTNESS_MAX } from '../device/madlions/protocol';
import { Badge, Button, Card, Modal, Row, Slider, Toggle, cx } from './common';
import { KeyboardMap } from './KeyboardMap';

const fmt = (v: number) => v.toFixed(2);
const toHex = (r: number, g: number, b: number) => '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');

export function MadlionsTab() {
  const t = useT();
  const m = useMad();
  const dry = useApp((s) => s.settings.dryRun);
  const [plan, setPlan] = useState<PlannedMadWrite[] | null>(null);
  const mapRef = useRef<HTMLDivElement | null>(null);
  const layout = MAD68_LAYOUT;

  useEffect(() => {
    if (!m.live) {
      mapRef.current?.querySelectorAll<HTMLElement>('[data-slot]').forEach((el) => el.style.setProperty('--depth', '0'));
      return;
    }
    return subscribeDepth(() =>
      mapRef.current?.querySelectorAll<HTMLElement>('[data-slot]').forEach((el) => el.style.setProperty('--depth', String(Math.min(1, (liveDepth[Number(el.dataset.slot)] ?? 0) / 3.6)))),
    );
  }, [m.live]);

  if (m.status !== 'connected' || !m.board) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center gap-4 py-16 text-center">
        <div className="grid h-16 w-16 place-items-center rounded-2xl bg-panel2 text-2xl font-black text-accent">68</div>
        <h2 className="text-lg font-semibold">{m.status === 'connecting' ? t('connecting') : t('madNone')}</h2>
        <p className="text-sm text-mute">{t('madIntro')}</p>
        <div className="flex gap-2">
          <Button variant="primary" disabled={!isWebHidSupported() || m.status === 'connecting'} onClick={() => void connectMad()}>{t('madConnect')}</Button>
          <Button variant="solid" onClick={() => void connectMockMad()}>{t('mouseDemo')}</Button>
        </div>
        {m.error && <p className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-300">{m.error}</p>}
      </div>
    );
  }

  const d = m.draft;
  const sel = m.selection;
  const first = sel[0];
  const pending = pendingMad();
  const changed = (s: number) => !!m.device && !!d && (Math.abs((d.act[s] ?? 0) - (m.device.act[s] ?? 0)) > 1e-6 || JSON.stringify(d.rt[s]) !== JSON.stringify(m.device.rt[s]));
  const edit = (fn: (x: NonNullable<typeof d>, i: number) => void) => m.setDraft((x) => sel.forEach((i) => fn(x, i)));
  const clampT = (v: number) => Math.max(TRAVEL_MIN, Math.min(TRAVEL_MAX, Math.round(v * 100) / 100));
  const light = d?.light;
  const effect = MAD_EFFECTS.find((e) => e.n === light?.effect);

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
      <div className="flex min-w-0 flex-col gap-4">
        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-lg font-semibold">MADLIONS {m.board.name}</div>
            <Badge tone="info">protocol {m.protocol ?? '?'}</Badge>
            {m.kind === 'mock' && <Badge tone="info">demo</Badge>}
            {!m.board.verified && <Badge>{t('experimentalBadge')}</Badge>}
            <div className="ms-auto flex gap-1">
              <label className="me-2 flex items-center gap-2 text-xs text-mute">
                {t('liveView')}
                <Toggle label={t('liveView')} checked={m.live} onChange={(v) => setMadLive(v)} />
              </label>
              <Button variant="solid" disabled={m.busy} onClick={() => void refreshMad()}>{t('mouseRefresh')}</Button>
              <Button variant="ghost" onClick={() => void disconnectMad()}>{t('disconnect')}</Button>
            </div>
          </div>
          {m.writeBlock && <p className="mt-3 rounded-lg bg-amber-500/10 p-2.5 text-sm text-amber-300">{t('madReadOnly')}: {m.writeBlock}</p>}
          {m.error && <p className="mt-3 rounded-lg bg-amber-500/10 p-2.5 text-sm text-amber-300">{m.error}</p>}
        </Card>

        <Card>
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <Button variant="solid" onClick={() => m.setSelection(MAD68_PRESETS.wasd)}>{t('wasd')}</Button>
            <Button variant="solid" onClick={() => m.setSelection(layout.keys.map((k) => k.slot))}>{t('allKeys')}</Button>
            <Button variant="ghost" onClick={() => m.setSelection([])}>{t('clear')}</Button>
            <span className="ms-2 text-xs text-mute">{sel.length ? t('selected', { n: sel.length }) : t('selectHint')}</span>
          </div>
          {d && (
            <KeyboardMap
              layout={layout}
              selection={sel}
              onSelect={m.setSelection}
              containerRef={mapRef}
              renderCap={(k, u) => {
                const rt = d.rt[k.slot];
                return (
                  <div className="flex h-full flex-col justify-between leading-none" style={{ padding: u * 0.08 }}>
                    <span className="truncate font-medium" style={{ fontSize: Math.max(9, u * 0.21) }}>{k.label}</span>
                    {u > 38 && (
                      <span className="num flex gap-[0.3em] tracking-tight" style={{ fontSize: Math.max(8, u * 0.155) }}>
                        <span className={changed(k.slot) ? 'font-bold text-hl' : 'text-ink/85'}>{fmt(d.act[k.slot] ?? 0)}</span>
                        {rt?.enabled && <span className="text-accent">RT</span>}
                      </span>
                    )}
                  </div>
                );
              }}
            />
          )}
          <p className="mt-2 text-center text-[11px] text-mute">{t('madCapHint')}</p>
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        {d && (
          <Card title={t('actionPoint')}>
            {first === undefined ? (
              <p className="text-xs text-mute">{t('noSelection')}</p>
            ) : (
              <>
                <div className="num grad-text text-3xl font-bold">{fmt(d.act[first] ?? 0)} <span className="text-sm">{t('mm')}</span></div>
                <Slider label={t('actionPoint')} value={d.act[first] ?? 1.5} min={TRAVEL_MIN} max={TRAVEL_MAX} step={0.01} onChange={(v) => edit((x, i) => (x.act[i] = clampT(v)))} />
                <div className="mt-1 text-[10px] text-mute">{TRAVEL_MIN}–{TRAVEL_MAX} {t('mm')}</div>
                <div className="mt-4 border-t border-line pt-3">
                  <Row label={t('rapidTrigger')} tip={t('rtHint')}>
                    <Toggle label={t('rapidTrigger')} checked={!!d.rt[first]?.enabled} onChange={(v) => edit((x, i) => (x.rt[i] = { ...x.rt[i]!, enabled: v }))} />
                  </Row>
                  {d.rt[first]?.enabled && (
                    <>
                      <div className="mt-1 text-xs text-mute">{t('downstroke')}</div>
                      <Slider label={t('downstroke')} value={d.rt[first]?.press ?? 0.5} min={TRAVEL_MIN} max={2} step={0.01} suffix=" mm" onChange={(v) => edit((x, i) => (x.rt[i] = { ...x.rt[i]!, press: clampT(v) }))} />
                      <div className="mt-2 text-xs text-mute">{t('upstroke')}</div>
                      <Slider label={t('upstroke')} value={d.rt[first]?.release ?? 0.5} min={TRAVEL_MIN} max={2} step={0.01} suffix=" mm" onChange={(v) => edit((x, i) => (x.rt[i] = { ...x.rt[i]!, release: clampT(v) }))} />
                    </>
                  )}
                </div>
              </>
            )}
          </Card>
        )}

        {light && (
          <Card title={t('effect')}>
            <select
              aria-label={t('effect')}
              value={light.effect}
              onChange={(e) => m.setDraft((x) => void (x.light = { ...x.light!, effect: Number(e.target.value) }))}
              className="w-full rounded-lg border border-line bg-panel2 px-2 py-1.5 text-sm"
            >
              {MAD_EFFECTS.map((e) => <option key={e.n} value={e.n}>{e.name}</option>)}
            </select>
            <div className="mt-3 text-xs text-mute">{t('brightness')}</div>
            <Slider label={t('brightness')} value={light.brightness} min={0} max={BRIGHTNESS_MAX} step={1} onChange={(v) => m.setDraft((x) => void (x.light = { ...x.light!, brightness: v }))} />
            <div className="mt-2 text-xs text-mute">{t('speed')}</div>
            <Slider label={t('speed')} value={light.speed} min={1} max={255} step={1} onChange={(v) => m.setDraft((x) => void (x.light = { ...x.light!, speed: v }))} />
            <div className={cx('mt-3 flex items-center gap-2', !effect?.colour && 'opacity-40')}>
              <label htmlFor="madc" className="text-xs text-mute">{t('baseColour')}</label>
              <input
                id="madc"
                type="color"
                disabled={!effect?.colour}
                value={toHex(light.r, light.g, light.b)}
                onChange={(e) => {
                  const n = parseInt(e.target.value.slice(1), 16);
                  m.setDraft((x) => void (x.light = { ...x.light!, r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }));
                }}
                className="h-8 w-12 cursor-pointer rounded border border-line bg-transparent"
              />
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-mute">{t('madColourNote')}</p>
          </Card>
        )}

        <p className="rounded-xl border border-line p-3 text-[11px] leading-relaxed text-mute">{t('madNotYet')}</p>
        <div className="flex items-center justify-end gap-2">
          <span className="text-xs text-mute">{pending ? t('mouseChanges', { n: pending }) : t('noChanges')}</span>
          <Button variant="ghost" disabled={!pending} onClick={() => m.resetDraft()}>{t('cancel')}</Button>
          <Button variant="primary" disabled={!pending || m.busy || !!m.writeBlock} onClick={() => setPlan(planMad())}>{t('save')}</Button>
        </div>
      </div>

      <Modal
        open={!!plan}
        onClose={() => setPlan(null)}
        title={t('planTitle', { n: plan?.length ?? 0 })}
        footer={
          <>
            <Button onClick={() => setPlan(null)}>{t('cancel')}</Button>
            <Button variant="primary" onClick={() => { const p = plan!; setPlan(null); void applyMad(p); }}>
              {t('send')}{dry ? ' (dry-run)' : ''}
            </Button>
          </>
        }
      >
        {dry && <p className="mb-3 rounded-lg bg-sky-500/10 p-2.5 text-sm text-sky-300">{t('planDry')}</p>}
        <p className="mb-3 text-xs text-mute">{t('madFullTable')}</p>
        <ol className="space-y-1.5 font-mono text-[11px]">
          {plan?.map((p, i) => (
            <li key={i} className="rounded-lg bg-panel2 p-2">
              <div className="mb-0.5 font-sans text-xs text-ink">{i + 1}. {p.label}</div>
              <div className="break-all text-mute">{toHexTrimmed(p.payload)}</div>
            </li>
          ))}
        </ol>
      </Modal>
    </div>
  );
}
