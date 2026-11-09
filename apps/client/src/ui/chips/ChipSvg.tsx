import { styleFor } from '../../shared/chips';

/** A casino chip drawn in SVG — same colours as the 3D chips. */
export function ChipSvg({ denom, size = 48 }: { denom: number; size?: number }) {
  const st = styleFor(denom);
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
      <circle cx="50" cy="52" r="47" fill="rgba(0,0,0,0.35)" />
      <circle cx="50" cy="50" r="47" fill={st.base} />
      {Array.from({ length: 6 }, (_, i) => (
        <rect x="44" y="3" width="12" height="15" rx="2" fill={st.stripe} transform={`rotate(${i * 60} 50 50)`} />
      ))}
      <circle cx="50" cy="50" r="31" fill={st.inlay} />
      <circle cx="50" cy="50" r="27" fill="none" stroke={st.stripe} stroke-width="2" stroke-dasharray="4 3" />
      <text x="50" y="51" text-anchor="middle" dominant-baseline="middle" font-family="'Cinzel Variable', Georgia, serif" font-weight="800" font-size={st.label.length > 2 ? 21 : 27} fill={st.text}>
        {st.label}
      </text>
      <circle cx="50" cy="50" r="47" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="1.5" />
    </svg>
  );
}
