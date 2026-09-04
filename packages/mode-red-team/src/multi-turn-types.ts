export interface ConversationTurn {
  role: "attacker" | "target";
  content: string;
  turnIndex: number;
  metadata?: Record<string, unknown>;
}

export type EscalationStrategy =
  | "crescendo"
  | "persistence"
  | "context-abuse"
  | "trust-building"
  | "pivot";

export interface MultiTurnScenario {
  id: string;
  name: string;
  description: string;
  strategy: EscalationStrategy;
  maxTurns: number;
  initialPrompt: string;
  objective: string;
  successCriteria: string;
}

export interface MultiTurnResult {
  id: string;
  scenarioId: string;
  strategy: EscalationStrategy;
  turns: ConversationTurn[];
  succeeded: boolean;
  turnWhenBreached: number | null;
  totalTurns: number;
  duration: number;
  analysis: string;
}

export interface MultiTurnReport {
  id: string;
  scenarios: MultiTurnScenario[];
  results: MultiTurnResult[];
  summary: {
    totalScenarios: number;
    breached: number;
    defended: number;
    avgTurnsToBreech: number | null;
    mostVulnerableStrategy: EscalationStrategy | null;
  };
  createdAt: string;
}
