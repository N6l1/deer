import { useState } from 'react';
import { useMouse, connectAnyMouse, connectMockMouse, disconnectMouse, refreshMouse, planMouseWrites, applyMouse, type PlannedMouseWrite } from '../state/mouse';
import { useApp } from '../state/store';
import { useT } from '../i18n';
import { isWebHidSupported } from '../device/webhid';
import { toHexTrimmed } from '../device/packets';
import { lowBatteryPercent, lowBatteryRaw } from '../device/razer/protocol';
import { Badge, Button, Card, Modal, Slider, Toggle, cx } from './common';
import { useLogi, connectMockLogitech } from '../state/logitech';
import { LogitechPanel } from './LogitechPanel';

export function MouseTab() {
  const t = useT();
  const m = useMouse();
  const logi = useLogi((x) => x.status);
  const dry = useApp((s) => s.settings.dryRun);
  const [plan, setPlan] = useState<PlannedMouseWrite[] | null>(null);
  const [lock, setLock] = useState(true);
  const pending = m.draft ? planMouseWrites() : [];

  if (logi === 'connected') return <LogitechPanel />;
  if (m.status !== 'connected' || !m.model || !m.draft) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center gap-4 py-16 text-center">
        <MouseIcon />
        <h2 className="text-lg font-semibold">{m.status === 'connecting' || logi === 'connecting' ? t('connecting') : t('mouseNone')}</h2>
        <p className="text-sm text-mute">{t('mouseIntro')}</p>
        <div className="flex gap-2">
          <Button variant="primary" disabled={!isWebHidSupported() || m.status === 'connecting' || logi === 'connecting'} onClick={() => void connectAnyMouse()}>{t('mouseConnect')}</Button>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="solid" onClick={() => void connectMockMouse()}>{t('mouseDemo')}: Razer Viper V4 Pro</Button>
          <Button variant="solid" onClick={() => void connectMockLogitech()}>{t('mouseDemo')}: Logitech PRO X2 SUPERSTRIKE</Button>
        </div>
        <p className="text-xs text-mute">{t('mousePickHint')}</p>
        {m.error && <p className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-300">{m.error}</p>}
      </div>
    );
  }

  const d = m.draft;
  const model = m.model;
  const set = m.setDraft;
  const stageDpi = (v: number) => Math.max(model.dpiMin, Math.min(model.dpiMax, Math.round(v / 50) * 50 || model.dpiMin));

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <div className="flex min-w-0 flex-col gap-4">
        <Card>
          <div className="flex flex-wrap items-center gap-4">
            <MouseIcon small />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-lg font-semibold">
                Razer {model.name}
                <Badge tone="info">{model.wireless ? t('wireless') : t('wired')}</Badge>
                {m.kind === 'mock' && <Badge tone="info">demo</Badge>}
              </div>
              <div className="mt-0.5 text-xs text-mute">
                {t('firmwareVer')} {m.info.firmware ?? '—'} · {t('serial')} {m.info.serial || '—'}
              </div>
            </div>
            {m.info.battery !== undefined && (
              <div className="w-40">
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-mute">{t('battery')}</span>
                  <span className="num">{m.info.battery}%{m.info.charging ? ` · ${t('charging')}` : ''}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-line">
                  <div className={cx('h-full rounded-full', m.info.battery < 20 ? 'bg-red-500' : 'grad')} style={{ width: `${m.info.battery}%` }} />
                </div>
              </div>
            )}
            <div className="flex gap-1">
              <Button variant="solid" disabled={m.busy} onClick={() => void refreshMouse()}>{t('mouseRefresh')}</Button>
              <Button variant="ghost" onClick={() => void disconnectMouse()}>{t('disconnect')}</Button>
            </div>
          </div>
          {m.error && <p className="mt-3 rounded-lg bg-amber-500/10 p-2.5 text-sm text-amber-300">{m.error}</p>}
        </Card>

        <Card
          title={t('dpiStages')}
          right={
            <label className="flex items-center gap-2 text-xs text-mute">
              {t('lockXY')}
              <Toggle label={t('lockXY')} checked={lock} onChange={setLock} />
            </label>
          }
        >
          <div className="flex flex-col gap-2">
            {d.stages.map((s, i) => (
              <div key={i} className={cx('flex flex-wrap items-center gap-3 rounded-xl border p-3', d.active === i + 1 ? 'border-accent/60 bg-accent/5' : 'border-line')}>
                <button
                  type="button"
                  aria-label={`${t('activeStage')} ${i + 1}`}
                  onClick={() => set((x) => void (x.active = i + 1))}
                  className={cx('grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 text-sm font-bold', d.active === i + 1 ? 'grad border-transparent text-white' : 'border-line text-mute')}
                >
                  {i + 1}
                </button>
                <div className="min-w-48 flex-1">
                  <Slider
                    label={`DPI ${i + 1}`}
                    value={s.x}
                    min={model.dpiMin}
                    max={Math.min(model.dpiMax, 6400)}
                    step={50}
                    onChange={(v) => set((x) => ((x.stages[i]!.x = stageDpi(v)), lock && (x.stages[i]!.y = stageDpi(v))))}
                  />
                </div>
                <label className="flex items-center gap-1 text-xs text-mute">
                  X
                  <input
                    type="number"
                    min={model.dpiMin}
                    max={model.dpiMax}
                    step={50}
                    value={s.x}
                    onChange={(e) => set((x) => ((x.stages[i]!.x = stageDpi(Number(e.target.value))), lock && (x.stages[i]!.y = stageDpi(Number(e.target.value)))))}
                    className="num w-24 rounded-lg border border-line bg-panel2 px-2 py-1 text-sm text-ink"
                  />
                </label>
                {!lock && (
                  <label className="flex items-center gap-1 text-xs text-mute">
                    Y
                    <input
                      type="number"
                      min={model.dpiMin}
                      max={model.dpiMax}
                      step={50}
                      value={s.y}
                      onChange={(e) => set((x) => void (x.stages[i]!.y = stageDpi(Number(e.target.value))))}
                      className="num w-24 rounded-lg border border-line bg-panel2 px-2 py-1 text-sm text-ink"
                    />
                  </label>
                )}
                <Button
                  variant="ghost"
                  disabled={d.stages.length <= 1}
                  onClick={() =>
                    set((x) => {
                      x.stages.splice(i, 1);
                      x.active = Math.min(x.active, x.stages.length);
                    })
                  }
                >
                  {t('removeStage')}
                </Button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between">
            <Button
              variant="solid"
              disabled={d.stages.length >= model.maxStages}
              onClick={() =>
                set((x) => {
                  const last = x.stages[x.stages.length - 1];
                  const firstId = x.stages[0]?.id ?? 1;
                  x.stages.push({ id: firstId + x.stages.length, x: stageDpi((last?.x ?? 800) * 2), y: stageDpi((last?.y ?? 800) * 2) });
                })
              }
            >
              + {t('addStage')}
            </Button>
            <span className="text-xs text-mute">{model.dpiMin}–{model.dpiMax.toLocaleString()} DPI · {d.stages.length}/{model.maxStages}</span>
          </div>
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        <Card title={t('pollRate')}>
          <div className="grid grid-cols-3 gap-1.5">
            {model.pollRates.map((hz) => (
              <button
                key={hz}
                type="button"
                onClick={() => set((x) => void (x.pollRate = hz))}
                className={cx('rounded-lg border py-2 text-sm transition', d.pollRate === hz ? 'border-accent bg-accent/10 font-semibold' : 'border-line text-mute hover:border-accent/50 hover:text-ink')}
              >
                <span dir="ltr">{hz >= 1000 ? `${hz / 1000}k` : hz} Hz</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-mute">{t('pollHint')}</p>
        </Card>

        <Card title={t('power')}>
          <div className="mb-1 text-sm">{t('sleepAfter')}</div>
          <Slider label={t('sleepAfter')} value={Math.round(d.idle / 60)} min={1} max={15} step={1} suffix={` ${t('minutes')}`} onChange={(v) => set((x) => void (x.idle = v * 60))} />
          <div className="mb-1 mt-4 text-sm">{t('lowBatteryAt')}</div>
          <Slider label={t('lowBatteryAt')} value={lowBatteryPercent(d.lowBattery)} min={5} max={24} step={1} suffix="%" onChange={(v) => set((x) => void (x.lowBattery = Math.max(0x0c, Math.min(0x3f, lowBatteryRaw(v)))))} />
        </Card>

        <p className="rounded-xl border border-line p-3 text-[11px] leading-relaxed text-mute">{t('mouseNotYet')}</p>

        <div className="flex items-center justify-end gap-2">
          <span className="text-xs text-mute">{pending.length ? t('mouseChanges', { n: pending.length }) : t('noChanges')}</span>
          <Button variant="ghost" disabled={!pending.length} onClick={() => m.resetDraft()}>{t('cancel')}</Button>
          <Button variant="primary" disabled={!pending.length || m.busy} onClick={() => setPlan(pending)}>{t('mouseApply')}</Button>
        </div>
      </div>

      <Modal
        open={!!plan}
        onClose={() => setPlan(null)}
        title={t('mousePlanTitle', { n: plan?.length ?? 0 })}
        footer={
          <>
            <Button onClick={() => setPlan(null)}>{t('cancel')}</Button>
            <Button variant="primary" onClick={() => { const p = plan!; setPlan(null); void applyMouse(p); }}>
              {t('send')}{dry ? ' (dry-run)' : ''}
            </Button>
          </>
        }
      >
        {dry && <p className="mb-3 rounded-lg bg-sky-500/10 p-2.5 text-sm text-sky-300">{t('planDry')}</p>}
        <ol className="space-y-1.5 font-mono text-[11px]">
          {plan?.map((p, i) => (
            <li key={i} className="rounded-lg bg-panel2 p-2">
              <div className="mb-0.5 font-sans text-xs text-ink">{i + 1}. {p.label}</div>
              <div className="break-all text-mute">feature 00 | {toHexTrimmed(p.report)}</div>
            </li>
          ))}
        </ol>
      </Modal>
    </div>
  );
}

function MouseIcon({ small }: { small?: boolean }) {
  const s = small ? 40 : 72;
  return (
    <svg width={s} height={s * 1.4} viewBox="0 0 50 70" aria-hidden="true">
      <defs>
        <linearGradient id="mz" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff9a2a" />
          <stop offset="1" stopColor="#ff2d55" />
        </linearGradient>
      </defs>
      <path d="M25 2C11 2 4 14 4 30v14c0 14 9 24 21 24s21-10 21-24V30C46 14 39 2 25 2Z" fill="var(--panel2)" stroke="url(#mz)" strokeWidth="2.5" />
      <path d="M25 2v24M4 28h42" stroke="var(--line)" strokeWidth="2" />
      <rect x="22" y="10" width="6" height="11" rx="3" fill="url(#mz)" />
    </svg>
  );
}
