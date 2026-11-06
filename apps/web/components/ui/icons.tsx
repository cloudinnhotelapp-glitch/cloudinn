// The app's single icon set: Google's Material Symbols Outlined (weight 400, the same icon font the reference app uses),
// self-hosted from the "material-symbols" package. Every icon in the app goes through <Icon>, so the whole set can be
// changed here. Icons are decorative (hidden from screen readers); the surrounding text carries the meaning.
import type { CSSProperties, HTMLAttributes } from 'react';
import 'material-symbols/outlined.css';

// App icon names mapped to Material Symbols ligatures.
const SYMBOLS = {
  hotel: 'hotel',
  building: 'apartment',
  briefcase: 'work',
  concierge: 'room_service',
  dashboard: 'dashboard',
  roomStatus: 'grid_view',
  floors: 'layers',
  tag: 'sell',
  bed: 'bed',
  users: 'group',
  calendarCheck: 'event_available',
  calendar: 'calendar_month',
  sparkles: 'auto_awesome',
  key: 'key',
  logOut: 'logout',
  menu: 'menu',
  chevronLeft: 'chevron_left',
  chevronRight: 'chevron_right',
  chevronDown: 'expand_more',
  firstPage: 'first_page',
  lastPage: 'last_page',
  close: 'close',
  search: 'search',
  plus: 'add',
  user: 'person',
  inbox: 'inbox',
  trash: 'delete',
  edit: 'edit',
  moreVertical: 'more_vert',
  toggleOn: 'toggle_on',
  toggleOff: 'toggle_off',
  filter: 'filter_list',
  info: 'info',
  mapPin: 'location_on',
  eye: 'visibility',
  eyeOff: 'visibility_off',
  arrowLeft: 'arrow_back',
  arrowRight: 'arrow_forward',
  checkCircle: 'check_circle',
  alertTriangle: 'warning',
  error: 'error',
  arrivals: 'south_west',
  departures: 'north_east',
  clipboard: 'assignment',
  shield: 'verified_user',
  lock: 'lock',
  mail: 'mail',
  spinner: 'progress_activity',
  upload: 'upload',
  download: 'download',
  image: 'image',
  file: 'description',
  idCard: 'badge',
} as const;

// Every available icon name.
export type IconName = keyof typeof SYMBOLS;

// Props: the icon name, an optional filled style (used for the active menu entry, as in the reference), and normal span
// attributes. The size comes from the h-* class in className (h-5 = 20px), the colour from the text colour.
export interface IconProps extends HTMLAttributes<HTMLSpanElement> {
  name: IconName;
  filled?: boolean;
}

// Converts a Tailwind height class (h-4, h-4.5, h-[18px]) into a pixel font size for the icon glyph; defaults to 20px.
function sizeFromClass(className: string): number {
  const arbitrary = /(?:^|\s)h-\[(\d+(?:\.\d+)?)px\]/.exec(className);
  if (arbitrary) return Number(arbitrary[1]);
  const scale = /(?:^|\s)h-(\d+(?:\.\d+)?)(?:\s|$)/.exec(className);
  return scale ? Number(scale[1]) * 4 : 20;
}

// Renders one decorative icon.
export function Icon({ name, filled = false, className = 'h-5 w-5', style, ...rest }: IconProps) {
  const size = sizeFromClass(className);
  const glyphStyle: CSSProperties = {
    fontSize: size,
    width: size,
    height: size,
    fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' 400, 'GRAD' 0, 'opsz' 24`,
    ...style,
  };
  return (
    <span aria-hidden="true" className={`material-symbols-outlined inline-flex shrink-0 select-none items-center justify-center overflow-hidden leading-none ${className}`} style={glyphStyle} {...rest}>
      {SYMBOLS[name]}
    </span>
  );
}
