import { useRef, useState, useSyncExternalStore } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useApp, type Tab } from '../state/store';
import { connectMock, connectWebHid, currentPlan, disconnect, downloadJson, pendingChanges, runPlan } from '../state/session';
import { LANGS, useT, type Lang } from '../i18n';
import { isWebHidSupported } from '../device/webhid';
import { exportProfiles, importProfiles, type PlannedPacket } from '../device/profile';
import { toHex, toHexTrimmed } from '../device/packets';
import { Badge, Button, Card, Modal, Row, Toggle, confirmAsk, cx } from './common';
import { Logo } from './Logo';
import { useMouse } from '../state/mouse';
import { useLogi } from '../state/logitech';
import { useMad } from '../state/madlions';

const REPO = 'https://github.com/N6l1/deer';
const OFFICIAL_FIRMWARE = 'https://drunkdeer.com/pages/drunkdeer-antler';

export function TopBar({ onSettings }: { onSettings: () => void }) {
  const t = useT();
  const tab = useApp((s) => s.tab);
  const setTab = useApp((s) => s.setTab);
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const tabs: [Tab, Parameters<typeof t>[0]][] = [['colour', 'tabColour'], ['performance', 'tabPerformance'], ['remap', 'tabRemap'], ['mad68', 'tabMad'], ['mouse', 'tabMouse']];
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <Logo />
          <div className="leading-tight">
            <div className="text-base font-bold tracking-tight">Deer<span className="grad-text">Tune</span></div>
            <div className="hidden text-[10px] text-mute sm:block">{t('appTagline')}</div>
          </div>
        </div>
        <nav className="mx-auto flex rounded-xl border border-line bg-panel p-1" aria-label="tabs">
          {tabs.map(([id, key]) => (
            <button key={id} type="button" onClick={() => setTab(id)} aria-current={tab === id} className={cx('rounded-lg px-4 py-1.5 text-sm font-medium transition', tab === id ? 'grad text-white shadow' : 'text-mute hover:text-ink')}>
              {t(key)}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-1">
          <a className="rounded-lg px-2.5 py-1.5 text-xs text-mute hover:bg-panel2 hover:text-ink" href={`${REPO}/blob/main/docs/USER_MANUAL.md`} target="_blank" rel="noreferrer">{t('userManual')}</a>
          <a className="rounded-lg px-2.5 py-1.5 text-xs text-mute hover:bg-panel2 hover:text-ink" href={OFFICIAL_FIRMWARE} target="_blank" rel="noreferrer">{t('firmware')} ↗</a>
          <select aria-label={t('language')} value={settings.lang} onChange={(e) => setSettings({ lang: e.target.value as Lang })} className="rounded-lg border border-line bg-panel px-2 py-1 text-xs">
            {Object.entries(LANGS).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}
          </select>
          <Button variant="ghost" title={settings.theme === 'dark' ? t('lightMode') : t('darkMode')} onClick={() => setSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })}>
            {settings.theme === 'dark' ? '☀' : '☾'}
          </Button>
          <Button variant="ghost" title={t('settings')} onClick={onSettings}>⚙</Button>
        </div>
      </div>
      {tab !== 'mouse' && tab !== 'mad68' && <ConnectionStrip />}
      <DryRunBanner />
    </header>
  );
}

/** Loud warning when a real keyboard is connected but writes are disabled. */
function DryRunBanner() {
  const t = useT();
  const c = useApp((s) => s.connection);
  const tab = useApp((s) => s.tab);
  const mouse = useMouse(useShallow((s) => ({ status: s.status, kind: s.kind })));
  const dry = useApp((s) => s.settings.dryRun);
  const setSettings = useApp((s) => s.setSettings);
  const logi = useLogi(useShallow((s) => ({ status: s.status, kind: s.kind })));
  const mad = useMad(useShallow((s) => ({ status: s.status, kind: s.kind })));
  const real =
    tab === 'mouse'
      ? (mouse.status === 'connected' && mouse.kind !== 'mock') || (logi.status === 'connected' && logi.kind !== 'mock')
      : tab === 'mad68'
        ? mad.status === 'connected' && mad.kind !== 'mock'
        : c.status === 'connected' && c.kind !== 'mock';
  if (!dry || !real) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-sky-500/30 bg-sky-500/10 px-4 py-2 text-sm text-sky-200">
      <span>{t('dryRunBanner')}</span>
      <Button variant="primary" onClick={() => setSettings({ dryRun: false })}>{t('dryRunOff')}</Button>
    </div>
  );
}

