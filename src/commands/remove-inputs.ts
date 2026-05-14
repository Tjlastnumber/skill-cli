import { cancel as clackCancel, isCancel as clackIsCancel, select as clackSelect } from "@clack/prompts";

import { loadConfig } from "../core/config/load.js";
import { scanLiveBundles } from "../core/discovery/scan-live-bundles.js";
import { ExitCode, SkillCliError } from "../core/errors.js";
import { createOutput, type Output } from "../core/output.js";

import { resolveTargetRoot, selectTools } from "./shared.js";
import type { InstallTarget } from "./types.js";

export interface RemoveTargetFlags {
  global?: boolean;
  project?: boolean;
  dir?: string;
}

export interface RemovePromptAdapter {
  select(options: { message: string; options: Array<{ value: string; label: string }> }): Promise<unknown>;
  cancel(message: string): void;
  isCancel(value: unknown): boolean;
}

export interface ResolveRemoveInputsOptions {
  bundleName?: string;
  skillName?: string;
  tool?: string;
  target?: InstallTarget;
  configuredTools: string[];
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  cwd?: string;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  output?: Output;
  prompt?: RemovePromptAdapter;
  findMatchingTools?: (options: { bundleName?: string; skillName?: string; target: InstallTarget }) => Promise<string[]>;
  findSkillCandidates?: (options: {
    skillName: string;
    tool: string;
    target: InstallTarget;
  }) => Promise<RemoveSkillCandidate[]>;
}

export interface RemoveSkillCandidate {
  tool: string;
  bundleName: string;
  skillName: string;
  target: InstallTarget;
  targetRoot: string;
  linkPath: string;
}

export interface ResolvedRemoveInputs {
  bundleName?: string;
  skillName?: string;
  selectedSkill?: RemoveSkillCandidate;
  tool: string;
  target: InstallTarget;
}

export interface CancelledRemoveInputs {
  cancelled: true;
}

const allToolsValue = "all";

const defaultPromptAdapter: RemovePromptAdapter = {
  select: clackSelect,
  cancel: clackCancel,
  isCancel: clackIsCancel,
};

export function parseExplicitRemoveTargetFlags(options: RemoveTargetFlags): InstallTarget | undefined {
  const hasExplicitDir = Object.prototype.hasOwnProperty.call(options, "dir");
  const count = Number(Boolean(options.global)) + Number(Boolean(options.project)) + Number(hasExplicitDir);

  if (count > 1) {
    throw new SkillCliError(
      "Exactly one target may be specified: --global, --project, or --dir <path>",
      ExitCode.USER_INPUT,
    );
  }

  if (options.global) {
    return { type: "global" };
  }

  if (options.project) {
    return { type: "project" };
  }

  if (hasExplicitDir) {
    if (typeof options.dir !== "string" || options.dir.length === 0) {
      throw new SkillCliError("Invalid custom directory path entered", ExitCode.USER_INPUT);
    }

    return { type: "dir", dir: options.dir };
  }

  return undefined;
}

function isInteractive(options: ResolveRemoveInputsOptions): boolean {
  return options.stdinIsTTY && options.stdoutIsTTY;
}

function validateTool(value: unknown, configuredTools: string[]): string {
  if (value === allToolsValue) {
    return value;
  }

  if (typeof value === "string" && configuredTools.includes(value)) {
    return value;
  }

  throw new SkillCliError("Invalid tool selected", ExitCode.USER_INPUT);
}

function cancelled(prompt: RemovePromptAdapter): CancelledRemoveInputs {
  prompt.cancel("Remove cancelled.");
  return { cancelled: true };
}

function validateMode(bundleName?: string, skillName?: string): void {
  if ((bundleName && skillName) || (!bundleName && !skillName)) {
    throw new SkillCliError(
      "Exactly one of bundle-name or --skill must be provided",
      ExitCode.USER_INPUT,
    );
  }
}

