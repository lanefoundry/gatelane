export interface AttackVector {
  id: string;
  name: string;
  category: "direct-prompt-injection" | "indirect-via-tool" | "chain-attack" | "context-window-flood" | "memory-poisoning" | "tool-abuse";
  payload: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low";
  references: string[];
}

export interface AttackResult {
  vectorId: string;
  targetId: string;
  success: boolean;
  payload: string;
  agentResponse: string;
  evidence: string;
  patchRecommendation: string;
  latencyMs: number;
  timestamp: string;
}

export interface AttackReport {
  id: string;
  targets: string[];
  totalAttacks: number;
  successfulAttacks: number;
  results: AttackResult[];
  createdAt: string;
}
