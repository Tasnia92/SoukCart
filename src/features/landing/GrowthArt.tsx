/* -----------------------------------------------------------------------------
 * GrowthArt — the closing band scene: a loaded hand truck beside a stack of
 * cartons, drawn in the same hand-authored line style as JourneyArt.
 * Decorative only; colours come from theme tokens via landing.css classes.
 * -------------------------------------------------------------------------- */

const CARTONS = [
  { x: 28, y: 152, width: 60, height: 64 },
  { x: 88, y: 128, width: 106, height: 88 },
  { x: 104, y: 78, width: 74, height: 50 },
  { x: 118, y: 46, width: 46, height: 32 },
] as const;

export function GrowthArt() {
  return (
    <svg
      className="ld-art ld-art--growth"
      viewBox="0 0 300 240"
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      <path
        className="ld-art-line ld-art-line--soft"
        transform="translate(52 40) scale(0.5)"
        d="M -40 12 c -10 0 -15 -7 -12 -14 c 2 -6 9 -9 15 -6 c 2 -13 14 -20 25 -16 c 7 3 11 9 12 15 c 9 -5 20 1 21 11 c 1 6 -3 10 -9 10 z"
      />

      <ellipse className="ld-art-shadow" cx={140} cy={222} rx={122} ry={9} />

      {/* Hand truck standing beside the stack */}
      <g className="ld-art-line">
        <path d="M 200 56 L 214 210 M 226 50 L 240 204" />
        <path d="M 200 56 q 12 -16 26 -6" />
        <path d="M 204 100 L 229 94 M 209 150 L 234 144" />
        <path d="M 213 200 L 254 210" />
      </g>

      {/* Cartons */}
      {CARTONS.map((carton) => (
        <g key={`${carton.x}-${carton.y}`}>
          <rect
            className="ld-art-line ld-art-fill--paper"
            x={carton.x}
            y={carton.y}
            width={carton.width}
            height={carton.height}
          />
          <path
            className="ld-art-line ld-art-line--soft"
            d={`M ${carton.x + carton.width / 2} ${carton.y} V ${carton.y + carton.height} M ${carton.x} ${carton.y + carton.height * 0.34} H ${carton.x + carton.width}`}
          />
        </g>
      ))}

      <g className="ld-art-wheel ld-art-wheel--small">
        <circle cx={229} cy={207} r={14} />
      </g>
    </svg>
  );
}
