import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { describeGitRepository } from "../source/git-repo.js";
import type { SourceDescriptor } from "../source/types.js";
import { readSourceMetadata } from "../store/source-metadata.js";

export type BundleSourceKind = "local" | "git" | "npm" | "unknown";

export interface BundleIdentity {
  bundleName: string;
  sourceKind: BundleSourceKind;
  sourceRaw: string;
  sourceCanonical: string;
}

function normalizeGitSource(rawInput: string): { canonical: string; bundleName: string } | undefined {
  try {
    return describeGitRepository(rawInput);
  } catch {
    return undefined;
  }
}

function normalizeNpmSource(spec: string): { canonical: string; bundleName: string } {
  const normalized = spec.startsWith("npm:") ? spec.slice(4) : spec;

  if (normalized.startsWith("@")) {
    const match = normalized.match(/^(@[^/]+\/[^@]+)(?:@(.+))?$/);
    if (match) {
      const packageName = match[1];
      const version = match[2];
      return {
        canonical: version ? `${packageName}@${version}` : packageName,
        bundleName: packageName.split("/")[1] || packageName,
      };
    }
  }

  const atIndex = normalized.lastIndexOf("@");
  if (atIndex > 0) {
    const packageName = normalized.slice(0, atIndex);
    const version = normalized.slice(atIndex + 1);
    return {
      canonical: `${packageName}@${version}`,
      bundleName: packageName.split("/")[packageName.split("/").length - 1] || packageName,
    };
  }

  const parts = normalized.split("/");
  return {
    canonical: normalized,
    bundleName: parts[parts.length - 1] || normalized,
  };
}

export function deriveBundleIdentityFromSourceDescriptor(source: SourceDescriptor): BundleIdentity {
  if (source.kind === "local") {
    return {
      bundleName: basename(source.path),
      sourceKind: "local",
      sourceRaw: source.raw,
      sourceCanonical: source.path,
    };
  }

  if (source.kind === "git") {
    const normalized = normalizeGitSource(source.url) ?? normalizeGitSource(source.raw);

    return {
      bundleName: normalized?.bundleName ?? "git-bundle",
      sourceKind: "git",
      sourceRaw: source.raw,
      sourceCanonical: normalized?.canonical ?? source.url,
    };
  }

  const normalizedNpm = normalizeNpmSource(source.spec);
  return {
    bundleName: normalizedNpm.bundleName,
    sourceKind: "npm",
    sourceRaw: source.raw,
    sourceCanonical: normalizedNpm.canonical,
  };
}

export async function inferBundleIdentityFromStoredSource(options: {
  storedSourceDir: string;
  fallback: BundleIdentity;
}): Promise<BundleIdentity> {
  const metadata = await readSourceMetadata(options.storedSourceDir);
  if (metadata) {
    return {
      bundleName: metadata.bundleName,
      sourceKind: metadata.sourceKind,
      sourceRaw: metadata.sourceRaw,
      sourceCanonical: metadata.sourceCanonical,
    };
  }

  try {
    const gitConfig = await readFile(`${options.storedSourceDir}/.git/config`, "utf8");
    const match = gitConfig.match(/^\s*url\s*=\s*(.+)$/m);
    if (match?.[1]) {
      const normalized = normalizeGitSource(match[1].trim());
      if (normalized) {
        return {
          bundleName: normalized.bundleName,
          sourceKind: "git",
          sourceRaw: match[1].trim(),
          sourceCanonical: normalized.canonical,
        };
      }
    }
  } catch {
    // ignore
  }

  try {
    const packageJsonRaw = await readFile(`${options.storedSourceDir}/package.json`, "utf8");
    const parsed = JSON.parse(packageJsonRaw) as { name?: string };
    if (parsed.name) {
      const normalized = normalizeNpmSource(parsed.name);
      return {
        bundleName: normalized.bundleName,
        sourceKind: "npm",
        sourceRaw: parsed.name,
        sourceCanonical: normalized.canonical,
      };
    }
  } catch {
    // ignore
  }

  return options.fallback;
}
