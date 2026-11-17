import { useState } from 'react';
import { useApp } from '../state/store';
import { useT, type StringKey } from '../i18n';
import { describeTarget, sameTarget, TARGET_GROUPS, TARGETS, type KeyTarget, type TargetGroup } from '../device/keycodes';
import type { LayerName } from '../device/packets';
import { Button, Card, ExperimentalBadge, cx } from './common';
import { KeyboardMap } from './KeyboardMap';
import { useModelAndRange } from './PerformanceTab';

const KNOB_EVENTS = [
  { id: 1, key: 'knobCw' },
  { id: 2, key: 'knobCcw' },
  { id: 3, key: 'knobPress' },
] as const;

export function RemapTab() {
  const t = useT();
  const { model, layout, profile } = useModelAndRange();
  const update = useApp((s) => s.updateActive);
  const [layer, setLayer] = useState<LayerName>('base');
  const [slot, setSlot] = useState<number | null>(null);
  const [knobEvent, setKnobEvent] = useState<number | null>(null);
  const [group, setGroup] = useState<TargetGroup>('letters');

  const defaults = new Map(model.defaults.map((d) => [d.slot, { cmd: d.cmd, code: d.code, type: d.type } as KeyTarget]));
  const overrides = profile.remap[layer];
  const effective = (s: number) => overrides[s] ?? (layer === 'base' ? defaults.get(s) : undefined);

  const assign = (target: KeyTarget) => {
    if (knobEvent !== null) return update((p) => void (p.knob[knobEvent] = target));
    if (slot === null) return;
    update((p) => {
      const def = defaults.get(slot);
      if (layer === 'base' && def && sameTarget(def, target)) delete p.remap.base[slot];
      else p.remap[layer][slot] = target;
    });
  };

  const current = knobEvent !== null ? (profile.knob[knobEvent] ?? null) : slot !== null ? (effective(slot) ?? null) : null;
  const layers: [LayerName, StringKey][] = [['base', 'layerBase'], ['fn1', 'layerFn1'], ['fn2', 'layerFn2']];

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
      <Card
        title={
          <span className="flex items-center gap-2">
            {t('tabRemap')} <ExperimentalBadge />
          </span>
        }
        right={
          <div className="flex rounded-lg border border-line p-0.5">
            {layers.map(([id, key]) => (
              <button key={id} type="button" onClick={() => setLayer(id)} className={cx('rounded-md px-3 py-1 text-xs', layer === id ? 'grad text-white' : 'text-mute hover:text-ink')}>
                {t(key)}
              </button>
            ))}
          </div>
        }
      >
        <KeyboardMap
          layout={layout}
          mode="single"
          selection={slot !== null ? [slot] : []}
          onSelect={(s) => (setSlot(s[0] ?? null), setKnobEvent(null))}
          knob={<span className="text-[10px] font-bold text-mute">{t('knob')}</span>}
          knobActive={knobEvent !== null}
          onKnob={() => (setKnobEvent(1), setSlot(null))}
          capClass={(k) => (overrides[k.slot] ? 'ring-1 ring-hl' : undefined)}
          renderCap={(k, u) => {
            const eff = effective(k.slot);
            const label = eff ? describeTarget(eff) : '';
            const remapped = !!overrides[k.slot];
            return (
              <div className="flex h-full flex-col justify-between leading-none" style={{ padding: u * 0.08 }}>
                <span className="truncate text-mute" style={{ fontSize: Math.max(7, u * 0.15) }}>{k.label}</span>
                <span className={cx('truncate font-semibold', remapped ? 'text-hl' : 'text-ink')} style={{ fontSize: Math.max(8, u * 0.2) }}>
                  {layer === 'base' || remapped ? label : ''}
                </span>
              </div>
            );
          }}
        />
        <div className="mt-3 flex justify-end">
          <Button variant="danger" onClick={() => update((p) => ((p.remap = { base: {}, fn1: {}, fn2: {} }), (p.knob = {})))}>{t('resetAllRemap')}</Button>
        </div>
      </Card>

      <div className="flex flex-col gap-4">
        {knobEvent !== null && (
          <Card title={<span className="flex items-center gap-2">{t('knob')} <ExperimentalBadge /></span>}>
            <div className="mb-2 flex gap-1.5">
              {KNOB_EVENTS.map((e) => (
                <Button key={e.id} variant={knobEvent === e.id ? 'primary' : 'solid'} onClick={() => setKnobEvent(e.id)}>
                  {t(e.key)}
                </Button>
              ))}
            </div>
            <p className="text-[11px] leading-relaxed text-mute">{t('knobHint')}</p>
          </Card>
        )}
        <Card title={slot === null && knobEvent === null ? t('pickKey') : undefined}>
          {(slot !== null || knobEvent !== null) && (
            <div className="mb-3 flex items-center justify-between gap-2 rounded-xl bg-panel2 p-3">
              <div>
                <div className="text-xs text-mute">{t('current')}</div>
                <div className="text-lg font-semibold">{current ? describeTarget(current) : t('unbound')}</div>
                {slot !== null && layer === 'base' && defaults.get(slot) && <div className="text-[11px] text-mute">{t('default')}: {describeTarget(defaults.get(slot)!)}</div>}
              </div>
              <Button
                variant="solid"
                onClick={() =>
                  update((p) => {
                    if (knobEvent !== null) delete p.knob[knobEvent];
                    else if (slot !== null) delete p.remap[layer][slot];
                  })
                }
              >
                {t('resetKey')}
              </Button>
            </div>
          )}
          <div className="mb-2 flex flex-wrap gap-1">
            {TARGET_GROUPS.map((g) => (
              <button key={g} type="button" onClick={() => setGroup(g)} className={cx('rounded-full px-2.5 py-1 text-xs', group === g ? 'bg-accent/15 text-accent' : 'text-mute hover:text-ink')}>
                {t(`g_${g}` as StringKey)}
              </button>
            ))}
          </div>
          <div className="grid max-h-80 grid-cols-4 gap-1.5 overflow-auto scroll-thin">
            {TARGETS.filter((x) => x.group === group).map((x) => (
              <button
                key={x.id}
                type="button"
                disabled={slot === null && knobEvent === null}
                onClick={() => assign(x)}
                className={cx(
                  'truncate rounded-lg border px-1.5 py-2 text-xs transition disabled:opacity-30',
                  current && sameTarget(current, x) ? 'border-accent bg-accent/10' : 'border-line hover:border-accent/50',
                )}
              >
                {x.label}
              </button>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
