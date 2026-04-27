import { execFile } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import { promisify } from "node:util";

import { ExitCode, SkillCliError } from "../errors.js";
import { findProjectRoot } from "../project-root.js";

const execFileAsync = promisify(execFile);

export interface LockedSourceBundle {
  sourceKind: "local" | "git" | "npm" | "unknown";
  sourceRaw: string;
  sourceCanonical: string;
  storedSourceDir: string;
}

export interface ResolveLockedSourceForBundleOptions {
  cwd: string;
  bundle: LockedSourceBundle;
}

function invalidBundleError(message: string, cause?: unknown): SkillCliError {
  return new SkillCliError(message, ExitCode.USER_INPUT, undefined, cause);
}

async function resolveNpmSource(bundle: LockedSourceBundle): Promise<string> {
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
  const localPath = options.bundle.sourceCanonical;

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
