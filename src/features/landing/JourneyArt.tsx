/* -----------------------------------------------------------------------------
 * JourneyArt — the hero scene: supplier warehouse → truck → courier → shop,
 * tied together by a terracotta route.
 *
 * Hand-authored line art. No raster assets: every stroke is SVG geometry and
 * every colour comes from a theme token by way of a class in landing.css.
 * The scene is decorative; the meaning lives in the HTML handoff cards that
 * JourneyScene overlays on top of it.
 * -------------------------------------------------------------------------- */

import { iconPaths } from "../../components/ui/Icon.tsx";

const VIEW_WIDTH = 680;
const VIEW_HEIGHT = 700;

/* Shop awning — a striped valance with a scalloped hem. */
const AWNING = {
  top: 538,
  bottom: 572,
  topLeft: 314,
  topRight: 542,
  bottomLeft: 302,
  bottomRight: 554,
  stripes: 9,
} as const;

const AWNING_SCALLOP_WIDTH = (AWNING.bottomRight - AWNING.bottomLeft) / AWNING.stripes;

function awningStripes(): { id: number; accent: boolean; points: string }[] {
  const topStep = (AWNING.topRight - AWNING.topLeft) / AWNING.stripes;
  const bottomStep = (AWNING.bottomRight - AWNING.bottomLeft) / AWNING.stripes;

  return Array.from({ length: AWNING.stripes }, (_, index) => ({
    id: index,
    accent: index % 2 === 0,
    points: (
      [
        [AWNING.topLeft + index * topStep, AWNING.top],
        [AWNING.topLeft + (index + 1) * topStep, AWNING.top],
        [AWNING.bottomLeft + (index + 1) * bottomStep, AWNING.bottom],
        [AWNING.bottomLeft + index * bottomStep, AWNING.bottom],
      ] as const
    )
      .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
      .join(" "),
  }));
}

const AWNING_CLIP_PATH = [
  `M ${AWNING.topLeft} ${AWNING.top}`,
  `H ${AWNING.topRight}`,
  `L ${AWNING.bottomRight} ${AWNING.bottom}`,
  ...Array.from(
    { length: AWNING.stripes },
    () => `q ${-AWNING_SCALLOP_WIDTH / 2} 12 ${-AWNING_SCALLOP_WIDTH} 0`,
  ),
  "Z",
].join(" ");

/* Storefront shelves — three tiers of stock behind the window. */
const SHELF_ROWS = [600, 620, 640] as const;
const SHELF_STOCK = [
  { row: 0, x: 328, width: 20, accent: true },
  { row: 0, x: 356, width: 14, accent: false },
  { row: 0, x: 378, width: 24, accent: false },
  { row: 0, x: 410, width: 16, accent: true },
  { row: 1, x: 330, width: 16, accent: false },
  { row: 1, x: 354, width: 24, accent: true },
  { row: 1, x: 386, width: 14, accent: false },
  { row: 1, x: 408, width: 20, accent: false },
  { row: 2, x: 326, width: 24, accent: false },
  { row: 2, x: 358, width: 18, accent: false },
  { row: 2, x: 384, width: 22, accent: true },
  { row: 2, x: 414, width: 14, accent: false },
] as const;

/* Warehouse cladding — vertical seams on the long right-hand wall. */
const WAREHOUSE_SEAMS = [516, 534, 552] as const;

function Cloud({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <path
      className="ld-art-line ld-art-line--soft"
      transform={`translate(${x} ${y}) scale(${scale})`}
      d="M -40 12 c -10 0 -15 -7 -12 -14 c 2 -6 9 -9 15 -6 c 2 -13 14 -20 25 -16 c 7 3 11 9 12 15 c 9 -5 20 1 21 11 c 1 6 -3 10 -9 10 z"
    />
  );
}

/* Symmetric lobed canopy over a straight trunk. */
function Tree({ x, y, radius: r }: { x: number; y: number; radius: number }) {
  return (
    <g className="ld-art-line ld-art-line--soft">
      <path d={`M ${x} ${y + r} V ${y + r * 2.1}`} />
      <path
        d={`M ${x} ${y + r}
            q ${-r * 1.05} 0 ${-r * 1.05} ${-r * 0.62}
            q ${-r * 0.18} ${-r * 0.72} ${r * 0.52} ${-r * 0.9}
            q ${r * 0.12} ${-r * 0.72} ${r * 0.53} ${-r * 0.6}
            q ${r * 0.41} ${-r * 0.3} ${r * 0.53} ${r * 0.6}
            q ${r * 0.7} ${r * 0.18} ${r * 0.52} ${r * 0.9}
            q 0 ${r * 0.62} ${-r * 1.05} ${r * 0.62} z`}
      />
    </g>
  );
}

