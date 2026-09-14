import type { AgentId } from "../config/schema";

/**
 * An InstructionMapping tells the planner where a single logical instruction
 * unit should be materialized in an agent home, and how.
 *
 * - "single-file": all selected instruction fragments are composed into ONE
 *   destination file (e.g. Claude's CLAUDE.md, Codex's AGENTS.md).
 * - "per-fragment": each fragment maps to its own destination file
 *   (e.g. Kiro's steering/<name>.md).
 */
export interface InstructionMapping {
  mode: "single-file" | "per-fragment";
  /**
   * For "single-file": the single absolute destination path.
   * For "per-fragment": a function producing the destination for a fragment.
   */
  singleFile?: string;
  perFragment?: (fragmentName: string) => string;
}

export interface Adapter {
  id: AgentId;
  /** Human-friendly name for output. */
  displayName: string;

  /**
   * How this agent consumes global instructions, given an absolute home dir.
   */
  instructionMapping(homeAbs: string): InstructionMapping;

  /**
   * Absolute directory under which each skill is linked/copied as
   * <skillsRoot>/<skillName>.
   */
  skillsRoot(homeAbs: string): string;

  /**
   * Default home directory(ies) for this agent, probed by `doctor`. Values may
   * contain a leading ~. `doctor` additionally discovers `~/.<id>-*` siblings
   * (e.g. ~/.codex-backup) and any home the manifest declares, so only the
   * canonical default belongs here.
   */
  candidateHomes(): string[];
}
