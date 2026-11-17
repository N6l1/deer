import { useState, type CSSProperties } from 'react';
import { useApp } from '../state/store';
import { useT } from '../i18n';
import { lightingEffects, PRESET_COLOURS } from '../device/models';
import type { KeyCap } from '../device/layouts';
import { Badge, Button, Card, Row, Slider, Toggle, cx } from './common';
import { KeyboardMap } from './KeyboardMap';
import { useModelAndRange } from './PerformanceTab';

const HEX = /^#?[0-9a-f]{6}$/i;

export function ColourTab() {
  const t = useT();
  const { model, layout, profile } = useModelAndRange();
  const update = useApp((s) => s.updateActive);
  const [brush, setBrush] = useState('#ff6a1a');
  const [hexDraft, setHexDraft] = useState('#ff6a1a');
  const [dropper, setDropper] = useState(false);
  const effects = lightingEffects(model);
  const led = profile.led;
  const effect = effects.find((e) => e.code === led.mode) ?? effects[0]!;
  const custom = led.custom;
  const level = led.brightness / 9;

  const preview = (k: KeyCap): CSSProperties | undefined => {
    let colour: string | null;
    if (custom) colour = profile.customColours[k.slot] ?? '#000000';
    else if (effect.code === 0) colour = null;
    else if (led.colour > 0 && effect.preset) colour = PRESET_COLOURS[led.colour]?.hex ?? '#ffffff';
    else colour = `hsl(${(k.x / layout.width) * 300 + k.y * 12}, 95%, 55%)`;
    if (!colour) return undefined;
    const anim = !custom && effect.name === 'Breath' ? `breathe ${2.6 - led.speed * 0.22}s ease-in-out infinite` : !custom && led.colour === 0 && effect.code !== 2 ? `hue ${9 - led.speed * 0.8}s linear infinite` : undefined;
    return {
      background: `linear-gradient(180deg, color-mix(in srgb, ${colour} ${18 + 40 * level}%, var(--cap-top)), color-mix(in srgb, ${colour} ${10 + 30 * level}%, var(--cap)))`,
      boxShadow: `0 0 ${6 + 14 * level}px -4px ${colour}`,
      animation: anim,
    };
  };

  const paint = (slot: number) => {
    if (!custom) return;
    if (dropper) {
      const c = profile.customColours[slot];
      if (c) (setBrush(c), setHexDraft(c));
      setDropper(false);
      return;
    }
    if (profile.customColours[slot] === brush) return;
    update((p) => void (p.customColours[slot] = brush));
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
      <Card>
        <KeyboardMap
          layout={layout}
          selection={[]}
          mode={custom ? 'paint' : 'single'}
          onPaint={paint}
          capStyle={preview}
          renderCap={(k, u) => (
            <span className="block font-medium text-white/90" style={{ fontSize: Math.max(9, u * 0.21), padding: u * 0.08 }}>
              {k.label}
            </span>
          )}
        />
        {custom && <p className="mt-3 text-center text-xs text-mute">{t('paintHint')}</p>}
      </Card>

      <div className="flex flex-col gap-4">
        <Card title={t('effect')}>
          <div className="grid grid-cols-2 gap-1.5">
            {effects.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => update((p) => ((p.led.mode = e.code), (p.led.custom = false)))}
                className={cx(
                  'rounded-lg border px-2.5 py-1.5 text-start text-xs transition',
                  !custom && led.mode === e.code ? 'border-accent bg-accent/10 text-ink' : 'border-line text-mute hover:border-accent/50 hover:text-ink',
                )}
              >
                {e.name}
              </button>
            ))}
          </div>
        </Card>

        <Card>
          <div className="text-xs text-mute">{t('brightness')}</div>
          <Slider label={t('brightness')} value={led.brightness} min={0} max={9} step={1} onChange={(v) => update((p) => void (p.led.brightness = v))} />
          <div className="mt-3 text-xs text-mute">{t('speed')}</div>
          <Slider label={t('speed')} value={led.speed} min={0} max={9} step={1} disabled={custom} onChange={(v) => update((p) => void (p.led.speed = v))} />
          <Row label={t('direction')} tip={t('directionHint')} badge={<Badge>{t('needsCapture')}</Badge>}>
            <select disabled className="rounded-lg border border-line bg-panel2 px-2 py-1 text-sm opacity-40" aria-label={t('direction')}>
              <option>—</option>
            </select>
          </Row>
          <div className="mt-2 text-xs text-mute">{t('baseColour')}</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {PRESET_COLOURS.map((c) => (
              <button
                key={c.index}
                type="button"
                title={c.name}
                aria-label={c.name}
                disabled={custom || !effect.preset}
                onClick={() => update((p) => void (p.led.colour = c.index))}
                className={cx('h-7 w-7 rounded-full border-2 transition disabled:opacity-30', led.colour === c.index ? 'border-white scale-110' : 'border-transparent')}
                style={{ background: c.hex || 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }}
              />
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-mute">{t('presetOnly')}</p>
        </Card>

        <Card>
          <Row label={t('customRgb')}>
            <Toggle label={t('customRgb')} checked={custom} onChange={(v) => update((p) => void (p.led.custom = v))} />
          </Row>
          {custom && (
            <div className="mt-2 space-y-3 border-t border-line pt-3">
              <div className="flex items-center gap-2">
                <label className="text-xs text-mute" htmlFor="brush">{t('brush')}</label>
                <input id="brush" type="color" value={brush} onChange={(e) => (setBrush(e.target.value), setHexDraft(e.target.value))} className="h-9 w-12 cursor-pointer rounded border border-line bg-transparent" />
                <input
                  aria-label="hex"
                  value={hexDraft}
                  onChange={(e) => {
                    setHexDraft(e.target.value);
                    if (HEX.test(e.target.value)) setBrush(('#' + e.target.value.replace('#', '')).toLowerCase());
                  }}
                  className={cx('num w-24 rounded-lg border bg-panel2 px-2 py-1.5 font-mono text-sm', HEX.test(hexDraft) ? 'border-line' : 'border-red-500')}
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button variant="solid" onClick={() => update((p) => layout.keys.forEach((k) => (p.customColours[k.slot] = brush)))}>{t('fillAll')}</Button>
                <Button variant={dropper ? 'primary' : 'solid'} onClick={() => setDropper(!dropper)}>{t('eyedropper')}</Button>
                <Button variant="ghost" onClick={() => update((p) => void (p.customColours = {}))}>{t('clear')}</Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
