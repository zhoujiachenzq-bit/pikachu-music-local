import { describe, expect, it } from 'vitest';
import { formatSleepRemaining } from './sleepTimer';

describe('formatSleepRemaining', () => {
  it('rounds up so the display never shows zero early', () => {
    expect(formatSleepRemaining(1)).toBe('00:01');
    expect(formatSleepRemaining(90_000)).toBe('01:30');
  });

  it('adds hours only when needed and never goes negative', () => {
    expect(formatSleepRemaining(90 * 60_000)).toBe('1:30:00');
    expect(formatSleepRemaining(-500)).toBe('00:00');
  });
});
