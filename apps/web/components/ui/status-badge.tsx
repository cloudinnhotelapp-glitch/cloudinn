// Status badge used everywhere a status is shown (reference: px-2.5 py-0.5 rounded-full text-[10px] bold uppercase
// tracking-wider, soft tint with a matching border). Colours come from the central status tone map (lib/status-tones).
import { titleCase } from '@/lib/format';
import { statusTone, TONES } from '@/lib/status-tones';

// Renders the badge; the visible text stays in title case for screen readers, CSS shows it in capitals.
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${TONES[statusTone(status)].badge}`}>
      {label ?? titleCase(status)}
    </span>
  );
}
