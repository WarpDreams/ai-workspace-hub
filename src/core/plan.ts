import path from "node:path";
import type { Manifest, ResolvedTarget } from "../config/schema";
import { resolveTargets } from "../config/schema";
import { getAdapter } from "../adapters/index";
import { absPath } from "../util/paths";
import {
  composedInstructionPath,
  composedMatches,
  isComposed,
  resolveInstructionSelection,
  resolveSkillSelection,
  type ResolvedFragment,
} from "./content";
import { inspect, type LinkState } from "./link";
import { hasEntry, loadLedger, mcpLedgerKey, type Ledger } from "./state";
import { resolveMcpSpecs, specMatches, type McpServerOnDisk, type McpSpec } from "./mcp";
import type { AgentId } from "../config/schema";

export interface PlanOp {
  kind: "instruction" | "skill";
  agent: string;
  home: string;
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
  fragments?: ResolvedFragment[];
}

export type McpState =
  | "installed" // configured and matches the spec (versions ignored)
  | "missing" // not configured
  | "mismatch" // configured by us, but differs from the spec
  | "conflict" // configured by someone else under the same name, and differs
  | "unsupported"; // this agent's CLI cannot add this kind of server

export interface McpOp {
  agent: AgentId;
  home: string;
  name: string;
  spec: McpSpec;
  /** The agent config file the server lives in (for display only — never written). */
  configFile: string;
  state: McpState;
  /** Recorded in the ledger as ours. */
  managed: boolean;
  existing?: McpServerOnDisk;
  reason?: string;
}

export interface TargetPlan {
  target: ResolvedTarget;
  homeAbs: string;
  ops: PlanOp[];
  mcp: McpOp[];
}

export interface Plan {
  targets: TargetPlan[];
}

function buildMcpOps(target: ResolvedTarget, homeAbs: string, ledger: Ledger, manifestPath: string): McpOp[] {
  const adapter = getAdapter(target.agent);
  const specs = resolveMcpSpecs(target.mcp, manifestPath, target.mcpOrigin);
  if (specs.length === 0) return [];
  const onDisk = adapter.mcp.readServers(homeAbs);
  const configFile = adapter.mcp.configFile(homeAbs);
  const out: McpOp[] = [];
  for (const spec of specs) {
    const name = spec.name;
    if (spec.agents && !spec.agents.includes(target.agent)) continue;
    const managed = hasEntry(ledger, mcpLedgerKey(target.agent, homeAbs, name));
    const existing = onDisk[name];
    let state: McpState;
    let reason: string | undefined;
    if (!adapter.mcp.addArgv(name, spec)) {
      state = "unsupported";
      reason = `${adapter.displayName} cannot add ${spec.type} servers through its CLI`;
    } else if (!existing) {
      state = "missing";
    } else if (specMatches(spec, existing)) {
      state = "installed";
    } else {
      state = managed ? "mismatch" : "conflict";
    }
    out.push({ agent: target.agent, home: homeAbs, name, spec, configFile, state, managed, existing, reason });
  }
  return out;
}

function buildTargetPlan(target: ResolvedTarget, ledger: Ledger, manifestPath: string): TargetPlan {
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
      strategy: target.strategy,
      source,
      dest,
      state,
      name: fragments.map((f) => f.name).join("+"),
      fragments,
    });
  } else {
    // per-fragment
    for (const frag of fragments) {
      const source = frag.file;
      const dest = mapping.perFragment!(frag.name);
      ops.push({
        kind: "instruction",
        agent: target.agent,
        home: homeAbs,
          strategy: target.strategy,
        source,
        dest,
        state: inspect(dest, source, target.strategy).state,
        name: frag.name,
      });
    }
  }

  // --- Skills ---
  const skills = resolveSkillSelection(target.skills);
  const skillsRoot = adapter.skillsRoot(homeAbs);
  for (const skill of skills) {
    const source = skill.dir;
    const dest = path.join(skillsRoot, skill.name);
    ops.push({
      kind: "skill",
      agent: target.agent,
      home: homeAbs,
      strategy: target.strategy,
      source,
      dest,
      state: inspect(dest, source, target.strategy).state,
      name: skill.name,
    });
  }

  return { target, homeAbs, ops, mcp: buildMcpOps(target, homeAbs, ledger, manifestPath) };
}

export function buildPlan(manifest: Manifest, manifestPath = "(manifest)"): Plan {
  const ledger = loadLedger();
  const resolved = resolveTargets(manifest).filter((t) => !t.disabled);
  return { targets: resolved.map((t) => buildTargetPlan(t, ledger, manifestPath)) };
}
