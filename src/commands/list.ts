import { homedir } from "node:os";

import { loadConfig } from "../core/config/load.js";
import { groupScannedSkillsIntoBundles } from "../core/discovery/group-scanned-bundles.js";
import { scanInstalledSkills } from "../core/discovery/scan-installed.js";
import { ExitCode, SkillCliError } from "../core/errors.js";
import { createOutput, type Output } from "../core/output.js";
import { loadRegistry, type RegistryBundleEntry } from "../core/registry/registry.js";

import { resolveScanTargets, resolveStoreRootDir, selectTools } from "./shared.js";

export interface ListCommandArgs {
  tool: string;
  expand?: boolean;
  status?: "all" | "managed" | "discovered";
  dir?: string;
}

export interface ListRuntimeOptions {
  cwd?: string;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  output?: Output;
}

export interface ListCommandResult {
  entries: Array<RegistryBundleEntry & { status: "managed" | "discovered" }>;
}

function normalizeStatusFilter(value: string | undefined): "all" | "managed" | "discovered" {
  const normalized = (value ?? "all").toLowerCase();
  if (normalized === "all" || normalized === "managed" || normalized === "discovered") {
    return normalized;
  }

  throw new SkillCliError(
    `Invalid list status filter: ${value}`,
    ExitCode.USER_INPUT,
    "Use one of: all, managed, discovered",
  );
}

function formatSourceLabel(entry: RegistryBundleEntry & { status: "managed" | "discovered" }): string {
  if (entry.sourceCanonical && entry.sourceCanonical !== "unknown") {
    return entry.sourceCanonical;
  }
  return entry.sourceRaw;
}

export async function runListCommand(
  args: ListCommandArgs,
  runtime: ListRuntimeOptions = {},
): Promise<ListCommandResult> {
  const cwd = runtime.cwd ?? process.cwd();
  const homeDir = runtime.homeDir ?? homedir();
  const env = runtime.env ?? process.env;
  const output = runtime.output ?? createOutput();
  const statusFilter = normalizeStatusFilter(args.status);
  const expand = Boolean(args.expand);

  const config = await loadConfig({ cwd, homeDir, env });
  const selectedTools = selectTools(args.tool, Object.keys(config.tools));
  const storeRootDir = resolveStoreRootDir(config.storeDir, cwd, homeDir);
  const registry = await loadRegistry(storeRootDir);

  const managedEntries = registry.bundles
    .filter((entry) => selectedTools.includes(entry.tool))
    .sort((left, right) => left.tool.localeCompare(right.tool) || left.bundleName.localeCompare(right.bundleName));

  const scanTargets = (
    await Promise.all(
      selectedTools.map(async (toolName) => {
        const toolConfig = config.tools[toolName];
        if (!toolConfig) {
          return [];
        }

        return await resolveScanTargets({
          tool: toolName,
          toolConfig,
          cwd,
          homeDir,
          dir: args.dir,
          registryBundles: managedEntries,
        });
      }),
    )
  ).flat();

  const scannedEntries = await scanInstalledSkills(scanTargets);
  const groupedDiscovered = await groupScannedSkillsIntoBundles(
    scannedEntries.filter((entry) => !entry.isBrokenSymlink),
  );

  const managedByBundleKey = new Map<string, RegistryBundleEntry>();
  for (const entry of managedEntries) {
    managedByBundleKey.set(`${entry.tool}::${entry.targetType}::${entry.targetRoot}::${entry.bundleId}`, entry);
  }

  const discoveredEntries: RegistryBundleEntry[] = [];
  for (const bundle of groupedDiscovered) {
    const key = `${bundle.tool}::${bundle.targetType}::${bundle.targetRoot}::${bundle.bundleId}`;
    if (managedByBundleKey.has(key)) {
      continue;
    }

    discoveredEntries.push({
      bundleId: bundle.bundleId,
      bundleName: bundle.bundleName,
      tool: bundle.tool,
      targetType: bundle.targetType,
      targetRoot: bundle.targetRoot,
      sourceRaw: bundle.sourceRaw,
      sourceKind: bundle.sourceKind,
      sourceCanonical: bundle.sourceCanonical,
      cacheKey: bundle.cacheKey,
      storedSourceDir: bundle.storedSourceDir,
      installedAt: "unknown",
      updatedAt: "unknown",
      members: bundle.members,
    });
  }

  const entries: Array<RegistryBundleEntry & { status: "managed" | "discovered" }> = [
    ...managedEntries.map((entry) => ({ ...entry, status: "managed" as const })),
    ...discoveredEntries.map((entry) => ({ ...entry, status: "discovered" as const })),
  ].sort(
    (left, right) =>
      left.tool.localeCompare(right.tool) ||
      left.bundleName.localeCompare(right.bundleName) ||
      left.targetRoot.localeCompare(right.targetRoot),
  );

  if (entries.length === 0) {
    output.info("No installed bundles found");
    return { entries };
  }

  const filteredEntries =
    statusFilter === "all"
      ? entries
      : entries.filter((entry) => entry.status === statusFilter);

  if (filteredEntries.length === 0) {
    output.info("No bundles found for selected filters");
    return { entries: [] };
  }

  const managedFiltered = filteredEntries.filter((entry) => entry.status === "managed");
  const discoveredFiltered = filteredEntries.filter((entry) => entry.status === "discovered");

  const printSection = (
    title: string,
    sectionEntries: Array<RegistryBundleEntry & { status: "managed" | "discovered" }>,
  ) => {
    if (sectionEntries.length === 0) {
      return;
    }

    output.info(`${title} (${sectionEntries.length})`);
    for (const entry of sectionEntries) {
      output.info(
        `  ${entry.tool}/${entry.bundleName} [${entry.targetType}] members=${entry.members.length}`,
      );
      output.info(`    source: ${formatSourceLabel(entry)}`);
      output.info(`    target: ${entry.targetRoot}`);

      if (expand) {
        for (const member of entry.members) {
          output.info(`      - ${member.skillName} -> ${member.linkPath}`);
        }
      }
    }
  };

  printSection("Managed Bundles", managedFiltered);
  printSection("Discovered Bundles", discoveredFiltered);

  const managedCount = managedFiltered.length;
  const discoveredCount = discoveredFiltered.length;
  const totalMembers = filteredEntries.reduce((count, entry) => count + entry.members.length, 0);
  output.info(
    `Totals: managed=${managedCount} discovered=${discoveredCount} bundles=${filteredEntries.length} members=${totalMembers}`,
  );

  return { entries: filteredEntries };
}
