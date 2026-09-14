import path from "node:path";
import type { Adapter, InstructionMapping } from "./types";

/**
 * Kiro CLI:
 *   - global instructions: <home>/steering/<fragment>.md  (one file per fragment)
 *   - skills:              <home>/skills/<name>
 */
export const kiroAdapter: Adapter = {
  id: "kiro",
  displayName: "Kiro CLI",

  instructionMapping(homeAbs: string): InstructionMapping {
    return {
      mode: "per-fragment",
      perFragment: (fragmentName: string) =>
        path.join(homeAbs, "steering", `${fragmentName}.md`),
    };
  },

  skillsRoot(homeAbs: string): string {
    return path.join(homeAbs, "skills");
  },

  candidateHomes(): string[] {
    return ["~/.kiro"];
  },
};
