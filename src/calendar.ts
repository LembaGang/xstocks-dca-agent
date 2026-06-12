// Cheap local precheck for NYSE/Nasdaq sessions. This is intentionally a
// coarse filter, NOT a substitute for the Headless Oracle gate:
//
//   - It only knows about weekends and the regular-session clock window.
//   - It does NOT know about US market holidays (Christmas, July 4th, …).
//   - It does NOT know about real-time halts (LULD, regulatory, exchange outages).
//
// The HO gate IS the source of truth. This local check exists only to short-
// circuit the obvious "it's 3am on a Saturday" case before we burn a network
// call on the gate. If you remove this file entirely the agent still behaves
// correctly — just chattier.

const NYSE_OPEN_HOUR_ET = 9;
const NYSE_OPEN_MIN_ET = 30;
const NYSE_CLOSE_HOUR_ET = 16;

export type LocalSession = 'REGULAR' | 'WEEKEND' | 'OUTSIDE_REGULAR';

export function localSession(now: Date = new Date()): LocalSession {
  // Pull ET hour/minute/weekday from the runtime locale machinery. This relies
  // on Node's ICU data — present by default since Node 13.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));

  const weekday = parts.weekday;     // "Mon" | "Tue" | ... | "Sun"
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);

  if (weekday === 'Sat' || weekday === 'Sun') return 'WEEKEND';

  const minutesFromOpen = (hour - NYSE_OPEN_HOUR_ET) * 60 + (minute - NYSE_OPEN_MIN_ET);
  const minutesFromClose = (NYSE_CLOSE_HOUR_ET - hour) * 60 - minute;

  if (minutesFromOpen >= 0 && minutesFromClose > 0) return 'REGULAR';
  return 'OUTSIDE_REGULAR';
}
