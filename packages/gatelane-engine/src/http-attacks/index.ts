import type { AttackVector } from "./types.js";
import { directPromptInjectionVectors } from "./direct-prompt-injection.js";
import { indirectViaToolVectors } from "./indirect-via-tool.js";
import { chainAttackVectors } from "./chain-attack.js";
import { contextWindowFloodVectors } from "./context-window-flood.js";
import { memoryPoisoningVectors } from "./memory-poisoning.js";
import { toolAbuseVectors } from "./tool-abuse.js";

export const allVectors: AttackVector[] = [
  ...directPromptInjectionVectors,
  ...indirectViaToolVectors,
  ...chainAttackVectors,
  ...contextWindowFloodVectors,
  ...memoryPoisoningVectors,
  ...toolAbuseVectors,
];

export {
  directPromptInjectionVectors,
  indirectViaToolVectors,
  chainAttackVectors,
  contextWindowFloodVectors,
  memoryPoisoningVectors,
  toolAbuseVectors,
};
export type { AttackVector, AttackCategory } from "./types.js";

export const ATTACK_CATEGORIES: readonly AttackVector["category"][] = [
  "direct-prompt-injection",
  "indirect-via-tool",
  "chain-attack",
  "context-window-flood",
  "memory-poisoning",
  "tool-abuse",
];
