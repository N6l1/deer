import { useEffect, useState } from 'react';
import { useApp, hydrate } from './state/store';
import { reconnectKnown } from './state/session';
import { LANGS, useT } from './i18n';
import { isWebHidSupported } from './device/webhid';
import { PerformanceTab } from './ui/PerformanceTab';
import { ColourTab } from './ui/ColourTab';
import { RemapTab } from './ui/RemapTab';
import { MouseTab } from './ui/MouseTab';
import { SaveBar, SettingsDrawer, Sidebar, Toasts, TopBar } from './ui/Shell';

export default function App() {
  const t = useT();
  const ready = useApp((s) => s.ready);
  const tab = useApp((s) => s.tab);
  const { theme, lang } = useApp((s) => s.settings);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    void hydrate().then(() => (isWebHidSupported() ? reconnectKnown() : undefined));
  }, []);

  useEffect(() => {
    const html = document.documentElement;
    html.classList.toggle('dark', theme === 'dark');
    html.classList.toggle('light', theme === 'light');
    html.lang = lang;
    html.dir = LANGS[lang].dir;
  }, [theme, lang]);

  if (!ready) return null;
  return (
    <div className="flex min-h-full flex-col">
      <TopBar onSettings={() => setSettingsOpen(true)} />
      <main className="flex flex-1 flex-col gap-4 p-4 pb-24 lg:flex-row">
        {tab !== 'mouse' && <Sidebar />}
        <div className="min-w-0 flex-1">
          {tab === 'performance' && <PerformanceTab />}
          {tab === 'colour' && <ColourTab />}
          {tab === 'remap' && <RemapTab />}
          {tab === 'mouse' && <MouseTab />}
        </div>
      </main>
      <footer className="px-4 pb-20 text-center text-[11px] text-mute">{t('disclaimer')}</footer>
      {tab !== 'mouse' && <SaveBar />}
      <Toasts />
      {settingsOpen && <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setSettingsOpen(false)} />}
      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
