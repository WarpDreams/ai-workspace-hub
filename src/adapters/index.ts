import type { AgentId } from "../config/schema";
import type { Adapter } from "./types";
import { claudeAdapter } from "./claude";
import { codexAdapter } from "./codex";
import { kiroAdapter } from "./kiro";

const REGISTRY: Record<AgentId, Adapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  kiro: kiroAdapter,
};

export function getAdapter(id: AgentId): Adapter {
  return REGISTRY[id];
}

export function allAdapters(): Adapter[] {
  return Object.values(REGISTRY);
}

export type { Adapter, InstructionMapping } from "./types";
