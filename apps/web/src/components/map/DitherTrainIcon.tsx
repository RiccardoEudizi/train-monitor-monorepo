/**
 * Dithered train pictogram — a locomotive silhouette filled with a small
 * Bayer-like checkerboard dot pattern (stipple/halftone), matching the map's
 * dither aesthetic. Uses `currentColor`, so it inherits the text colour and
 * adapts to the dark/light theme.
 */
export default function DitherTrainIcon(props: {
  size?: number;
  class?: string;
}) {
  return (
    <svg
      width={props.size ?? 28}
      height={props.size ?? 28}
      viewBox="0 0 32 27"
      fill="none"
      class={props.class}
      aria-hidden="true"
    >
      <defs>
        {/* 2×2 checkerboard = 50% stipple threshold field. */}
        <pattern
          id="dither-train"
          width="2"
          height="2"
          patternUnits="userSpaceOnUse"
        >
          <rect x="0" y="0" width="1" height="1" fill="currentColor" />
          <rect x="1" y="1" width="1" height="1" fill="currentColor" />
        </pattern>
      </defs>
      <g fill="url(#dither-train)">
        {/* cab */}
        <path d="M3 5h7v12H3z" />
        {/* boiler */}
        <path d="M10 8h13a3 3 0 0 1 3 3v6H10z" />
        {/* chimney */}
        <path d="M20 2h3v6h-3z" />
        {/* chassis */}
        <path d="M2 17h27v3H2z" />
        {/* wheels */}
        <circle cx="7" cy="23" r="2.6" />
        <circle cx="16" cy="23" r="2.6" />
        <circle cx="25" cy="23" r="2.6" />
      </g>
    </svg>
  );
}
