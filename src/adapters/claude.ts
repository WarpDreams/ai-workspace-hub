import path from "node:path";
import type { Adapter, InstructionMapping } from "./types";

/**
 * Claude Code:
 *   - global instructions: <home>/CLAUDE.md  (single composed file)
 *   - skills:              <home>/skills/<name>
 */
export const claudeAdapter: Adapter = {
  id: "claude",
  displayName: "Claude Code",

  instructionMapping(homeAbs: string): InstructionMapping {
    return {
      mode: "single-file",
      singleFile: path.join(homeAbs, "CLAUDE.md"),
    };
  },

  skillsRoot(homeAbs: string): string {
    return path.join(homeAbs, "skills");
  },

  candidateHomes(): string[] {
    return ["~/.claude"];
  },
};
