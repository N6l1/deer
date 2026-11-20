import { useState } from 'react';
import { useLogi, refreshLogitech, disconnectLogitech, planLogitech, planLogiMode, applyLogitech, type PlannedLogiWrite } from '../state/logitech';
import { useApp } from '../state/store';
import { useT } from '../i18n';
import { toHexTrimmed } from '../device/packets';
import { Badge, Button, Card, Modal, Slider, cx } from './common';

export function LogitechPanel() {
  const t = useT();
  const s = useLogi();
  const dry = useApp((x) => x.settings.dryRun);
  const [plan, setPlan] = useState<PlannedLogiWrite[] | null>(null);
  const pending = s.status === 'connected' ? planLogitech() : [];
  if (!s.model) return null;
  const caps = s.caps;
  const bat = s.info.battery;

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <div className="flex min-w-0 flex-col gap-4">
        <Card>
          <div className="flex flex-wrap items-center gap-4">
            <div className="grid h-12 w-12 place-items-center rounded-xl bg-panel2 text-xl font-black text-accent">G</div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-lg font-semibold">
                Logitech {s.info.name ?? 'mouse'}
                <Badge tone="info">{s.model.wireless ? t('lightspeed') : t('wired')}</Badge>
                {s.kind === 'mock' && <Badge tone="info">demo</Badge>}
              </div>
              <div className="mt-0.5 text-xs text-mute">
                {s.info.dpi ? `${s.info.dpi.x}${s.info.dpi.y !== s.info.dpi.x ? ` × ${s.info.dpi.y}` : ''} DPI` : 'DPI —'} ·{' '}
                {s.info.reportRate ? `${s.info.reportRate} Hz` : '— Hz'} · {s.info.mode === 'onboard' ? t('onboardMode') : s.info.mode === 'host' ? t('hostMode') : '—'}
              </div>
            </div>
            {bat && bat.percent !== null && (
              <div className="w-40">
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-mute">{t('battery')}</span>
                  <span className="num">{bat.percent}%{bat.charging ? ` · ${t('charging')}` : ''}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-line">
                  <div className={cx('h-full rounded-full', bat.percent < 20 ? 'bg-red-500' : 'grad')} style={{ width: `${bat.percent}%` }} />
                </div>
              </div>
            )}
            <div className="flex gap-1">
              <Button variant="solid" disabled={s.busy} onClick={() => void refreshLogitech()}>{t('mouseRefresh')}</Button>
              <Button variant="ghost" onClick={() => void disconnectLogitech()}>{t('disconnect')}</Button>
            </div>
          </div>
          {s.error && <p className="mt-3 rounded-lg bg-amber-500/10 p-2.5 text-sm text-amber-300">{s.error}</p>}
        </Card>

        {!!s.info.rates?.length && (
          <Card title={t('pollingTitle')} right={s.info.reportRate ? <Badge tone="info">{t('pollingNow', { hz: s.info.reportRate })}</Badge> : undefined}>
            <div className="grid grid-cols-4 gap-1.5">
              {s.info.rates.map((hz) => (
                <button
                  key={hz}
                  type="button"
                  onClick={() => useLogi.setState({ draftRate: hz })}
                  className={cx(
                    'rounded-lg border py-2 text-xs transition',
                    s.draftRate === hz ? 'border-accent bg-accent/10 font-semibold text-ink' : 'border-line text-mute hover:border-accent/50 hover:text-ink',
                  )}
                >
                  <span dir="ltr">{hz >= 1000 ? `${hz / 1000}k` : hz} Hz</span>
                </button>
              ))}
            </div>
            <div className="mt-3 rounded-lg bg-panel2 p-2.5 text-[11px] leading-relaxed text-mute">
              {s.info.mode === 'host' ? (
                <>
                  <div className="mb-1 font-semibold text-ink">{t('modeHost')}</div>
                  {t('pollingHostNote')}
                  <Button variant="solid" className="mt-2 w-full" onClick={() => setPlan(planLogiMode('onboard'))}>
                    {t('toOnboard', { n: s.savedProfile })}
                  </Button>
                </>
              ) : (
                <>
                  <div className="mb-1 font-semibold text-ink">{t('modeOnboard', { n: s.info.activeProfile ?? '?' })}</div>
                  {t('pollingOnboardNote')}
                  <Button variant="solid" className="mt-2 w-full" onClick={() => setPlan(planLogiMode('host'))}>
                    {t('toHost')}
                  </Button>
                </>
              )}
            </div>
          </Card>
        )}
        {caps && s.draft && (
          <Card
            title={t('hitsTitle')}
            right={
              <Button variant="ghost" onClick={() => s.setDraft((d) => void (d[1] = { ...d[0]!, rtFlag: d[1]!.rtFlag }))}>
                {t('copyLeftRight')}
              </Button>
            }
          >
            <p className="mb-3 text-xs leading-relaxed text-mute">{t('hitsIntro')}</p>
            <div className="grid gap-3 md:grid-cols-2">
              {s.draft.map((b, i) => (
                <div key={i} className="rounded-xl border border-line p-4">
                  <div className="mb-3 text-sm font-semibold">{i === 0 ? t('leftButton') : t('rightButton')}</div>
                  <div className="text-xs text-mute">{t('hitsActuation')}</div>
                  <Slider label={t('hitsActuation')} value={b.actuation} min={1} max={caps.maxActuation} step={1} onChange={(v) => s.setDraft((d) => void (d[i]!.actuation = v))} />
                  <div className="mb-3 mt-0.5 flex justify-between text-[10px] text-mute">
                    <span>{t('shallow')}</span>
                    <span>{t('deep')}</span>
                  </div>
                  <div className="text-xs text-mute">{t('hitsRapid')}</div>
                  <Slider label={t('hitsRapid')} value={b.rapidTrigger} min={1} max={caps.maxRapidTrigger} step={1} onChange={(v) => s.setDraft((d) => void (d[i]!.rapidTrigger = v))} />
                  <div className="mt-3 text-xs text-mute">{t('hitsHaptics')}</div>
                  <Slider label={t('hitsHaptics')} value={b.haptics} min={0} max={caps.maxHaptics} step={1} onChange={(v) => s.setDraft((d) => void (d[i]!.haptics = v))} />
                  <div className="mt-0.5 text-[10px] text-mute">0 = {t('off')}</div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <Card title={t('dpiAndRate')}>
          <p className="text-xs leading-relaxed text-mute">{t('logiOnboardNote')}</p>
        </Card>
        <p className="rounded-xl border border-line p-3 text-[11px] leading-relaxed text-mute">{t('logiNotYet')}</p>
        <div className="flex items-center justify-end gap-2">
          <span className="text-xs text-mute">{pending.length ? t('mouseChanges', { n: pending.length }) : t('noChanges')}</span>
          <Button variant="ghost" disabled={!pending.length} onClick={() => s.resetDraft()}>{t('cancel')}</Button>
          <Button variant="primary" disabled={!pending.length || s.busy} onClick={() => setPlan(pending)}>{t('mouseApply')}</Button>
        </div>
      </div>

      <Modal
        open={!!plan}
        onClose={() => setPlan(null)}
        title={t('mousePlanTitle', { n: plan?.length ?? 0 })}
        footer={
          <>
            <Button onClick={() => setPlan(null)}>{t('cancel')}</Button>
            <Button variant="primary" onClick={() => { const p = plan!; setPlan(null); void applyLogitech(p); }}>
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
              <div className="break-all text-mute">11 | {toHexTrimmed(p.payload)}</div>
            </li>
          ))}
        </ol>
      </Modal>
    </div>
  );
}
