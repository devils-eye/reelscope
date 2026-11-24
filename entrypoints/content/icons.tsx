// Shared marks for the in-page UI.

/** The brand mark: three ordinary reels on a baseline and one far above it. */
export function Glyph(props: { size?: number }) {
  const s = () => props.size ?? 16;
  return (
    <svg class="rs-glyph" width={s()} height={s()} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M1.2 14h13.6" stroke="currentColor" stroke-width="1.1" stroke-dasharray="1.7 1.5" fill="none" opacity="0.5" />
      <circle cx="3.1" cy="10.9" r="1.6" fill="currentColor" opacity="0.62" />
      <circle cx="6.6" cy="9.4" r="1.6" fill="currentColor" opacity="0.62" />
      <circle cx="10.1" cy="10.5" r="1.6" fill="currentColor" opacity="0.62" />
      <circle class="rs-glyph-hi" cx="13" cy="3.6" r="2.4" />
    </svg>
  );
}

/** The Stats button: three bars on a baseline, the tallest in marigold (the brand mark's outlier). */
export function StatsIcon(props: { size?: number }) {
  const s = () => props.size ?? 16;
  return (
    <svg class="rs-glyph" width={s()} height={s()} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M1.2 14.4h13.6" stroke="currentColor" stroke-width="1.1" fill="none" opacity="0.5" />
      <rect x="2.4" y="9" width="2.6" height="4.4" rx="0.8" fill="currentColor" opacity="0.62" />
      <rect x="6.7" y="6.6" width="2.6" height="6.8" rx="0.8" fill="currentColor" opacity="0.62" />
      <rect class="rs-glyph-hi" x="11" y="2.2" width="2.6" height="11.2" rx="0.8" />
    </svg>
  );
}

export function CheckIcon(props: { size?: number }) {
  return (
    <svg width={props.size ?? 15} height={props.size ?? 15} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );
}

export function ChevronIcon(props: { size?: number }) {
  return (
    <svg width={props.size ?? 12} height={props.size ?? 12} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function Spinner() {
  return <span class="rs-spin" aria-hidden="true" />;
}
