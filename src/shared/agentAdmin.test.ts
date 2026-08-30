import { describe, expect, it } from 'vitest';
import { agentBudgetSnapshot, normalizeAgentBudget } from './agentAdmin.js';

describe('agent admin budget policy', () => {
  it('keeps the full model route below 80 percent', () => {
    expect(agentBudgetSnapshot(119.99, 150)).toMatchObject({ state: 'normal', budgetCny: 150 });
  });

  it('forces flash at 80 percent and pauses at 100 percent', () => {
    expect(agentBudgetSnapshot(120, 150).state).toBe('flash_only');
    expect(agentBudgetSnapshot(150, 150).state).toBe('paused');
  });

  it('sanitizes invalid budgets and costs', () => {
    expect(normalizeAgentBudget(0)).toBe(150);
    expect(agentBudgetSnapshot(Number.NaN, -1)).toMatchObject({ monthlyCostCny: 0, budgetCny: 150, ratio: 0, state: 'normal' });
  });
});
