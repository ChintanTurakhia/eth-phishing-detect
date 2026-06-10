import type { BudgetState } from "@virtual-sim/shared";
import type { SqliteStore } from "../db/store.js";

export class BudgetManager {
  constructor(
    private readonly store: SqliteStore,
    private budgetTokens: number,
    private readonly onUpdate: (state: BudgetState) => void,
  ) {}

  setBudget(tokens: number): void {
    this.budgetTokens = tokens;
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  state(): BudgetState {
    const day = this.today();
    const usage = this.store.usageForDay(day);
    const used = usage.inputTokens + usage.outputTokens;
    return {
      day,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      budgetTokens: this.budgetTokens,
      exhausted: this.budgetTokens > 0 && used >= this.budgetTokens,
    };
  }

  /**
   * Degradation policy: reflections drop first, then reactions; core calls
   * (plans, dialogue already in flight) keep running until hard exhaustion
   * at 110%.
   */
  allows(purpose: string): boolean {
    if (this.budgetTokens <= 0) return true;
    const s = this.state();
    const used = s.inputTokens + s.outputTokens;
    if (used >= this.budgetTokens * 1.1) return false;
    if (used >= this.budgetTokens) {
      return purpose !== "reflect.questions" && purpose !== "reflect.insights" && purpose !== "react";
    }
    if (used >= this.budgetTokens * 0.9) {
      return purpose !== "reflect.questions" && purpose !== "reflect.insights";
    }
    return true;
  }

  record(model: string, purpose: string, inputTokens: number, outputTokens: number, cacheReadTokens: number): void {
    this.store.recordUsage({
      day: this.today(),
      model,
      purpose,
      inputTokens,
      outputTokens,
      cacheReadTokens,
    });
    this.onUpdate(this.state());
  }
}

/** Thrown when the budget hard-blocks a call; callers treat it as a soft skip. */
export class BudgetExhaustedError extends Error {
  constructor(purpose: string) {
    super(`daily token budget exhausted (purpose: ${purpose})`);
    this.name = "BudgetExhaustedError";
  }
}
