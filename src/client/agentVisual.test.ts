import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Zhenqi empty conversation visuals', () => {
  it('does not render the decorative blinking yellow cursor', () => {
    const panel = readFileSync('src/client/AgentPanel.tsx', 'utf8');
    const styles = readFileSync('src/client/styles.css', 'utf8');

    expect(panel).not.toContain('agent-cursor');
    expect(styles).not.toContain('agent-cursor');
  });

  it('keeps settings as a focused workspace instead of stacking it over chat', () => {
    const panel = readFileSync('src/client/AgentPanel.tsx', 'utf8');
    const styles = readFileSync('src/client/styles.css', 'utf8');

    expect(panel).toContain('agent-settings-scroll');
    expect(panel).toContain('!settingsOpen && !adminOpen && !memoriesOpen && !knowledgeOpen');
    expect(styles).toContain('.agent-settings { position: absolute;');
    expect(styles).toContain('.agent-switch-list');
  });

  it('keeps one immersive backdrop mounted while player and Zhenqi foregrounds switch', () => {
    const app = readFileSync('src/client/App.tsx', 'utf8');
    const backdrop = readFileSync('src/client/ImmersiveBackdrop.tsx', 'utf8');

    expect(app.match(/<ImmersiveBackdrop\b/g)).toHaveLength(1);
    expect(app).toContain("focus={agentStageOpen ? 'agent' : 'content'}");
    expect(app).toContain("mobileSection === 'agent'");
    expect(app).not.toContain("mobileLayout && renderAgentPanel(true, mobileSection === 'agent')");
    expect(backdrop).toContain("live.current.focus === 'agent'");
  });
});
