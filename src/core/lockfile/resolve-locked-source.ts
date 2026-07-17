import { execFile } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import { promisify } from "node:util";

import { ExitCode, SkillCliError } from "../errors.js";
import { findProjectRoot } from "../project-root.js";
import { readSourceManifest } from "../store/source-manifest.js";
import { readSourceMetadata } from "../store/source-metadata.js";

const execFileAsync = promisify(execFile);

export interface LockedSourceBundle {
  sourceKind: "local" | "git" | "npm" | "unknown";
  sourceRaw: string;
  sourceCanonical: string;
  storedSourceDir: string;
  members?: Array<{
    sourceSkillDir?: string;
  }>;
}

export interface ResolveLockedSourceForBundleOptions {
  cwd: string;
  bundle: LockedSourceBundle;
}

function invalidBundleError(message: string, cause?: unknown): SkillCliError {
  return new SkillCliError(message, ExitCode.USER_INPUT, undefined, cause);
}

function usesManifestBackedLogicalSourceGroup(bundle: {
  storedSourceDir: string;
  members?: Array<{ sourceSkillDir?: string }>;
}): boolean {
  return (bundle.members ?? []).some((member) => {
    if (!member.sourceSkillDir) {
      return false;
    }

    return member.sourceSkillDir === bundle.storedSourceDir || !member.sourceSkillDir.startsWith(`${bundle.storedSourceDir}/`);
  });
}

async function readBundleManifest(bundle: LockedSourceBundle) {
  const usesLogicalSourceGroup = usesManifestBackedLogicalSourceGroup(bundle);

  const memberDirs = new Set<string>();

  for (const member of bundle.members ?? []) {
    if (member.sourceSkillDir) {
      memberDirs.add(member.sourceSkillDir);
    }
  }

  for (const memberDir of memberDirs) {
    const metadata = await readSourceMetadata(memberDir);
    if (!metadata || metadata.version !== 2) {
      continue;
    }

    const manifest = await readSourceManifest(metadata.sourceManifestPath);
    if (!manifest) {
      throw invalidBundleError(
        `Invalid ${bundle.sourceKind} bundle: failed to read source manifest for ${memberDir}`,
      );
    }

    return { metadata, manifest };
  }

  if (usesLogicalSourceGroup) {
    throw invalidBundleError(
      `Invalid ${bundle.sourceKind} bundle: missing source provenance for ${bundle.storedSourceDir}`,
    );
  }

  return undefined;
}

async function resolveNpmSource(bundle: LockedSourceBundle): Promise<string> {
  const manifestState = await readBundleManifest(bundle);
  if (manifestState) {
    return `${manifestState.manifest.sourceCanonical}@${manifestState.manifest.sourceRevision}`;
  }

  const packageJsonPath = `${bundle.storedSourceDir}/package.json`;
  const raw = await readFile(packageJsonPath, "utf8").catch((error) => {
    throw invalidBundleError(`Invalid npm bundle: failed to read ${packageJsonPath}`, error);
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw invalidBundleError(`Invalid npm bundle: failed to parse ${packageJsonPath}`, error);
  }

  const packageJson = parsed as { name?: unknown; version?: unknown };
  if (typeof packageJson.name !== "string" || !packageJson.name) {
    throw invalidBundleError(`Invalid npm bundle: missing package name in ${packageJsonPath}`);
  }

  if (typeof packageJson.version !== "string" || !packageJson.version) {
    throw invalidBundleError(`Invalid npm bundle: missing package version in ${packageJsonPath}`);
  }

  return `${packageJson.name}@${packageJson.version}`;
}

async function resolveGitSource(bundle: LockedSourceBundle): Promise<string> {
  const manifestState = await readBundleManifest(bundle);
  if (manifestState) {
    const baseSource = manifestState.manifest.sourceRaw.split("#")[0] || manifestState.manifest.sourceRaw;
    const sha = manifestState.metadata.sourceCommitSha ?? manifestState.manifest.sourceRevision;
    return `${baseSource}#${sha}`;
  }

  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: bundle.storedSourceDir,
  }).catch((error) => {
    throw invalidBundleError(`Invalid git bundle: failed to resolve HEAD for ${bundle.storedSourceDir}`, error);
  });

  const sha = stdout.trim();
  if (!sha) {
    throw invalidBundleError(`Invalid git bundle: empty HEAD for ${bundle.storedSourceDir}`);
  }

  const baseSource = bundle.sourceRaw.split("#")[0] || bundle.sourceRaw;
  return `${baseSource}#${sha}`;
}

async function resolveLocalSource(options: ResolveLockedSourceForBundleOptions): Promise<string> {
  const projectRoot = await findProjectRoot(options.cwd);
  const manifestState = await readBundleManifest(options.bundle);
  const localPath = manifestState?.manifest.sourceCanonical ?? options.bundle.sourceCanonical;

  if (!localPath || !isAbsolute(localPath)) {
    throw invalidBundleError(`Invalid local bundle: expected absolute path, got ${options.bundle.sourceCanonical}`);
  }

  const [realProjectRoot, realLocalPath] = await Promise.all([
    realpath(projectRoot).catch((error) => {
      throw invalidBundleError(`Invalid local bundle: failed to resolve project root ${projectRoot}`, error);
    }),
    realpath(localPath).catch((error) => {
      throw invalidBundleError(`Invalid local bundle: failed to resolve ${localPath}`, error);
    }),
  ]);

  const realRelativePath = relative(realProjectRoot, realLocalPath).replace(/\\/g, "/");
  if (realRelativePath === ".." || realRelativePath.startsWith("../") || isAbsolute(realRelativePath)) {
    throw invalidBundleError(
      `Local bundle source must stay inside the project root: ${localPath}`,
    );
  }

  const relativePath = relative(projectRoot, localPath);
  if (relativePath === "") {
    return "./";
  }

  const normalizedRelativePath = relativePath.replace(/\\/g, "/");

  if (
    normalizedRelativePath === ".." ||
    normalizedRelativePath.startsWith("../") ||
    isAbsolute(relativePath)
  ) {
    throw invalidBundleError(
      `Local bundle source must stay inside the project root: ${localPath}`,
    );
  }

  return normalizedRelativePath.startsWith("./") ? normalizedRelativePath : `./${normalizedRelativePath}`;
}

export async function resolveLockedSourceForBundle(
  options: ResolveLockedSourceForBundleOptions,
): Promise<string> {
  const { bundle } = options;

  if (bundle.sourceKind === "npm") {
    return resolveNpmSource(bundle);
  }

  if (bundle.sourceKind === "git") {
    return resolveGitSource(bundle);
  }

  if (bundle.sourceKind === "local") {
    return resolveLocalSource(options);
  }

  throw invalidBundleError(`Unsupported bundle source kind: ${bundle.sourceKind}`);
}
