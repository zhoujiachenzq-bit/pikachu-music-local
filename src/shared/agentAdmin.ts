export type AgentBudgetState = 'normal' | 'flash_only' | 'paused';

export function normalizeAgentBudget(value: number, fallback = 150): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function agentBudgetSnapshot(monthlyCostCny: number, configuredBudgetCny: number) {
  const budgetCny = normalizeAgentBudget(configuredBudgetCny);
  const costCny = Number.isFinite(monthlyCostCny) && monthlyCostCny > 0 ? monthlyCostCny : 0;
  const ratio = costCny / budgetCny;
  const state: AgentBudgetState = ratio >= 1 ? 'paused' : ratio >= .8 ? 'flash_only' : 'normal';
  return { monthlyCostCny: costCny, budgetCny, ratio, state };
}
