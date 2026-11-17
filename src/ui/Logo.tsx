// DeerTune's own mark: a keycap with a tuning slider. Original artwork, not DrunkDeer branding.
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="dt-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff9a2a" />
          <stop offset="1" stopColor="#ff2d55" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="56" height="56" rx="14" fill="url(#dt-g)" />
      <rect x="12" y="10" width="40" height="38" rx="9" fill="#0b0b0e" opacity=".9" />
      <path d="M20 22h24M20 30h24M20 38h24" stroke="#ffffff" strokeOpacity=".22" strokeWidth="3" strokeLinecap="round" />
      <circle cx="38" cy="22" r="4.5" fill="#fff" />
      <circle cx="26" cy="30" r="4.5" fill="#ff9a2a" />
      <circle cx="34" cy="38" r="4.5" fill="#fff" />
    </svg>
  );
}
