import { useEffect, useId, useState, type ReactNode } from 'react';
import { useT } from '../i18n';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

export function Button({
  children, onClick, variant = 'ghost', disabled, title, className, type = 'button',
}: { children: ReactNode; onClick?: () => void; variant?: 'primary' | 'ghost' | 'danger' | 'solid'; disabled?: boolean; title?: string; className?: string; type?: 'button' | 'submit' }) {
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition select-none',
        'disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent',
        variant === 'primary' && 'grad text-white shadow-[0_6px_20px_-8px_#ff4a2a] hover:brightness-110',
        variant === 'solid' && 'bg-panel2 border border-line hover:border-accent/60',
        variant === 'ghost' && 'text-mute hover:text-ink hover:bg-panel2',
        variant === 'danger' && 'text-red-400 hover:bg-red-500/10 border border-red-500/30',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx('relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-40', checked ? 'grad' : 'bg-line')}
    >
      <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', checked ? 'start-[22px]' : 'start-0.5')} />
    </button>
  );
}

export function Tip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={text}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="grid h-4 w-4 place-items-center rounded-full border border-line text-[10px] text-mute hover:text-ink"
      >
        ?
      </button>
      {open && (
        <span className="absolute top-6 start-1/2 z-50 w-64 -translate-x-1/2 rounded-lg border border-line bg-panel2 p-2.5 text-xs leading-relaxed text-ink shadow-xl rtl:translate-x-1/2">
          {text}
        </span>
      )}
    </span>
  );
}

export function Badge({ children, tone = 'warn' }: { children: ReactNode; tone?: 'warn' | 'info' | 'ok' }) {
  return (
    <span
      className={cx(
        'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
        tone === 'warn' && 'bg-amber-500/15 text-amber-400',
        tone === 'info' && 'bg-sky-500/15 text-sky-400',
        tone === 'ok' && 'bg-emerald-500/15 text-emerald-400',
      )}
    >
      {children}
    </span>
  );
}

export function ExperimentalBadge() {
  const t = useT();
  return <Badge>{t('experimentalBadge')}</Badge>;
}

export function Row({ label, tip, children, badge }: { label: string; tip?: string; children: ReactNode; badge?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <span className="truncate">{label}</span>
        {tip && <Tip text={tip} />}
        {badge}
      </div>
      {children}
    </div>
  );
}

export function Card({ title, children, right, className }: { title?: ReactNode; children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-2xl border border-line bg-panel p-4', className)}>
      {(title || right) && (
        <header className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-mute">{title}</h3>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function Slider({
  value, min, max, step, onChange, disabled, label, suffix,
}: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; disabled?: boolean; label: string; suffix?: string }) {
  const id = useId();
  return (
    <div className="flex items-center gap-3">
      <label htmlFor={id} className="sr-only">{label}</label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 flex-1 cursor-pointer accent-[#ff5a1f] disabled:opacity-40"
      />
      <span className="num w-14 text-end text-sm text-ink">
        {value}
        {suffix}
      </span>
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-line bg-panel shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="border-b border-line px-5 py-3 text-base font-semibold">{title}</h2>
        <div className="scroll-thin overflow-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function confirmAsk(text: string) {
  return window.confirm(text);
}
