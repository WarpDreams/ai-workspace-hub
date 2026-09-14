import { z } from "zod";

/**
 * Manifest schema for ai-workspace-hub.
 *
 * A manifest describes, for one machine, which agent "targets" exist and what
 * canonical content (instructions + skills) each should receive. It is
 * git-ignored; see examples/ for committed templates.
 */

export const AGENT_IDS = ["claude", "codex", "kiro"] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export const STRATEGIES = ["symlink", "copy"] as const;
export type Strategy = (typeof STRATEGIES)[number];

/** "*" selects all available skills; an array selects specific skill names. */
const SkillSelector = z.union([z.literal("*"), z.array(z.string().min(1))]);
export type SkillSelector = z.infer<typeof SkillSelector>;

const Defaults = z
  .object({
    strategy: z.enum(STRATEGIES).default("symlink"),
    /** Instruction fragment names (files under content/instructions, without .md). */
    instructions: z.array(z.string().min(1)).default(["applus_base"]),
    skills: SkillSelector.default("*"),
  })
  .strict();
export type Defaults = z.infer<typeof Defaults>;

const Target = z
  .object({
    agent: z.enum(AGENT_IDS),
    /** Agent home directory. Supports a leading ~ for the user home. */
    home: z.string().min(1),
    /** Optional human label to disambiguate multiple homes for one agent. */
    label: z.string().min(1).optional(),
    /** Per-target overrides of the defaults. */
    strategy: z.enum(STRATEGIES).optional(),
    instructions: z.array(z.string().min(1)).optional(),
    skills: SkillSelector.optional(),
    /** When true, this target is parsed but skipped by plan/apply. */
    disabled: z.boolean().optional(),
  })
  .strict();
export type Target = z.infer<typeof Target>;

export const ManifestSchema = z
  .object({
    $schema: z.string().optional(),
    defaults: Defaults.default({}),
    targets: z.array(Target).min(1),
  })
  .strict();

export type Manifest = z.infer<typeof ManifestSchema>;

/** A target with defaults merged in — every field resolved. */
export interface ResolvedTarget {
  agent: AgentId;
  home: string;
  label?: string;
  strategy: Strategy;
  instructions: string[];
  skills: SkillSelector;
  disabled: boolean;
}

export function resolveTargets(manifest: Manifest): ResolvedTarget[] {
  const d = manifest.defaults;
  return manifest.targets.map((t) => ({
    agent: t.agent,
    home: t.home,
    label: t.label,
    strategy: t.strategy ?? d.strategy,
    instructions: t.instructions ?? d.instructions,
    skills: t.skills ?? d.skills,
    disabled: t.disabled ?? false,
  }));
}