async function defaultFindMatchingTools(
  options: ResolveRemoveInputsOptions,
  target: InstallTarget,
): Promise<string[]> {
  const cwd = options.cwd ?? process.cwd();
  const homeDir = options.homeDir;
  const env = options.env ?? process.env;
  const config = await loadConfig({ cwd, homeDir, env });
  const matches = new Set<string>();

  for (const toolName of selectTools(allToolsValue, options.configuredTools)) {
    const toolConfig = config.tools[toolName];
    if (!toolConfig) {
      continue;
    }

    const targetRoot = await resolveTargetRoot({
      target,
      toolConfig,
      cwd,
      homeDir,
    });
    const live = await scanLiveBundles([
      {
        tool: toolName,
        targetType: target.type,
        targetRoot,
        entryPattern: toolConfig.entryPattern,
      },
    ]);

    const hasMatch = live.managedBundles.some((bundle) => {
      if (
        bundle.tool !== toolName ||
        bundle.targetType !== target.type ||
        bundle.targetRoot !== targetRoot
      ) {
        return false;
      }

      if (options.bundleName) {
        return bundle.bundleName === options.bundleName;
      }

      return bundle.members.some((member) => member.skillName === options.skillName);
    });

    if (hasMatch) {
      matches.add(toolName);
    }
  }

  return Array.from(matches).sort((left, right) => left.localeCompare(right));
}

async function defaultFindSkillCandidates(
  options: ResolveRemoveInputsOptions,
  params: { skillName: string; tool: string; target: InstallTarget },
): Promise<RemoveSkillCandidate[]> {
  const cwd = options.cwd ?? process.cwd();
  const homeDir = options.homeDir;
  const env = options.env ?? process.env;
  const config = await loadConfig({ cwd, homeDir, env });
  const selectedTools = selectTools(params.tool, options.configuredTools);
  const candidates: RemoveSkillCandidate[] = [];

  for (const toolName of selectedTools) {
    const toolConfig = config.tools[toolName];
    if (!toolConfig) {
      continue;
    }

    const targetRoot = await resolveTargetRoot({
      target: params.target,
      toolConfig,
      cwd,
      homeDir,
    });
    const live = await scanLiveBundles([
      {
        tool: toolName,
        targetType: params.target.type,
        targetRoot,
        entryPattern: toolConfig.entryPattern,
      },
    ]);

    for (const bundle of live.managedBundles) {
      if (
        bundle.tool !== toolName ||
        bundle.targetType !== params.target.type ||
        bundle.targetRoot !== targetRoot
      ) {
        continue;
      }

      for (const member of bundle.members) {
        if (member.skillName !== params.skillName) {
          continue;
        }

        candidates.push({
          tool: toolName,
          bundleName: bundle.bundleName,
          skillName: member.skillName,
          target: params.target,
          targetRoot,
          linkPath: member.linkPath,
        });
      }
    }
  }

  return candidates.sort(
    (left, right) =>
      left.tool.localeCompare(right.tool) ||
      left.bundleName.localeCompare(right.bundleName) ||
      left.targetRoot.localeCompare(right.targetRoot) ||
      left.linkPath.localeCompare(right.linkPath),
  );
}

function createCandidateValue(candidate: RemoveSkillCandidate): string {
  return `${candidate.tool}::${candidate.targetRoot}::${candidate.bundleName}::${candidate.skillName}`;
}

function printSkillCandidates(output: Output, candidates: RemoveSkillCandidate[]): void {
  output.info(`Matching installed skills: ${candidates.length}`);

  for (const [index, candidate] of candidates.entries()) {
    if (index > 0) {
      output.info("");
    }

    output.info(`  ${candidate.skillName}`);
    output.info(`    bundle: ${candidate.bundleName}`);
    output.info(`    tool: ${candidate.tool}`);
    output.info(`    target: ${candidate.targetRoot}`);
  }
}

