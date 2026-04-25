import { cancel as clackCancel, isCancel as clackIsCancel, select as clackSelect, text as clackText } from "@clack/prompts";

import { ExitCode, SkillCliError } from "../core/errors.js";

import type { InstallTarget, InstallTargetType } from "./types.js";

export interface InstallTargetFlags {
  global?: boolean;
  project?: boolean;
  dir?: string;
}

export interface InstallPromptAdapter {
  select(options: { message: string; options: Array<{ value: string; label: string }> }): Promise<unknown>;
  text(options: { message: string; placeholder?: string }): Promise<unknown>;
  cancel(message: string): void;
  isCancel(value: unknown): boolean;
}

export interface ResolveInstallInputsOptions {
  tool?: string;
  target?: InstallTarget;
  configuredTools: string[];
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  prompt?: InstallPromptAdapter;
}

export interface ResolvedInstallInputs {
  tool: string;
  target: InstallTarget;
}

export interface CancelledInstallInputs {
  cancelled: true;
}

const allToolsValue = "all";
const installTargetTypes = new Set<InstallTargetType>(["global", "project", "dir"]);

const defaultPromptAdapter: InstallPromptAdapter = {
  select: clackSelect,
  text: clackText,
  cancel: clackCancel,
  isCancel: clackIsCancel,
};

export function parseExplicitInstallTargetFlags(options: InstallTargetFlags): InstallTarget | undefined {
  const count = Number(Boolean(options.global)) + Number(Boolean(options.project)) + Number(Boolean(options.dir));

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

  if (options.dir) {
    return { type: "dir", dir: options.dir };
  }

  return undefined;
}

function isInteractive(options: ResolveInstallInputsOptions): boolean {
  return options.stdinIsTTY && options.stdoutIsTTY;
}

function missingInputsError(): SkillCliError {
  return new SkillCliError(
    "Missing install target or tool. Re-run interactively or pass --tool with one of --global, --project, or --dir <path>",
    ExitCode.USER_INPUT,
  );
}

function scopeOptions(): Array<{ value: InstallTargetType; label: string }> {
  return [
    { value: "global", label: "Global" },
    { value: "project", label: "Project" },
    { value: "dir", label: "Custom directory" },
  ];
}

function toolOptions(configuredTools: string[]): Array<{ value: string; label: string }> {
  return [{ value: allToolsValue, label: allToolsValue }, ...configuredTools.map((tool) => ({ value: tool, label: tool }))];
}

function cancelled(prompt: InstallPromptAdapter): CancelledInstallInputs {
  prompt.cancel("Install cancelled.");
  return { cancelled: true };
}

function hasCompleteTarget(target: InstallTarget | undefined): target is InstallTarget {
  if (!target) {
    return false;
  }

  if (target.type === "dir") {
    return Boolean(target.dir);
  }

  return true;
}

function validateTargetType(value: unknown): InstallTargetType {
  if (typeof value === "string" && installTargetTypes.has(value as InstallTargetType)) {
    return value as InstallTargetType;
  }

  throw new SkillCliError("Invalid install scope selected", ExitCode.USER_INPUT);
}

function validateDir(value: unknown): string {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  throw new SkillCliError("Invalid custom directory path entered", ExitCode.USER_INPUT);
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

function validateResolvedTarget(target: InstallTarget | undefined): InstallTarget {
  if (hasCompleteTarget(target)) {
    return target;
  }

  throw missingInputsError();
}

export async function resolveInstallInputs(
  options: ResolveInstallInputsOptions,
): Promise<ResolvedInstallInputs | CancelledInstallInputs> {
  const prompt = options.prompt ?? defaultPromptAdapter;
  let target = options.target;
  let tool = options.tool;
  const needsCustomDirPrompt = target?.type === "dir" && !target.dir;

  if (hasCompleteTarget(target) && tool) {
    return { target, tool };
  }

  if (!isInteractive(options)) {
    throw missingInputsError();
  }

  if (!hasCompleteTarget(target)) {
    if (needsCustomDirPrompt) {
      const dir = await prompt.text({
        message: "Enter custom directory path",
        placeholder: "./skills",
      });

      if (prompt.isCancel(dir)) {
        return cancelled(prompt);
      }

      target = { type: "dir", dir: validateDir(dir) };
    } else {
      const selectedScope = await prompt.select({
        message: "Select install scope",
        options: scopeOptions(),
      });

      if (prompt.isCancel(selectedScope)) {
        return cancelled(prompt);
      }

      const targetType = validateTargetType(selectedScope);

      if (targetType === "dir") {
        const dir = await prompt.text({
          message: "Enter custom directory path",
          placeholder: "./skills",
        });

        if (prompt.isCancel(dir)) {
          return cancelled(prompt);
        }

        target = { type: "dir", dir: validateDir(dir) };
      } else {
        target = { type: targetType };
      }
    }
  }

  if (!tool) {
    const selectedTool = await prompt.select({
      message: "Select tool",
      options: toolOptions(options.configuredTools),
    });

    if (prompt.isCancel(selectedTool)) {
      return cancelled(prompt);
    }

    tool = validateTool(selectedTool, options.configuredTools);
  }

  return {
    target: validateResolvedTarget(target),
    tool,
  };
}
