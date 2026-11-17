// Pastel tile in the owner's reference style (2026-11-16): a soft-coloured rounded tile with a faint diagonal texture, a
// large icon in a strong matching colour (optionally with a number beside it), and the label underneath. Used by the
// Dashboard's status counters and Quick Links. Dark mode uses deep tones of the same colours.
import type { ReactNode } from 'react';
import { Icon, type IconName } from './icons';

// The reference's colours: blue (Docs), peach (Slides), green (Sheets), lavender (Design), red (Data), pink (Whiteboard),
// and a neutral slate.
export type PastelTone = 'blue' | 'peach' | 'green' | 'lavender' | 'red' | 'pink' | 'slate';

// Tile background, icon and number colour, and the selected ring, per tone.
const TONES: Record<PastelTone, { tile: string; ink: string; ring: string }> = {
  blue: { tile: 'bg-[#cfe2fb] dark:bg-blue-950/70', ink: 'text-[#1d5bb5] dark:text-blue-300', ring: 'ring-[#1d5bb5] dark:ring-blue-300' },
  peach: { tile: 'bg-[#f7dccb] dark:bg-orange-950/70', ink: 'text-[#a3411c] dark:text-orange-300', ring: 'ring-[#a3411c] dark:ring-orange-300' },
  green: { tile: 'bg-[#cdeccd] dark:bg-green-950/70', ink: 'text-[#1d7a2b] dark:text-green-300', ring: 'ring-[#1d7a2b] dark:ring-green-300' },
  lavender: { tile: 'bg-[#e3ddfb] dark:bg-violet-950/70', ink: 'text-[#5a3fc0] dark:text-violet-300', ring: 'ring-[#5a3fc0] dark:ring-violet-300' },
  red: { tile: 'bg-[#f9d5d3] dark:bg-red-950/70', ink: 'text-[#b4232c] dark:text-red-300', ring: 'ring-[#b4232c] dark:ring-red-300' },
  pink: { tile: 'bg-[#fad7e4] dark:bg-pink-950/70', ink: 'text-[#9c1d4c] dark:text-pink-300', ring: 'ring-[#9c1d4c] dark:ring-pink-300' },
  slate: { tile: 'bg-[#e2e8f0] dark:bg-slate-800', ink: 'text-[#475569] dark:text-slate-300', ring: 'ring-[#475569] dark:ring-slate-300' },
};

// The faint diagonal texture over the tile (like the reference's sketched background); much fainter in dark mode.
const TEXTURE =
  '[background-image:repeating-linear-gradient(135deg,rgba(255,255,255,0.28)_0_2px,transparent_2px_11px)] dark:[background-image:repeating-linear-gradient(135deg,rgba(255,255,255,0.04)_0_2px,transparent_2px_11px)]';

// The tile and its label; the caller wraps it in a button or link. With "labelInside" (the Dashboard's status counters,
// owner request 2026-11-16) the label sits inside the tile, under the icon and number, in the tile's colour.
export function PastelTile({
  tone,
  icon,
  label,
  value,
  selected = false,
  labelInside = false,
}: {
  tone: PastelTone;
  icon: IconName;
  label: string;
  value?: ReactNode;
  selected?: boolean;
  labelInside?: boolean;
}) {
  const look = TONES[tone];
  if (labelInside) {
    return (
      <span
        className={`${TEXTURE} relative flex h-24 w-full flex-col items-center justify-center gap-1.5 rounded-2xl px-2 transition-transform duration-200 group-hover:-translate-y-0.5 ${look.tile} ${selected ? `ring-2 ring-offset-2 ring-offset-background ${look.ring}` : ''}`}
      >
        <span className="flex items-center justify-center gap-2.5">
          <Icon name={icon} className={`h-8 w-8 ${look.ink}`} />
          {value !== undefined && <span className={`text-3xl font-bold leading-none tabular-nums ${look.ink}`}>{value}</span>}
        </span>
        <span className={`max-w-full truncate text-[13px] font-semibold leading-tight ${look.ink}`}>{label}</span>
      </span>
    );
  }
  return (
    <span className="flex w-full flex-col gap-2 text-left">
      <span
        className={`${TEXTURE} relative flex h-24 w-full items-center justify-center gap-3 rounded-2xl transition-transform duration-200 group-hover:-translate-y-0.5 ${look.tile} ${selected ? `ring-2 ring-offset-2 ring-offset-background ${look.ring}` : ''}`}
      >
        <Icon name={icon} className={`h-9 w-9 ${look.ink}`} />
        {value !== undefined && <span className={`text-3xl font-bold leading-none tabular-nums ${look.ink}`}>{value}</span>}
      </span>
      <span className="truncate px-0.5 text-sm font-medium text-slate-800 dark:text-slate-100">{label}</span>
    </span>
  );
}