export async function resolveRemoveInputs(
  options: ResolveRemoveInputsOptions,
): Promise<ResolvedRemoveInputs | CancelledRemoveInputs> {
  validateMode(options.bundleName, options.skillName);

  if (options.configuredTools.length === 0) {
    throw new SkillCliError("No configured tools available for remove", ExitCode.USER_INPUT);
  }

  const target = options.target ?? { type: "project" };
  const output = options.output ?? createOutput();
  const finder = options.findMatchingTools ?? ((findOptions) => defaultFindMatchingTools(options, findOptions.target));

  const resolveSelectedSkill = async (tool: string): Promise<RemoveSkillCandidate | undefined> => {
    if (!options.skillName) {
      return undefined;
    }

    const findSkillCandidates =
      options.findSkillCandidates ?? ((params) => defaultFindSkillCandidates(options, params));
    const candidates = await findSkillCandidates({
      skillName: options.skillName,
      tool,
      target,
    });

    if (candidates.length === 0) {
      throw new SkillCliError(
        `No matching installed tool found in ${target.type} scope`,
        ExitCode.USER_INPUT,
      );
    }

    if (candidates.length === 1) {
      return candidates[0];
    }

    printSkillCandidates(output, candidates);

    if (!isInteractive(options)) {
      throw new SkillCliError(
        "Multiple matching installed skills found. Re-run interactively or pass a narrower target",
        ExitCode.USER_INPUT,
      );
    }

    const prompt = options.prompt ?? defaultPromptAdapter;
    const selectedValue = await prompt.select({
      message: "Select skill",
      options: candidates.map((candidate) => ({
        value: createCandidateValue(candidate),
        label: `${candidate.skillName} (${candidate.bundleName} -> ${candidate.targetRoot})`,
      })),
    });

    if (prompt.isCancel(selectedValue)) {
      return undefined;
    }

    const selected = candidates.find((candidate) => createCandidateValue(candidate) === selectedValue);
    if (!selected) {
      throw new SkillCliError("Invalid skill selected", ExitCode.USER_INPUT);
    }

    return selected;
  };

  if (options.tool) {
    const tool = validateTool(options.tool, options.configuredTools);
    if (options.bundleName) {
      const matchingTools = await finder({
        bundleName: options.bundleName,
        skillName: options.skillName,
        target,
      });

      if (!matchingTools.includes(tool)) {
        throw new SkillCliError(
          `No matching installed tool found in ${target.type} scope`,
          ExitCode.USER_INPUT,
        );
      }
    }

    const selectedSkill = await resolveSelectedSkill(tool);
    if (options.skillName && selectedSkill === undefined) {
      return cancelled(options.prompt ?? defaultPromptAdapter);
    }

    return {
      bundleName: options.bundleName,
      skillName: options.skillName,
      selectedSkill,
      tool,
      target,
    };
  }

  const prompt = options.prompt ?? defaultPromptAdapter;
  const matchingTools = await finder({
    bundleName: options.bundleName,
    skillName: options.skillName,
    target,
  });

  if (matchingTools.length === 0) {
    throw new SkillCliError(
      `No matching installed tool found in ${target.type} scope`,
      ExitCode.USER_INPUT,
    );
  }

  if (matchingTools.length === 1) {
    const selectedSkill = await resolveSelectedSkill(matchingTools[0] as string);
    if (options.skillName && selectedSkill === undefined) {
      return cancelled(prompt);
    }

    return {
      bundleName: options.bundleName,
      skillName: options.skillName,
      selectedSkill,
      tool: matchingTools[0] as string,
      target,
    };
  }

  if (!isInteractive(options)) {
    throw new SkillCliError(
      "Multiple matching tools found. Re-run interactively or pass --tool",
      ExitCode.USER_INPUT,
    );
  }

  const selectedTool = await prompt.select({
    message: "Select tool",
    options: matchingTools.map((tool) => ({ value: tool, label: tool })),
  });

  if (prompt.isCancel(selectedTool)) {
    return cancelled(prompt);
  }

  const tool = validateTool(selectedTool, matchingTools);
  const selectedSkill = await resolveSelectedSkill(tool);
  if (options.skillName && selectedSkill === undefined) {
    return cancelled(prompt);
  }

  return {
    bundleName: options.bundleName,
    skillName: options.skillName,
    selectedSkill,
    tool,
    target,
  };
}
