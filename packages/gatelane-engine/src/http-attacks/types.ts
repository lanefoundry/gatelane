export type AttackCategory =
  | "direct-prompt-injection"
  | "indirect-via-tool"
  | "chain-attack"
  | "context-window-flood"
  | "memory-poisoning"
  | "tool-abuse";

export interface AttackVector {
  id: string;
  name: string;
  category: AttackCategory;
  payload: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low";
  references: string[];
}