function ConnectionStrip() {
  const t = useT();
  const c = useApp((s) => s.connection);
  const dry = useApp((s) => s.settings.dryRun);
  const supported = isWebHidSupported();
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-line/60 px-4 py-2 text-xs">
      <span className={cx('h-2 w-2 rounded-full', c.status === 'connected' ? 'bg-emerald-400' : c.status === 'connecting' ? 'animate-pulse bg-amber-400' : 'bg-line')} />
      {c.status === 'connected' ? (
        <>
          <span className="font-medium">{c.model?.displayName ?? '?'}</span>
          <span className="text-mute">{t('firmwareVer')} {c.identity?.firmwareLabel ?? '—'}</span>
          <span className="text-mute">{c.dialect === 'oldHighPrec' ? '0.01 mm' : '0.1 mm'}</span>
          {c.kind === 'mock' && <Badge tone="info">demo</Badge>}
          {c.model && !c.model.writesEnabled && <Badge>{t('readOnlyModel', { model: c.model.displayName })}</Badge>}
          {c.error && <span className="text-amber-400">{c.error}</span>}
          <Button variant="ghost" onClick={() => void disconnect()}>{t('disconnect')}</Button>
        </>
      ) : (
        <>
          <span className="text-mute">{c.status === 'connecting' ? t('connecting') : t('disconnected')}</span>
          <Button variant="primary" disabled={!supported || c.status === 'connecting'} onClick={() => void connectWebHid()}>{t('connect')}</Button>
          <Button variant="solid" onClick={() => void connectMock()}>{t('connectDemo')}</Button>
          {!supported && <span className="text-amber-400">{t('unsupportedBrowser')}</span>}
        </>
      )}
      <span className="ms-auto">{dry ? <Badge tone="info">{t('dryRun')}</Badge> : <Badge tone="ok">live writes</Badge>}</span>
    </div>
  );
}

