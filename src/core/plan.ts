import path from "node:path";
import type { Manifest, ResolvedTarget } from "../config/schema";
import { resolveTargets } from "../config/schema";
import { getAdapter } from "../adapters/index";
import { absPath } from "../util/paths";
import {
  composedInstructionPath,
  composedMatches,
  instructionFragmentPath,
  isComposed,
  resolveInstructionSelection,
  resolveSkillSelection,
  skillPath,
} from "./content";
import { inspect, type LinkState } from "./link";

export interface PlanOp {
  kind: "instruction" | "skill";
  agent: string;
  home: string;
  label?: string;
  strategy: "symlink" | "copy";
  /** Absolute source path in the repo (or build/ for composed instructions). */
  source: string;
  /** Absolute destination path in the agent home. */
  dest: string;
  /** Current on-disk state of the destination vs. desired. */
  state: LinkState;
  /** A short name for display (skill name or instruction fragment/composite). */
  name: string;
  /**
   * For single-file instruction ops: the selected fragments. When there are
   * 2+ the source is a generated composite under build/ that install/sync
   * (re)write; plan/status report it as "stale" when out of date.
   */
  fragments?: string[];
}

export interface TargetPlan {
  target: ResolvedTarget;
  homeAbs: string;
  ops: PlanOp[];
}

export interface Plan {
  targets: TargetPlan[];
}

function buildTargetPlan(target: ResolvedTarget): TargetPlan {
  const adapter = getAdapter(target.agent);
  const homeAbs = absPath(target.home);
  const ops: PlanOp[] = [];

  // --- Instructions ---
  const fragments = resolveInstructionSelection(target.instructions);
  const mapping = adapter.instructionMapping(homeAbs);

  if (fragments.length === 0) {
    // Explicit `instructions: []` — this target manages no instructions.
  } else if (mapping.mode === "single-file") {
    const source = composedInstructionPath(fragments);
    const dest = mapping.singleFile!;
    let state = inspect(dest, source, target.strategy).state;
    if (isComposed(fragments)) {
      // The link/copy may be in place while the generated composite is missing
      // or older than the fragments it was built from.
      if (state === "linked" && !composedMatches(fragments, source)) state = "stale";
      if (state === "copied" && !composedMatches(fragments, dest)) state = "stale";
    }
    ops.push({
      kind: "instruction",
      agent: target.agent,
      home: homeAbs,
      label: target.label,
      strategy: target.strategy,
      source,
      dest,
      state,
      name: fragments.length === 1 ? fragments[0] : fragments.join("+"),
      fragments,
    });
  } else {
    // per-fragment
    for (const frag of fragments) {
      const source = instructionFragmentPath(frag);
      const dest = mapping.perFragment!(frag);
      ops.push({
        kind: "instruction",
        agent: target.agent,
        home: homeAbs,
        label: target.label,
        strategy: target.strategy,
        source,
        dest,
        state: inspect(dest, source, target.strategy).state,
        name: frag,
      });
    }
  }

  // --- Skills ---
  const skills = resolveSkillSelection(target.skills);
  const skillsRoot = adapter.skillsRoot(homeAbs);
  for (const skill of skills) {
    const source = skillPath(skill);
    const dest = path.join(skillsRoot, skill);
    ops.push({
      kind: "skill",
      agent: target.agent,
      home: homeAbs,
      label: target.label,
      strategy: target.strategy,
      source,
      dest,
      state: inspect(dest, source, target.strategy).state,
      name: skill,
    });
  }

  return { target, homeAbs, ops };
}

export function buildPlan(manifest: Manifest): Plan {
  const resolved = resolveTargets(manifest).filter((t) => !t.disabled);
  return { targets: resolved.map(buildTargetPlan) };
}
