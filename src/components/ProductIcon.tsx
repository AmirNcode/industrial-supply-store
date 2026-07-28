import type { ReactNode } from "react";

/**
 * In-house technical line art, one shape per catalog concept.
 *
 * The reference site uses photography; copying those images is not an option,
 * and stock photos would look worse than a consistent drawn set. These are
 * deliberately schematic — a buyer scanning a grid needs to tell a nut from a
 * bearing at 40px, not admire a render.
 */

const S = { fill: "none", stroke: "#5a5a5a", strokeWidth: 1.6 } as const;
const F = { fill: "#dcdcdc", stroke: "#5a5a5a", strokeWidth: 1.6 } as const;
const FD = { fill: "#c2c2c2", stroke: "#5a5a5a", strokeWidth: 1.6 } as const;

const icons: Record<string, ReactNode> = {
  oring: (
    <>
      <ellipse cx="24" cy="24" rx="17" ry="11" {...F} />
      <ellipse cx="24" cy="24" rx="10" ry="5" fill="#fff" stroke="#5a5a5a" strokeWidth={1.6} />
    </>
  ),
  "oring-square": (
    <>
      <rect x="7" y="14" width="34" height="20" rx="2" {...F} />
      <rect x="15" y="20" width="18" height="8" rx="1" fill="#fff" stroke="#5a5a5a" strokeWidth={1.6} />
    </>
  ),
  "oring-x": (
    <>
      <ellipse cx="24" cy="24" rx="17" ry="11" {...F} />
      <ellipse cx="24" cy="24" rx="10" ry="5" fill="#fff" stroke="#5a5a5a" strokeWidth={1.6} />
      <path d="M11 20l5 3-5 3M37 20l-5 3 5 3" {...S} />
    </>
  ),
  "oring-metal": (
    <>
      <ellipse cx="24" cy="24" rx="17" ry="11" fill="#eee" stroke="#5a5a5a" strokeWidth={1.6} />
      <ellipse cx="24" cy="24" rx="10" ry="5" fill="#fff" stroke="#5a5a5a" strokeWidth={1.6} />
      <path d="M13 18l4 2M31 28l4 2" {...S} />
    </>
  ),
  gasket: (
    <>
      <circle cx="24" cy="24" r="17" {...F} />
      <circle cx="24" cy="24" r="9" fill="#fff" stroke="#5a5a5a" strokeWidth={1.6} />
      <circle cx="24" cy="10" r="2" fill="#fff" stroke="#5a5a5a" strokeWidth={1.2} />
      <circle cx="24" cy="38" r="2" fill="#fff" stroke="#5a5a5a" strokeWidth={1.2} />
      <circle cx="10" cy="24" r="2" fill="#fff" stroke="#5a5a5a" strokeWidth={1.2} />
      <circle cx="38" cy="24" r="2" fill="#fff" stroke="#5a5a5a" strokeWidth={1.2} />
    </>
  ),
  seal: (
    <>
      <ellipse cx="24" cy="24" rx="16" ry="12" {...F} />
      <ellipse cx="24" cy="24" rx="9" ry="6" fill="#fff" stroke="#5a5a5a" strokeWidth={1.6} />
      <path d="M8 24h4M36 24h4" {...S} />
    </>
  ),
  screw: (
    <>
      <rect x="17" y="6" width="14" height="9" rx="1.5" {...FD} />
      <rect x="20" y="15" width="8" height="27" {...F} />
      <path d="M20 20h8M20 25h8M20 30h8M20 35h8" {...S} />
      <path d="M20 9h8" stroke="#5a5a5a" strokeWidth={1.4} />
    </>
  ),
  "screw-flat": (
    <>
      <path d="M13 7h22l-7 9h-8z" {...FD} />
      <rect x="20" y="16" width="8" height="26" {...F} />
      <path d="M20 21h8M20 26h8M20 31h8M20 36h8" {...S} />
    </>
  ),
  "screw-button": (
    <>
      <path d="M14 15a10 8 0 0 1 20 0z" {...FD} />
      <rect x="20" y="15" width="8" height="27" {...F} />
      <path d="M20 20h8M20 25h8M20 30h8M20 35h8" {...S} />
    </>
  ),
  setscrew: (
    <>
      <rect x="19" y="8" width="10" height="32" rx="1" {...F} />
      <path d="M19 13h10M19 18h10M19 23h10M19 28h10M19 33h10" {...S} />
      <path d="M21 8h6l-3 4z" fill="#8a8a8a" stroke="none" />
    </>
  ),
  bolt: (
    <>
      <path d="M17 6l7-4 7 4v8l-7 4-7-4z" {...FD} />
      <rect x="20" y="18" width="8" height="24" {...F} />
      <path d="M20 23h8M20 28h8M20 33h8M20 38h8" {...S} />
    </>
  ),
  nut: (
    <>
      <path d="M24 6l15 9v18l-15 9-15-9V15z" {...F} />
      <circle cx="24" cy="24" r="8" fill="#fff" stroke="#5a5a5a" strokeWidth={1.6} />
      <circle cx="24" cy="24" r="8" fill="none" stroke="#9a9a9a" strokeWidth={0.8} strokeDasharray="2 2" />
    </>
  ),
  washer: (
    <>
      <circle cx="24" cy="24" r="17" {...F} />
      <circle cx="24" cy="24" r="8" fill="#fff" stroke="#5a5a5a" strokeWidth={1.6} />
    </>
  ),
  rivet: (
    <>
      <ellipse cx="24" cy="12" rx="11" ry="4" {...FD} />
      <rect x="20" y="12" width="8" height="20" {...F} />
      <path d="M24 32v10" {...S} />
    </>
  ),
  anchor: (
    <>
      <rect x="20" y="6" width="8" height="20" {...F} />
      <path d="M20 26l-4 14h16l-4-14z" {...FD} />
      <path d="M20 11h8M20 16h8M20 21h8" {...S} />
    </>
  ),
  pipe: (
    <>
      <rect x="6" y="17" width="36" height="14" {...F} />
      <ellipse cx="6" cy="24" rx="3" ry="7" fill="#fff" stroke="#5a5a5a" strokeWidth={1.6} />
      <ellipse cx="42" cy="24" rx="3" ry="7" {...FD} />
    </>
  ),
  "pipe-fitting": (
    <>
      <path d="M8 20h20v-8h10v28H28v-8H8z" {...F} />
      <path d="M28 12h10M28 40h10" {...S} />
    </>
  ),
  elbow: (
    <>
      <path d="M10 18h16v20h10" fill="none" stroke="#5a5a5a" strokeWidth={10} strokeLinejoin="miter" />
      <path d="M10 18h16v20h10" fill="none" stroke="#dcdcdc" strokeWidth={7} strokeLinejoin="miter" />
    </>
  ),
  tee: (
    <>
      <path d="M8 24h32M24 24v16" fill="none" stroke="#5a5a5a" strokeWidth={11} />
      <path d="M8 24h32M24 24v16" fill="none" stroke="#dcdcdc" strokeWidth={8} />
    </>
  ),
  coupling: (
    <>
      <rect x="12" y="16" width="24" height="16" rx="1" {...F} />
      <path d="M16 16v16M20 16v16M28 16v16M32 16v16" {...S} />
    </>
  ),
  tube: (
    <>
      <path d="M8 30c0-12 32-12 32 0" fill="none" stroke="#5a5a5a" strokeWidth={9} />
      <path d="M8 30c0-12 32-12 32 0" fill="none" stroke="#e8e8e8" strokeWidth={6} />
    </>
  ),
  hose: (
    <>
      <path d="M8 34c6-16 12 8 18-6s10 6 14-4" fill="none" stroke="#5a5a5a" strokeWidth={8} strokeLinecap="round" />
      <path d="M8 34c6-16 12 8 18-6s10 6 14-4" fill="none" stroke="#d0d0d0" strokeWidth={5} strokeLinecap="round" />
    </>
  ),
  clamp: (
    <>
      <circle cx="24" cy="24" r="15" fill="none" stroke="#5a5a5a" strokeWidth={5} />
      <circle cx="24" cy="24" r="15" fill="none" stroke="#dcdcdc" strokeWidth={2.5} />
      <rect x="17" y="4" width="14" height="9" rx="1" {...FD} />
    </>
  ),
  valve: (
    <>
      <rect x="6" y="20" width="36" height="10" {...F} />
      <circle cx="24" cy="25" r="9" {...FD} />
      <rect x="21" y="4" width="6" height="12" {...F} />
      <rect x="14" y="2" width="20" height="4" rx="1" {...FD} />
    </>
  ),
  pump: (
    <>
      <circle cx="20" cy="26" r="13" {...F} />
      <circle cx="20" cy="26" r="5" {...FD} />
      <rect x="30" y="14" width="12" height="10" {...F} />
      <path d="M20 13V6h10" {...S} />
    </>
  ),
  bearing: (
    <>
      <circle cx="24" cy="24" r="18" {...F} />
      <circle cx="24" cy="24" r="12" fill="#fff" stroke="#5a5a5a" strokeWidth={1.6} />
      <circle cx="24" cy="24" r="6" {...FD} />
      {[0, 60, 120, 180, 240, 300].map((a) => (
        <circle
          key={a}
          cx={24 + 15 * Math.cos((a * Math.PI) / 180)}
          cy={24 + 15 * Math.sin((a * Math.PI) / 180)}
          r="2.6"
          fill="#fff"
          stroke="#5a5a5a"
          strokeWidth={1.2}
        />
      ))}
    </>
  ),
  gear: (
    <>
      <circle cx="24" cy="24" r="13" {...F} />
      <circle cx="24" cy="24" r="5" fill="#fff" stroke="#5a5a5a" strokeWidth={1.6} />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
        <rect
          key={a}
          x="22"
          y="4"
          width="4"
          height="7"
          {...FD}
          transform={`rotate(${a} 24 24)`}
        />
      ))}
    </>
  ),
  shaft: (
    <>
      <rect x="4" y="20" width="40" height="8" rx="1" {...F} />
      <ellipse cx="44" cy="24" rx="2.5" ry="4" {...FD} />
    </>
  ),
  collar: (
    <>
      <circle cx="24" cy="24" r="15" {...F} />
      <circle cx="24" cy="24" r="8" fill="#fff" stroke="#5a5a5a" strokeWidth={1.6} />
      <rect x="22" y="4" width="4" height="8" {...FD} />
    </>
  ),
  belt: (
    <>
      <path d="M14 12a12 12 0 0 0 0 24h20a12 12 0 0 0 0-24z" fill="none" stroke="#5a5a5a" strokeWidth={6} />
      <path d="M14 12a12 12 0 0 0 0 24h20a12 12 0 0 0 0-24z" fill="none" stroke="#d5d5d5" strokeWidth={3} />
    </>
  ),
  chain: (
    <>
      <ellipse cx="13" cy="24" rx="8" ry="5" {...S} />
      <ellipse cx="24" cy="24" rx="8" ry="5" {...S} />
      <ellipse cx="35" cy="24" rx="8" ry="5" {...S} />
    </>
  ),
  bar: (
    <>
      <rect x="6" y="18" width="36" height="12" rx="1" {...F} />
      <ellipse cx="42" cy="24" rx="3" ry="6" {...FD} />
    </>
  ),
  sheet: (
    <>
      <path d="M8 14h28l4 4v22H8z" {...F} />
      <path d="M36 14v4h4" {...S} />
    </>
  ),
  wrench: (
    <>
      <path d="M32 8a8 8 0 0 0-8 12L10 34l4 4 14-14a8 8 0 0 0 10-12l-6 6-4-4z" {...F} />
    </>
  ),
  hexkey: (
    <>
      <path d="M14 8v24h20" fill="none" stroke="#5a5a5a" strokeWidth={6} strokeLinejoin="miter" />
      <path d="M14 8v24h20" fill="none" stroke="#d5d5d5" strokeWidth={3} strokeLinejoin="miter" />
    </>
  ),
  pliers: (
    <>
      <path d="M18 6l6 16v20M30 6l-6 16" fill="none" stroke="#5a5a5a" strokeWidth={4} strokeLinecap="round" />
      <path d="M24 22l-5 20M24 22l5 20" fill="none" stroke="#8a8a8a" strokeWidth={4} strokeLinecap="round" />
    </>
  ),
  screwdriver: (
    <>
      <rect x="20" y="6" width="8" height="16" rx="2" {...FD} />
      <rect x="22" y="22" width="4" height="16" {...F} />
      <path d="M22 38h4v4h-4z" fill="#8a8a8a" stroke="none" />
    </>
  ),
  caliper: (
    <>
      <rect x="6" y="20" width="36" height="6" {...F} />
      <rect x="10" y="10" width="5" height="16" {...FD} />
      <rect x="30" y="10" width="5" height="16" {...FD} />
      <path d="M8 30h32" {...S} />
    </>
  ),
  micrometer: (
    <>
      <path d="M10 28a14 14 0 0 1 14-14" fill="none" stroke="#5a5a5a" strokeWidth={4} />
      <rect x="24" y="20" width="18" height="8" rx="2" {...F} />
      <path d="M30 20v8M34 20v8M38 20v8" {...S} />
    </>
  ),
  gauge: (
    <>
      <circle cx="24" cy="21" r="15" {...F} />
      <circle cx="24" cy="21" r="11" fill="#fff" stroke="#5a5a5a" strokeWidth={1.2} />
      <path d="M24 21l7-6" stroke="#5a5a5a" strokeWidth={2} strokeLinecap="round" />
      <rect x="21" y="36" width="6" height="8" {...FD} />
    </>
  ),
  thermometer: (
    <>
      <circle cx="24" cy="36" r="7" {...F} />
      <rect x="21" y="6" width="6" height="26" rx="3" {...F} />
      <path d="M28 12h4M28 18h4M28 24h4" {...S} />
    </>
  ),
  regulator: (
    <>
      <rect x="12" y="18" width="24" height="16" rx="2" {...F} />
      <circle cx="24" cy="10" r="7" {...FD} />
      <path d="M6 26h6M36 26h6" stroke="#5a5a5a" strokeWidth={4} />
    </>
  ),
  filter: (
    <>
      <path d="M14 8h20v8l-6 8v16h-8V24l-6-8z" {...F} />
      <path d="M14 12h20" {...S} />
    </>
  ),
  safety: (
    <>
      <path d="M24 5l15 6v13c0 10-7 16-15 19-8-3-15-9-15-19V11z" {...F} />
      <path d="M17 24l5 5 10-11" fill="none" stroke="#5a5a5a" strokeWidth={2.4} />
    </>
  ),
  goggles: (
    <>
      <rect x="6" y="18" width="36" height="13" rx="6" {...F} />
      <circle cx="16" cy="24" r="4" fill="#fff" stroke="#5a5a5a" strokeWidth={1.4} />
      <circle cx="32" cy="24" r="4" fill="#fff" stroke="#5a5a5a" strokeWidth={1.4} />
    </>
  ),
  glove: (
    <>
      <path d="M14 42V20a3 3 0 0 1 6 0v-6a3 3 0 0 1 6 0v4a3 3 0 0 1 6 0v4a3 3 0 0 1 6 0v14z" {...F} />
    </>
  ),
  mask: (
    <>
      <path d="M8 20c8-6 24-6 32 0v8c0 6-8 12-16 12S8 34 8 28z" {...F} />
      <path d="M8 24h32M8 30h32" {...S} />
    </>
  ),
  electrical: (
    <>
      <path d="M26 4L12 26h10l-4 18 18-24H26z" {...FD} />
    </>
  ),
  wire: (
    <>
      <path d="M6 30c8-16 12 12 20-4s10 8 16-2" fill="none" stroke="#5a5a5a" strokeWidth={6} strokeLinecap="round" />
      <path d="M6 30c8-16 12 12 20-4s10 8 16-2" fill="none" stroke="#c8c8c8" strokeWidth={3} strokeLinecap="round" />
    </>
  ),
  light: (
    <>
      <path d="M24 6a12 12 0 0 0-7 21v5h14v-5a12 12 0 0 0-7-21z" {...F} />
      <rect x="19" y="34" width="10" height="7" rx="1" {...FD} />
    </>
  ),
  enclosure: (
    <>
      <rect x="8" y="8" width="32" height="32" rx="2" {...F} />
      <rect x="13" y="13" width="22" height="22" fill="#fff" stroke="#5a5a5a" strokeWidth={1.2} />
      <circle cx="36" cy="24" r="1.8" fill="#5a5a5a" stroke="none" />
    </>
  ),
  cart: (
    <>
      <path d="M6 10h6l6 20h18" fill="none" stroke="#5a5a5a" strokeWidth={2.4} />
      <rect x="16" y="14" width="24" height="12" {...F} />
      <circle cx="20" cy="38" r="4" {...FD} />
      <circle cx="34" cy="38" r="4" {...FD} />
    </>
  ),
  caster: (
    <>
      <rect x="14" y="4" width="20" height="7" rx="1" {...FD} />
      <path d="M20 11v8M28 11v8" {...S} />
      <circle cx="24" cy="30" r="12" {...F} />
      <circle cx="24" cy="30" r="4" {...FD} />
    </>
  ),
  hoist: (
    <>
      <path d="M8 6h32" stroke="#5a5a5a" strokeWidth={3} />
      <path d="M24 6v10" {...S} />
      <rect x="16" y="16" width="16" height="14" rx="2" {...F} />
      <path d="M24 30v6" {...S} />
      <path d="M18 36h12l-6 8z" {...FD} />
    </>
  ),
  sling: (
    <>
      <path d="M14 10a10 10 0 0 1 20 0" fill="none" stroke="#5a5a5a" strokeWidth={3} />
      <path d="M14 10c0 14 20 14 20 28" fill="none" stroke="#5a5a5a" strokeWidth={5} />
      <path d="M14 10c0 14 20 14 20 28" fill="none" stroke="#cfcfcf" strokeWidth={2.5} />
    </>
  ),
  saw: (
    <>
      <rect x="6" y="18" width="36" height="7" {...F} />
      <path d="M6 25l4 6 4-6 4 6 4-6 4 6 4-6 4 6 4-6 4 6" fill="none" stroke="#5a5a5a" strokeWidth={1.6} />
    </>
  ),
  drill: (
    <>
      <rect x="21" y="6" width="6" height="10" {...FD} />
      <path d="M21 16h6v26l-3 4-3-4z" {...F} />
      <path d="M21 22l6 4M21 30l6 4" {...S} />
    </>
  ),
  abrasive: (
    <>
      <circle cx="24" cy="24" r="17" {...F} />
      <circle cx="24" cy="24" r="4" fill="#fff" stroke="#5a5a5a" strokeWidth={1.4} />
      <circle cx="16" cy="18" r="1.3" fill="#8a8a8a" stroke="none" />
      <circle cx="31" cy="19" r="1.3" fill="#8a8a8a" stroke="none" />
      <circle cx="19" cy="31" r="1.3" fill="#8a8a8a" stroke="none" />
      <circle cx="30" cy="30" r="1.3" fill="#8a8a8a" stroke="none" />
    </>
  ),
  grinder: (
    <>
      <circle cx="24" cy="24" r="16" {...F} />
      <circle cx="24" cy="24" r="6" fill="#fff" stroke="#5a5a5a" strokeWidth={1.6} />
      <path d="M24 8v6M24 34v6M8 24h6M34 24h6" {...S} />
    </>
  ),
  endmill: (
    <>
      <rect x="20" y="4" width="8" height="14" {...FD} />
      <rect x="20" y="18" width="8" height="24" {...F} />
      <path d="M20 22l8 4M20 28l8 4M20 34l8 4" {...S} />
    </>
  ),
  weld: (
    <>
      <path d="M10 38l20-20" stroke="#5a5a5a" strokeWidth={4} strokeLinecap="round" />
      <path d="M30 18l8-8" stroke="#8a8a8a" strokeWidth={6} strokeLinecap="round" />
      <path d="M8 40l2-6 4 4z" fill="#f2c200" stroke="none" />
    </>
  ),
  oiler: (
    <>
      <path d="M12 24h16v12H12z" {...F} />
      <path d="M28 28l10-8" stroke="#5a5a5a" strokeWidth={2.4} />
      <path d="M16 24v-6h8v6" {...S} />
      <circle cx="40" cy="18" r="2" fill="#8a8a8a" stroke="none" />
    </>
  ),
  grease: (
    <>
      <rect x="14" y="12" width="20" height="28" rx="2" {...F} />
      <rect x="19" y="6" width="10" height="6" rx="1" {...FD} />
      <path d="M14 20h20M14 28h20" {...S} />
    </>
  ),
  hinge: (
    <>
      <rect x="8" y="8" width="14" height="32" {...F} />
      <rect x="26" y="8" width="14" height="32" {...F} />
      <circle cx="24" cy="14" r="3.5" {...FD} />
      <circle cx="24" cy="24" r="3.5" {...FD} />
      <circle cx="24" cy="34" r="3.5" {...FD} />
    </>
  ),
  knob: (
    <>
      <circle cx="24" cy="20" r="13" {...F} />
      <circle cx="24" cy="20" r="5" {...FD} />
      <rect x="21" y="33" width="6" height="11" {...F} />
    </>
  ),
  fan: (
    <>
      <rect x="6" y="6" width="36" height="36" rx="3" {...S} />
      <circle cx="24" cy="24" r="4" {...FD} />
      <path d="M24 20c-8-8-14 2-4 4M28 24c8-8-2-14-4-4M24 28c8 8 14-2 4-4M20 24c-8 8 2 14 4 4" {...F} />
    </>
  ),
  heater: (
    <>
      <rect x="16" y="6" width="16" height="34" rx="8" {...F} />
      <path d="M20 14h8M20 20h8M20 26h8M20 32h8" {...S} />
    </>
  ),
  shelf: (
    <>
      <rect x="8" y="8" width="32" height="32" {...S} />
      <path d="M8 19h32M8 30h32" {...S} />
    </>
  ),
  bench: (
    <>
      <rect x="6" y="16" width="36" height="6" {...F} />
      <path d="M10 22v18M38 22v18" stroke="#5a5a5a" strokeWidth={3} />
      <path d="M10 32h28" {...S} />
    </>
  ),
  building: (
    <>
      <path d="M8 40V16l16-8 16 8v24z" {...F} />
      <rect x="20" y="28" width="8" height="12" fill="#fff" stroke="#5a5a5a" strokeWidth={1.4} />
      <rect x="13" y="19" width="6" height="6" fill="#fff" stroke="#5a5a5a" strokeWidth={1.2} />
      <rect x="29" y="19" width="6" height="6" fill="#fff" stroke="#5a5a5a" strokeWidth={1.2} />
    </>
  ),
  door: (
    <>
      <rect x="12" y="6" width="24" height="36" {...F} />
      <circle cx="30" cy="24" r="1.8" fill="#5a5a5a" stroke="none" />
    </>
  ),
  mat: (
    <>
      <path d="M6 32l18-8 18 8-18 8z" {...F} />
      <path d="M14 30l18 8M20 27l18 8" stroke="#8a8a8a" strokeWidth={1.2} />
    </>
  ),
  sign: (
    <>
      <path d="M24 8l16 26H8z" {...F} />
      <path d="M24 18v8" stroke="#5a5a5a" strokeWidth={2.4} />
      <circle cx="24" cy="30" r="1.6" fill="#5a5a5a" stroke="none" />
    </>
  ),
  label: (
    <>
      <path d="M6 16h26l10 8-10 8H6z" {...F} />
      <circle cx="13" cy="24" r="2" fill="#fff" stroke="#5a5a5a" strokeWidth={1.2} />
    </>
  ),
  box: (
    <>
      <path d="M8 16l16-8 16 8v18l-16 8-16-8z" {...F} />
      <path d="M8 16l16 8 16-8M24 24v18" {...S} />
    </>
  ),
  tape: (
    <>
      <circle cx="24" cy="24" r="16" {...F} />
      <circle cx="24" cy="24" r="7" fill="#fff" stroke="#5a5a5a" strokeWidth={1.6} />
      <path d="M38 20l6-2v6l-6 2" {...FD} />
    </>
  ),
  adhesive: (
    <>
      <path d="M20 8h8v6l4 6v22H16V20l4-6z" {...F} />
      <rect x="21" y="4" width="6" height="4" {...FD} />
      <path d="M16 26h16" {...S} />
    </>
  ),
  spray: (
    <>
      <rect x="16" y="14" width="16" height="28" rx="2" {...F} />
      <rect x="20" y="6" width="8" height="8" {...FD} />
      <path d="M32 10h5M32 14h5" {...S} />
    </>
  ),
  bracket: (
    <>
      <path d="M10 8h8v24h20v8H10z" {...F} />
      <circle cx="14" cy="14" r="1.8" fill="#fff" stroke="#5a5a5a" strokeWidth={1.2} />
      <circle cx="32" cy="36" r="1.8" fill="#fff" stroke="#5a5a5a" strokeWidth={1.2} />
    </>
  ),
  hanger: (
    <>
      <path d="M24 4v10" {...S} />
      <path d="M12 14a12 12 0 0 0 24 0" fill="none" stroke="#5a5a5a" strokeWidth={3} />
      <circle cx="24" cy="30" r="10" fill="none" stroke="#5a5a5a" strokeWidth={4} />
      <circle cx="24" cy="30" r="10" fill="none" stroke="#dcdcdc" strokeWidth={2} />
    </>
  ),
  faucet: (
    <>
      <path d="M10 38h12V24a10 10 0 0 1 20 0" fill="none" stroke="#5a5a5a" strokeWidth={5} />
      <rect x="6" y="36" width="20" height="6" rx="1" {...FD} />
    </>
  ),
  broom: (
    <>
      <path d="M24 6v20" stroke="#5a5a5a" strokeWidth={3} />
      <path d="M14 26h20l4 16H10z" {...F} />
      <path d="M18 26v16M24 26v16M30 26v16" {...S} />
    </>
  ),
  kit: (
    <>
      <rect x="6" y="14" width="36" height="26" rx="2" {...F} />
      <rect x="18" y="8" width="12" height="6" rx="1" {...FD} />
      <path d="M6 24h36M18 14v26M30 14v26" {...S} />
    </>
  ),
  box_default: (
    <>
      <rect x="10" y="10" width="28" height="28" rx="2" {...F} />
    </>
  ),
};

export function ProductIcon({
  name,
  size = 48,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const shape = icons[name] ?? icons.box_default;
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {shape}
    </svg>
  );
}