export function Sidebar() {
  const t = useT();
  const profiles = useApp((s) => s.profiles);
  const activeId = useApp((s) => s.activeId);
  const s = useApp();
  const file = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const model = s.connection.model?.name ?? s.active().model;

  const onImport = async (f: File) => {
    try {
      const ps = importProfiles(JSON.parse(await f.text()), model);
      s.importProfiles(ps);
      s.toast(`Imported ${ps.length} profile(s)`, 'ok');
    } catch (e) {
      s.toast(String((e as Error).message), 'error');
    }
  };

  return (
    <aside className="flex w-full shrink-0 flex-col gap-3 lg:w-60">
      <Card
        title={t('profiles')}
        right={
          <div className="flex gap-0.5">
            <Button variant="ghost" title={t('addProfile')} onClick={() => s.addProfile()}>＋</Button>
            <Button variant="ghost" title={t('import')} onClick={() => file.current?.click()}>⤒</Button>
            <Button variant="ghost" title={t('exportAll')} onClick={() => downloadJson('deertune-profiles.json', exportProfiles(profiles))}>⤓</Button>
            <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => (e.target.files?.[0] && void onImport(e.target.files[0]), (e.target.value = ''))} />
          </div>
        }
      >
        <ul className="flex flex-col gap-1">
          {profiles.map((p) => (
            <li key={p.id} className="relative">
              <div className={cx('group flex items-center rounded-lg border transition', p.id === activeId ? 'border-accent/60 bg-accent/10' : 'border-transparent hover:bg-panel2')}>
                <button type="button" onClick={() => s.selectProfile(p.id)} className="min-w-0 flex-1 truncate px-3 py-2 text-start text-sm">
                  {p.name}
                  <span className="ms-1.5 text-[10px] text-mute">{p.model}</span>
                </button>
                <button type="button" aria-label={t('settings')} onClick={() => setMenu(menu === p.id ? null : p.id)} className="px-2 py-2 text-mute opacity-60 hover:text-ink group-hover:opacity-100">⋯</button>
              </div>
              {menu === p.id && (
                <div className="absolute end-0 top-10 z-20 w-40 rounded-xl border border-line bg-panel2 p-1 shadow-xl" onMouseLeave={() => setMenu(null)}>
                  {[
                    [t('rename'), () => { const n = window.prompt(t('rename'), p.name); if (n?.trim()) s.renameProfile(p.id, n.trim()); }],
                    [t('duplicate'), () => s.duplicateProfile(p.id)],
                    [t('exportOne'), () => downloadJson(`${p.name}.deertune.json`, exportProfiles([p]))],
                    [t('delete'), () => confirmAsk(t('confirmDelete', { name: p.name })) && s.deleteProfile(p.id)],
                  ].map(([label, fn]) => (
                    <button key={label as string} type="button" onClick={() => ((fn as () => void)(), setMenu(null))} className="block w-full rounded-lg px-3 py-1.5 text-start text-sm hover:bg-line">
                      {label as string}
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] leading-relaxed text-mute">{t('onboardProfiles')}</p>
      </Card>
    </aside>
  );
}

export function SaveBar() {
  const t = useT();
  // re-render whenever the store changes
  useApp(useShallow((s) => [s.profiles, s.synced, s.activeId, s.connection, s.settings]));
  const saving = useApp((s) => s.saving);
  const conn = useApp((s) => s.connection);
  const dry = useApp((s) => s.settings.dryRun);
  const [plan, setPlan] = useState<{ plan: PlannedPacket[]; skipped: string[] } | null>(null);
  const changes = pendingChanges();
  const canWrite = conn.status === 'connected' && !!conn.model?.writesEnabled;
  const full = !(useApp.getState().synced[useApp.getState().activeId]);
  return (
    <>
      <div className="fixed bottom-4 end-4 z-40 flex items-center gap-3 rounded-2xl border border-line bg-panel/95 p-2 ps-4 shadow-2xl backdrop-blur">
        <span className="text-xs text-mute">{changes.count ? (full ? 'Full write' : t('pending', { n: changes.count })) : t('noChanges')}</span>
        <Button variant="primary" disabled={!canWrite || !changes.count || saving} onClick={() => setPlan(currentPlan())}>
          {saving ? t('saving') : t('save')}
          {changes.count > 0 && !saving && <span className="rounded-full bg-white/25 px-1.5 text-[11px]">{changes.count}</span>}
        </Button>
      </div>
      <Modal
        open={!!plan}
        onClose={() => setPlan(null)}
        title={t('planTitle', { n: plan?.plan.length ?? 0 })}
        footer={
          <>
            <Button onClick={() => setPlan(null)}>{t('cancel')}</Button>
            <Button variant="primary" disabled={!plan?.plan.length} onClick={() => { const p = plan!.plan; setPlan(null); void runPlan(p); }}>
              {t('send')}{dry ? ' (dry-run)' : ''}
            </Button>
          </>
        }
      >
        {dry && <p className="mb-3 rounded-lg bg-sky-500/10 p-2.5 text-sm text-sky-300">{t('planDry')}</p>}
        {!!plan?.skipped.length && (
          <p className="mb-3 rounded-lg bg-amber-500/10 p-2.5 text-sm text-amber-300">
            Skipped experimental changes: {plan.skipped.join(', ')}. {t('experimentalHint')}
          </p>
        )}
        <ol className="space-y-1.5 font-mono text-[11px]">
          {plan?.plan.map((p, i) => (
            <li key={i} className="rounded-lg bg-panel2 p-2">
              <div className="mb-0.5 font-sans text-xs text-ink">{i + 1}. {p.label}</div>
              <div className="break-all text-mute">04 | {toHexTrimmed(p.payload)}</div>
            </li>
          ))}
        </ol>
      </Modal>
    </>
  );
}

export function SettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const identity = useApp((s) => s.connection.identity);
  const log = useApp((s) => s.log);
  const clear = useApp((s) => s.clearLog);
  const base = import.meta.env.BASE_URL;
  return (
    <div className={cx('fixed inset-y-0 end-0 z-50 flex w-full max-w-xl flex-col border-s border-line bg-panel shadow-2xl transition-transform', open ? 'translate-x-0' : 'ltr:translate-x-full rtl:-translate-x-full')} aria-hidden={!open}>
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="font-semibold">{t('settings')}</h2>
        <Button onClick={onClose}>{t('close')}</Button>
      </div>
      <div className="scroll-thin flex-1 space-y-4 overflow-auto p-4">
        <Card>
          <Row label={t('dryRun')} tip={t('dryRunHint')}>
            <Toggle label={t('dryRun')} checked={settings.dryRun} onChange={(v) => setSettings({ dryRun: v })} />
          </Row>
          <Row label={t('experimental')} tip={t('experimentalHint')}>
            <Toggle label={t('experimental')} checked={settings.allowExperimental} onChange={(v) => setSettings({ allowExperimental: v })} />
          </Row>
        </Card>
        <Card title={t('sniffer')}>
          <p className="text-sm leading-relaxed text-mute">
            Capture the official driver&apos;s traffic to confirm experimental features.{' '}
            <a className="text-accent underline" href={`${base}sniffer.user.js`} target="_blank" rel="noreferrer">sniffer.user.js</a> ·{' '}
            <a className="text-accent underline" href={`${REPO}/blob/main/docs/CAPTURE.md`} target="_blank" rel="noreferrer">capture steps</a>
          </p>
        </Card>
        {identity && (
          <Card title={t('rawIdentity')}>
            <pre className="scroll-thin overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-mute">{toHex(identity.raw)}</pre>
          </Card>
        )}
        <Card
          title={t('log')}
          right={
            <div className="flex gap-1">
              <Button onClick={() => void navigator.clipboard.writeText(log.map((l) => `${new Date(l.t).toISOString()} ${l.dir.padEnd(7)} ${l.label} | ${l.hex}`).join('\n'))}>{t('copyLog')}</Button>
              <Button onClick={clear}>{t('clearLog')}</Button>
            </div>
          }
        >
          <ol className="max-h-[50vh] space-y-1 overflow-auto font-mono text-[11px] scroll-thin" dir="ltr">
            {log.length === 0 && <li className="text-mute">—</li>}
            {[...log].reverse().map((l) => (
              <li key={l.id} className="rounded bg-panel2 px-2 py-1">
                <span className={cx('me-2 font-bold uppercase', { out: 'text-accent', in: 'text-emerald-400', dry: 'text-sky-400', blocked: 'text-red-400', info: 'text-mute' }[l.dir])}>{l.dir}</span>
                <span className="text-ink">{l.label}</span>
                {l.hex && <div className="break-all text-mute">{l.hex}</div>}
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed bottom-20 end-4 z-[60] flex w-80 flex-col gap-2" aria-live="polite">
      {toasts.map((x) => (
        <button
          key={x.id}
          type="button"
          onClick={() => dismiss(x.id)}
          className={cx(
            'pointer-events-auto rounded-xl border px-3 py-2 text-start text-sm shadow-xl backdrop-blur',
            x.tone === 'ok' && 'border-emerald-500/30 bg-emerald-950/80 text-emerald-100',
            x.tone === 'info' && 'border-sky-500/30 bg-sky-950/80 text-sky-100',
            x.tone === 'warn' && 'border-amber-500/30 bg-amber-950/80 text-amber-100',
            x.tone === 'error' && 'border-red-500/30 bg-red-950/80 text-red-100',
          )}
        >
          {x.text}
        </button>
      ))}
    </div>
  );
}

/** Small hook for online status (PWA offline indicator). */
export function useOnline() {
  return useSyncExternalStore(
    (cb) => (window.addEventListener('online', cb), window.addEventListener('offline', cb), () => (window.removeEventListener('online', cb), window.removeEventListener('offline', cb))),
    () => navigator.onLine,
  );
}
