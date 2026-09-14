import path from "node:path";
import type { Adapter, InstructionMapping } from "./types";

/**
 * Codex CLI:
 *   - global instructions: <home>/AGENTS.md  (single composed file)
 *   - skills:              <home>/skills/<name>
 */
export const codexAdapter: Adapter = {
  id: "codex",
  displayName: "Codex CLI",

  instructionMapping(homeAbs: string): InstructionMapping {
    return {
      mode: "single-file",
      singleFile: path.join(homeAbs, "AGENTS.md"),
    };
  },

  skillsRoot(homeAbs: string): string {
    return path.join(homeAbs, "skills");
  },

  candidateHomes(): string[] {
    return ["~/.codex"];
  },
};