function Crate({ x, y, width, height }: { x: number; y: number; width: number; height: number }) {
  return (
    <g>
      <rect className="ld-art-line ld-art-fill--soft" x={x} y={y} width={width} height={height} />
      <path
        className="ld-art-line ld-art-line--soft"
        d={`M ${x + width / 2} ${y} V ${y + height} M ${x} ${y + height * 0.42} H ${x + width}`}
      />
    </g>
  );
}

export function JourneyArt() {
  return (
    <svg
      className="ld-art ld-art--journey"
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <marker
          id="ld-route-arrow"
          viewBox="0 0 12 12"
          refX="10"
          refY="6"
          markerWidth="4.4"
          markerHeight="4.4"
          orient="auto-start-reverse"
        >
          <path className="ld-art-fill--accent" d="M 1 1 L 11 6 L 1 11 Z" />
        </marker>
        <clipPath id="ld-awning-clip">
          <path d={AWNING_CLIP_PATH} />
        </clipPath>
      </defs>

      {/* Sky */}
      <Cloud x={96} y={62} scale={0.9} />
      <Cloud x={604} y={74} scale={0.72} />
      <Cloud x={492} y={40} scale={0.5} />

      {/* Ground contact shadows */}
      <g className="ld-art-shadow">
        <ellipse cx={380} cy={306} rx={158} ry={12} />
        <ellipse cx={536} cy={324} rx={84} ry={10} />
        <ellipse cx={330} cy={394} rx={50} ry={8} />
        <ellipse cx={428} cy={668} rx={148} ry={12} />
      </g>

      {/* Supplier warehouse */}
      <g>
        <polygon
          className="ld-art-line ld-art-fill--paper"
          points="240,150 316,112 576,112 500,150"
        />
        <polygon
          className="ld-art-line ld-art-fill--soft"
          points="500,150 576,112 576,262 500,300"
        />
        <rect className="ld-art-line ld-art-fill--paper" x={240} y={150} width={260} height={150} />
        <path
          className="ld-art-line ld-art-line--soft"
          d={WAREHOUSE_SEAMS.map(
            (seam) => `M ${seam} ${112 + (seam - 500) * 0.5} V ${262 + (seam - 500) * 0.5}`,
          ).join(" ")}
        />

        {/* Fascia band across the front */}
        <rect className="ld-art-line ld-art-fill--soft" x={240} y={150} width={260} height={14} />

        {/* Roll-up bay */}
        <rect className="ld-art-line ld-art-fill--soft" x={262} y={196} width={104} height={104} />
        <path
          className="ld-art-line ld-art-line--soft"
          d={[0, 1, 2, 3, 4, 5].map((slat) => `M 262 ${212 + slat * 15} H 366`).join(" ")}
        />

        {/* Loading dock */}
        <rect className="ld-art-line ld-art-fill--softer" x={392} y={210} width={86} height={90} />
        <path className="ld-art-line ld-art-line--soft" d="M 392 288 H 478" />

        <text className="ld-art-sign ld-art-sign--wall" x={430} y={186} textAnchor="middle">
          SUPPLIER
        </text>
      </g>

      {/* Pallets waiting in the bay and on the dock */}
      <g>
        <Crate x={402} y={244} width={54} height={44} />
        <Crate x={412} y={214} width={36} height={30} />
        <rect className="ld-art-line ld-art-fill--soft" x={398} y={288} width={62} height={10} />
        <Crate x={280} y={240} width={50} height={44} />
        <rect className="ld-art-line ld-art-fill--soft" x={276} y={284} width={58} height={10} />
      </g>

      {/* Delivery truck, parked on the apron beside the dock */}
      <g>
        <rect className="ld-art-line ld-art-fill--accent" x={514} y={238} width={90} height={68} />
        <path
          className="ld-art-line ld-art-fill--paper"
          d="M 514 256 h -34 a 12 12 0 0 0 -11 8 l -6 22 a 8 8 0 0 0 -1 4 v 12 h 52 z"
        />
        <polygon
          className="ld-art-line ld-art-fill--soft"
          points="482,264 508,264 508,284 476,284"
        />
        <rect className="ld-art-line" x={458} y={292} width={14} height={10} />
        <svg
          className="ld-art-glyph ld-art-glyph--light"
          x={540}
          y={252}
          width={38}
          height={38}
          viewBox="0 0 24 24"
          dangerouslySetInnerHTML={{ __html: iconPaths.cart }}
        />
        <g className="ld-art-wheel">
          <circle cx={498} cy={308} r={13} />
          <circle cx={576} cy={308} r={13} />
        </g>
      </g>

      {/* Courier crossing the yard with a hand truck */}
      <g>
        <g className="ld-art-line">
          <ellipse className="ld-art-fill--paper" cx={316} cy={316} rx={17} ry={5} />
          <path className="ld-art-fill--soft" d="M 306 315 a 10 8 0 0 1 20 0" />
          <circle className="ld-art-fill--paper" cx={316} cy={326} r={9} />
          <path d="M 316 335 V 362" />
          <path d="M 316 342 L 340 352" />
          <path d="M 316 362 L 303 388 M 316 362 L 330 388" />
          <path d="M 298 390 h 12 M 326 390 h 12" />
        </g>
        <path className="ld-art-line" d="M 344 330 L 351 386" />
        <Crate x={340} y={350} width={36} height={28} />
        <Crate x={342} y={324} width={32} height={26} />
        <path className="ld-art-line" d="M 348 378 L 372 384" />
        <g className="ld-art-wheel ld-art-wheel--small">
          <circle cx={354} cy={386} r={9} />
        </g>
      </g>

      {/* Trees */}
      <Tree x={620} y={402} radius={26} />
      <Tree x={654} y={372} radius={17} />

      {/* Terracotta route: stock → pick → transit → doorstep */}
      <g className="ld-art-route">
        <path d="M 146 238 C 204 216 260 214 302 228" markerEnd="url(#ld-route-arrow)" />
        <path
          d="M 268 300 C 190 322 148 374 196 406 C 238 434 338 426 380 454"
          markerEnd="url(#ld-route-arrow)"
        />
        <path d="M 386 458 C 424 492 388 528 330 524 C 264 520 230 560 258 590" />
      </g>

      {/* Your shop */}
      <g>
        <rect className="ld-art-line ld-art-fill--soft" x={292} y={486} width={272} height={16} />
        <rect className="ld-art-line ld-art-fill--paper" x={300} y={502} width={256} height={150} />
        <rect className="ld-art-line ld-art-fill--paper" x={324} y={504} width={208} height={32} />
        <text className="ld-art-sign" x={428} y={526} textAnchor="middle">
          YOUR SHOP
        </text>

        <g clipPath="url(#ld-awning-clip)">
          {awningStripes().map((stripe) => (
            <polygon
              key={stripe.id}
              className={stripe.accent ? "ld-art-fill--accent" : "ld-art-fill--paper"}
              points={stripe.points}
            />
          ))}
        </g>
        <path className="ld-art-line" d={AWNING_CLIP_PATH} />

        {/* Window of stock */}
        <rect className="ld-art-line ld-art-fill--soft" x={320} y={584} width={118} height={64} />
        <path
          className="ld-art-line ld-art-line--soft"
          d={SHELF_ROWS.map((row) => `M 320 ${row} H 438`).join(" ")}
        />
        {SHELF_STOCK.map((item) => (
          <rect
            key={`${item.row}-${item.x}`}
            className={item.accent ? "ld-art-fill--accent" : "ld-art-fill--mid"}
            x={item.x}
            y={SHELF_ROWS[item.row] - 11}
            width={item.width}
            height={11}
          />
        ))}

        {/* Door */}
        <rect className="ld-art-line ld-art-fill--paper" x={454} y={584} width={78} height={68} />
        <path className="ld-art-line ld-art-line--soft" d="M 493 584 V 652" />
        <circle className="ld-art-fill--ink" cx={486} cy={618} r={3} />

        <rect className="ld-art-line ld-art-fill--soft" x={292} y={652} width={272} height={12} />
      </g>

      {/* Route arrival marker on the doorstep */}
      <g className="ld-art-route">
        <path d="M 252 596 C 264 616 276 626 292 632" markerEnd="url(#ld-route-arrow)" />
      </g>

      {/* Order badge */}
      <g>
        <circle className="ld-art-line ld-art-fill--paper ld-art-badge" cx={598} cy={588} r={32} />
        <svg
          className="ld-art-glyph ld-art-glyph--accent"
          x={578}
          y={568}
          width={40}
          height={40}
          viewBox="0 0 24 24"
          dangerouslySetInnerHTML={{ __html: iconPaths.cart }}
        />
      </g>

      {/* Location pin over the supplier */}
      <g>
        <path
          className="ld-art-fill--accent"
          d="M 272 28 a 22 22 0 0 1 22 22 c 0 16 -22 36 -22 36 s -22 -20 -22 -36 a 22 22 0 0 1 22 -22 z"
        />
        <circle className="ld-art-fill--paper" cx={272} cy={50} r={8} />
      </g>
    </svg>
  );
}
