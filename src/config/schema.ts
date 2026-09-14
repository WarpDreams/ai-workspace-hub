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
    /** Instruction fragments: names in the instructions root (sans .md) or paths to .md files. */
    instructions: z.array(z.string().min(1)).default(["applus_base"]),
    skills: SkillSelector.default("*"),
    /**
     * MCP servers (files under content/mcp). Default [] — installing servers
     * drives each agent's own `mcp add` CLI and may open browser logins, so
     * opt in explicitly.
     */
    mcp: SkillSelector.default([]),
  })
  .strict();
export type Defaults = z.infer<typeof Defaults>;

const Target = z
  .object({
    agent: z.enum(AGENT_IDS),
    /** Agent home directory. Supports a leading ~ for the user home. */
    home: z.string().min(1),
    /**
     * Optional identifier: shown in output to tell multiple homes of one agent
     * apart, and used by `awh launch <name>`. When absent the agent id serves
     * as the name. Effective names must be unique across targets, so two
     * targets for the same agent need at least one explicit, distinct `name`.
     */
    name: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/, "letters, digits, '_', '.', '-' only; must start with a letter or digit")
      .optional(),
    /**
     * Optional. What `launch` runs instead of the bare agent executable
     * (claude | codex | kiro-cli). A shell-style string ("codex -p bedrock"),
     * or an array of such strings run in order — every entry but the last is
     * a pre-step that must exit 0 (e.g. "aws sso login"), the last is the
     * agent and receives the user's extra args.
     */
    commandline: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
    /** Per-target overrides of the defaults. */
    strategy: z.enum(STRATEGIES).optional(),
    instructions: z.array(z.string().min(1)).optional(),
    skills: SkillSelector.optional(),
    mcp: SkillSelector.optional(),
    /** When true, this target is parsed but skipped by plan/apply. */
    disabled: z.boolean().optional(),
  })
  .strict();
export type Target = z.infer<typeof Target>;

export const ManifestSchema = z
  .object({
    $schema: z.string().optional(),
    /**
     * Directories scanned recursively for content (absolute, ~, or relative to
     * this file's directory). Default ["."]. Later paths override earlier
     * ones on name collisions.
     */
    content_search_paths: z.array(z.string().min(1)).min(1).default(["."]),
    defaults: Defaults.default({}),
    targets: z.array(Target).min(1),
  })
  .strict()
  .superRefine((m, ctx) => {
    // Effective launch name = name ?? agent; must be unique.
    const seen = new Map<string, number>();
    m.targets.forEach((t, i) => {
      const eff = t.name ?? t.agent;
      const prev = seen.get(eff);
      if (prev !== undefined) {
        const how = (x: typeof t) => (x.name === undefined ? `no "name" (defaults to agent "${x.agent}")` : `"name": "${x.name}"`);
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["targets", i],
          message:
            `launch name "${eff}" is ambiguous: targets[${prev}] has ${how(m.targets[prev])} and targets[${i}] has ${how(t)}; ` +
            `give at least one of them a distinct "name"`,
        });
      } else {
        seen.set(eff, i);
      }
    });
  });

export type Manifest = z.infer<typeof ManifestSchema>;

/** A target with defaults merged in — every field resolved. */
export interface ResolvedTarget {
  agent: AgentId;
  home: string;
  name?: string;
  commandline?: string | string[];
  strategy: Strategy;
  instructions: string[];
  skills: SkillSelector;
  mcp: SkillSelector;
  disabled: boolean;
}

export function resolveTargets(manifest: Manifest): ResolvedTarget[] {
  const d = manifest.defaults;
  return manifest.targets.map((t) => ({
    agent: t.agent,
    home: t.home,
    name: t.name,
    commandline: t.commandline,
    strategy: t.strategy ?? d.strategy,
    instructions: t.instructions ?? d.instructions,
    skills: t.skills ?? d.skills,
    mcp: t.mcp ?? d.mcp,
    disabled: t.disabled ?? false,
  }));
}
