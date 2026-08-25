import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('mobile player layout', () => {
  it('keeps page scrolling out of the player while lyrics scroll internally', () => {
    const styles = readFileSync('src/client/styles.css', 'utf8');

    expect(styles).toContain(".player-panel[data-mobile-section='player'] { overflow: clip; }");
    expect(styles).toContain(
      ".player-panel[data-mobile-section='player'] .stage-surface { height: 100%; min-height: 0; }",
    );
    expect(styles).toContain(
      ".player-panel[data-mobile-section='player'] .lyrics { min-height: 0; flex: 1; }",
    );
    expect(styles).toMatch(/\.lyrics-scroll\s*\{[^}]*overflow-y:\s*auto;/s);
  });
});
