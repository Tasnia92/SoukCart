/* -----------------------------------------------------------------------------
 * GrowthArt — the closing band scene: a loaded hand truck and a stack of
 * cartons, drawn in the same hand-authored line style as JourneyArt.
 * Decorative only; colours come from theme tokens via landing.css classes.
 * -------------------------------------------------------------------------- */

const CARTONS = [
  { x: 78, y: 138, width: 104, height: 78 },
  { x: 26, y: 164, width: 56, height: 52 },
  { x: 96, y: 84, width: 68, height: 54 },
  { x: 112, y: 52, width: 44, height: 32 },
  { x: 180, y: 158, width: 50, height: 58 },
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
        transform="translate(56 42) scale(0.55)"
        d="M -40 12 c -10 0 -15 -7 -12 -14 c 2 -6 9 -9 15 -6 c 2 -13 14 -20 25 -16 c 7 3 11 9 12 15 c 9 -5 20 1 21 11 c 1 6 -3 10 -9 10 z"
      />

      <ellipse className="ld-art-shadow" cx={140} cy={222} rx={120} ry={10} />

      {/* Hand truck behind the stack */}
      <g className="ld-art-line">
        <path d="M 198 58 L 212 210 M 218 56 L 232 208" />
        <path d="M 202 96 L 221 94 M 206 140 L 225 138" />
        <path d="M 208 200 L 250 210" />
      </g>

      {/* Cartons */}
      {CARTONS.map((carton) => (
        <g key={`${carton.x}-${carton.y}`}>
          <rect
            className="ld-art-line ld-art-fill--soft"
            x={carton.x}
            y={carton.y}
            width={carton.width}
            height={carton.height}
          />
          <path
            className="ld-art-line ld-art-line--soft"
            d={`M ${carton.x + carton.width / 2} ${carton.y} V ${carton.y + carton.height}
                M ${carton.x} ${carton.y + carton.height * 0.34} H ${carton.x + carton.width}`}
          />
        </g>
      ))}

      <g className="ld-art-wheel ld-art-wheel--small">
        <circle cx={222} cy={210} r={13} />
      </g>
    </svg>
  );
}
