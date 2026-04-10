import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { ConfigError } from "../errors.js";
import { findProjectRoot } from "../project-root.js";
import { defaultConfig } from "./defaults.js";
import {
  configOverrideSchema,
  type ConfigOverride,
  resolvedConfigSchema,
  type ResolvedConfig,
  type ToolConfig,
} from "./schema.js";

export interface LoadConfigOptions {
  cwd?: string;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  flags?: ConfigOverride;
}

async function readJsonIfExists(filePath: string): Promise<unknown | undefined> {
  try {
    const raw = await readFile(filePath, "utf8");
    try {
      return JSON.parse(raw) as unknown;
    } catch (error) {
      throw new ConfigError(`Invalid JSON at ${filePath}`, undefined, error);
    }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function cloneResolvedConfig(input: ResolvedConfig): ResolvedConfig {
  return {
    storeDir: input.storeDir,
    tools: Object.fromEntries(
      Object.entries(input.tools).map(([toolName, toolConfig]) => [
        toolName,
        { ...toolConfig },
      ]),
    ),
  };
}

function parseOverride(value: unknown, sourceLabel: string): ConfigOverride {
  const parsed = configOverrideSchema.safeParse(value);
  if (!parsed.success) {
    const issueText = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("; ");
    throw new ConfigError(`Invalid config in ${sourceLabel}: ${issueText}`);
  }

  return parsed.data;
}

function envToOverride(env: NodeJS.ProcessEnv): ConfigOverride {
  const output: ConfigOverride = {};

  if (env.SKILL_CLI_STORE_DIR) {
    output.storeDir = env.SKILL_CLI_STORE_DIR;
  }

  return output;
}

function mergeInto(base: ResolvedConfig, override: ConfigOverride): ResolvedConfig {
  const merged = cloneResolvedConfig(base);

  if (override.storeDir) {
    merged.storeDir = override.storeDir;
  }

  if (override.tools) {
    for (const [toolName, toolOverride] of Object.entries(override.tools)) {
      const existing: ToolConfig = merged.tools[toolName] ?? {
        globalDir: "",
        projectDir: "",
        entryPattern: "",
        nameStrategy: "",
      };

      merged.tools[toolName] = {
        ...existing,
        ...toolOverride,
      };
    }
  }

  return merged;
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<ResolvedConfig> {
  const cwd = options.cwd ?? process.cwd();
  const homeDir = options.homeDir ?? homedir();
  const env = options.env ?? process.env;

  const projectRoot = await findProjectRoot(cwd);
  const globalConfigPath = join(homeDir, ".config", "skill-cli", "config.json");
  const projectConfigPath = join(projectRoot, "skill-cli.config.json");

  const globalConfigRaw = await readJsonIfExists(globalConfigPath);
  const projectConfigRaw = await readJsonIfExists(projectConfigPath);

  const globalOverride: ConfigOverride = globalConfigRaw
    ? parseOverride(globalConfigRaw, globalConfigPath)
    : {};
  const projectOverride: ConfigOverride = projectConfigRaw
    ? parseOverride(projectConfigRaw, projectConfigPath)
    : {};
  const envOverride = parseOverride(envToOverride(env), "environment");
  const flagOverride = parseOverride(options.flags ?? {}, "flags");

  let merged = cloneResolvedConfig(defaultConfig);
  merged = mergeInto(merged, globalOverride);
  merged = mergeInto(merged, projectOverride);
  merged = mergeInto(merged, envOverride);
  merged = mergeInto(merged, flagOverride);

  const validated = resolvedConfigSchema.safeParse(merged);
  if (!validated.success) {
    const issueText = validated.error.issues
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("; ");
    throw new ConfigError(`Invalid config after merge: ${issueText}`);
  }

  return validated.data;
}
