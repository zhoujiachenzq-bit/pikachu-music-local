import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Zhenqi empty conversation visuals', () => {
  it('does not render the decorative blinking yellow cursor', () => {
    const panel = readFileSync('src/client/AgentPanel.tsx', 'utf8');
    const styles = readFileSync('src/client/styles.css', 'utf8');

    expect(panel).not.toContain('agent-cursor');
    expect(styles).not.toContain('agent-cursor');
  });
});
