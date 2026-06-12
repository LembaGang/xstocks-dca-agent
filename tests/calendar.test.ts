import { describe, it, expect } from 'vitest';
import { localSession } from '../src/calendar.js';

// Times below are UTC. ET = UTC-4 during DST (Mar–Nov), UTC-5 otherwise.
// We pick dates inside DST so the math is straightforward.

describe('localSession', () => {
  it('returns WEEKEND on Saturday in ET', () => {
    // 2026-06-13 is Saturday in ET when interpreted in America/New_York.
    // 17:00 UTC = 13:00 ET (Sat); 05:00 UTC = 01:00 ET (Sat).
    expect(localSession(new Date('2026-06-13T17:00:00Z'))).toBe('WEEKEND');
    expect(localSession(new Date('2026-06-13T05:00:00Z'))).toBe('WEEKEND');
  });

  it('returns WEEKEND on Sunday', () => {
    expect(localSession(new Date('2026-06-14T15:00:00Z'))).toBe('WEEKEND');
  });

  it('returns REGULAR on a weekday during NYSE hours', () => {
    // 2026-06-08 is a Monday. 14:00 UTC = 10:00 ET (mid-session).
    expect(localSession(new Date('2026-06-08T14:00:00Z'))).toBe('REGULAR');
    // 19:00 UTC = 15:00 ET (still session).
    expect(localSession(new Date('2026-06-08T19:00:00Z'))).toBe('REGULAR');
  });

  it('returns OUTSIDE_REGULAR before 9:30 ET on a weekday', () => {
    // 13:00 UTC = 09:00 ET — before open.
    expect(localSession(new Date('2026-06-08T13:00:00Z'))).toBe('OUTSIDE_REGULAR');
  });

  it('returns OUTSIDE_REGULAR at exactly 4:00 ET (close boundary)', () => {
    // 20:00 UTC = 16:00 ET — close. We treat the close minute as outside.
    expect(localSession(new Date('2026-06-08T20:00:00Z'))).toBe('OUTSIDE_REGULAR');
  });

  it('returns REGULAR at exactly 9:30 ET (open boundary)', () => {
    // 13:30 UTC = 09:30 ET — open.
    expect(localSession(new Date('2026-06-08T13:30:00Z'))).toBe('REGULAR');
  });
});
