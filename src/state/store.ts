import { create } from 'zustand';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import type { Identity } from '../device/packets';
import type { Dialect, ModelInfo } from '../device/models';
import { cloneProfile, defaultProfile, uid, type Profile } from '../device/profile';
import type { LogEntry } from '../device/transport';
import type { Lang } from '../i18n';

export type Tab = 'performance' | 'colour' | 'remap';

export interface Settings {
  dryRun: boolean;
  allowExperimental: boolean;
  theme: 'dark' | 'light';
  lang: Lang;
}

export interface Connection {
  status: 'disconnected' | 'connecting' | 'connected';
  kind?: string;
  productName?: string;
  identity?: Identity;
  model?: ModelInfo;
  dialect?: Dialect;
  error?: string;
}

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'ok' | 'warn' | 'error';
}

interface AppState {
  ready: boolean;
  tab: Tab;
  settings: Settings;
  connection: Connection;
  profiles: Profile[];
  activeId: string;
  /** what we believe the keyboard holds for each profile (after the last successful save) */
  synced: Record<string, Profile | null>;
  selection: number[];
  log: LogEntry[];
  toasts: Toast[];
  saving: boolean;

  setTab(t: Tab): void;
  setSettings(s: Partial<Settings>): void;
  setConnection(c: Partial<Connection> | null): void;
  addLog(e: Omit<LogEntry, 'id' | 't'>): void;
  clearLog(): void;
  toast(text: string, tone?: Toast['tone']): void;
  dismiss(id: number): void;

  active(): Profile;
  updateActive(fn: (p: Profile) => void): void;
  selectProfile(id: string): void;
  addProfile(p?: Profile): void;
  duplicateProfile(id: string): void;
  renameProfile(id: string, name: string): void;
  deleteProfile(id: string): void;
  importProfiles(ps: Profile[]): void;
  markSynced(id: string, p: Profile | null): void;
  setSelection(s: number[]): void;
  setSaving(v: boolean): void;
}

let logId = 0;
let toastId = 0;
const first = defaultProfile('A75Pro');

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  tab: 'performance',
  settings: { dryRun: true, allowExperimental: false, theme: 'dark', lang: 'en' },
  connection: { status: 'disconnected' },
  profiles: [first],
  activeId: first.id,
  synced: {},
  selection: [],
  log: [],
  toasts: [],
  saving: false,

  setTab: (tab) => set({ tab }),
  setSettings: (s) => set({ settings: { ...get().settings, ...s } }),
  setConnection: (c) => set({ connection: c ? { ...get().connection, ...c } : { status: 'disconnected' } }),
  addLog: (e) => set({ log: [...get().log.slice(-799), { ...e, id: ++logId, t: Date.now() }] }),
  clearLog: () => set({ log: [] }),
  toast: (text, tone = 'info') => {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, text, tone }] });
    setTimeout(() => get().dismiss(id), tone === 'error' ? 9000 : 5000);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

  active: () => get().profiles.find((p) => p.id === get().activeId) ?? get().profiles[0]!,
  updateActive: (fn) => {
    const id = get().active().id;
    set({
      profiles: get().profiles.map((p) => {
        if (p.id !== id) return p;
        const next = cloneProfile(p);
        fn(next);
        next.updatedAt = Date.now();
        return next;
      }),
    });
  },
  selectProfile: (activeId) => {
    // switching profiles while connected means the whole profile has to be written
    const connected = get().connection.status === 'connected';
    set({ activeId, selection: [], synced: connected && activeId !== get().activeId ? { ...get().synced, [activeId]: null } : get().synced });
  },
  addProfile: (p) => {
    const model = get().connection.model?.name ?? get().active().model;
    const n = p ?? defaultProfile(model, `Profile ${get().profiles.length + 1}`, get().connection.dialect);
    set({ profiles: [...get().profiles, n], activeId: n.id });
  },
  duplicateProfile: (id) => {
    const src = get().profiles.find((p) => p.id === id);
    if (src) get().addProfile({ ...cloneProfile(src), id: uid(), name: `${src.name} copy` });
  },
  renameProfile: (id, name) => set({ profiles: get().profiles.map((p) => (p.id === id ? { ...p, name } : p)) }),
  deleteProfile: (id) => {
    const rest = get().profiles.filter((p) => p.id !== id);
    const profiles = rest.length ? rest : [defaultProfile(get().active().model)];
    set({ profiles, activeId: get().activeId === id ? profiles[0]!.id : get().activeId });
  },
  importProfiles: (ps) => ps.length && set({ profiles: [...get().profiles, ...ps], activeId: ps[0]!.id }),
  markSynced: (id, p) => set({ synced: { ...get().synced, [id]: p ? cloneProfile(p) : null } }),
  setSelection: (selection) => set({ selection }),
  setSaving: (saving) => set({ saving }),
}));

// ---- persistence (IndexedDB) --------------------------------------------------------------------

const KEY = 'deertune:v1';

export async function hydrate() {
  try {
    const saved = (await idbGet(KEY)) as Partial<Pick<AppState, 'settings' | 'profiles' | 'activeId' | 'synced'>> | undefined;
    if (saved?.profiles?.length) {
      useApp.setState({
        profiles: saved.profiles.map((p) => ({ ...defaultProfile(p.model), ...p })),
        activeId: saved.activeId ?? saved.profiles[0]!.id,
        synced: saved.synced ?? {},
      });
    }
    if (saved?.settings) useApp.setState({ settings: { ...useApp.getState().settings, ...saved.settings } });
  } catch (e) {
    console.warn('DeerTune: could not read IndexedDB', e);
  }
  useApp.setState({ ready: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  useApp.subscribe((s) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      void idbSet(KEY, { settings: s.settings, profiles: s.profiles, activeId: s.activeId, synced: s.synced }).catch(() => undefined);
    }, 300);
  });
}

// ---- live key depth (high-frequency, kept outside React state) ---------------------------------------

export const liveDepth = new Float32Array(126);
const liveSubs = new Set<() => void>();
let liveQueued = false;
export function pushDepth(updates: { slot: number; mm: number }[]) {
  for (const u of updates) liveDepth[u.slot] = u.mm;
  if (liveQueued) return;
  liveQueued = true;
  requestAnimationFrame(() => {
    liveQueued = false;
    liveSubs.forEach((f) => f());
  });
}
export function subscribeDepth(f: () => void) {
  liveSubs.add(f);
  return () => void liveSubs.delete(f);
}
