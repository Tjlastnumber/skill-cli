import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

import { SourceError } from "../errors.js";
import type { SourceDescriptor } from "./types.js";

export interface ParseSourceOptions {
  cwd: string;
  homeDir?: string;
}

function splitRef(input: string): { base: string; ref?: string } {
  const hashIndex = input.indexOf("#");
  if (hashIndex === -1) {
    return { base: input };
  }

  const base = input.slice(0, hashIndex);
  const ref = input.slice(hashIndex + 1);
  return { base, ref: ref || undefined };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isLocalPathHint(value: string): boolean {
  return (
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith("/") ||
    value.startsWith("~/") ||
    value.startsWith("file://") ||
    /^[a-zA-Z]:[\\/]/.test(value)
  );
}

function isGitUrl(value: string): boolean {
  return /^(git@|https?:\/\/|ssh:\/\/|git:\/\/)/.test(value);
}

function isGitHubShorthand(value: string): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:#[^\s]+)?$/.test(value);
}

function parseNpmSpec(raw: string): SourceDescriptor {
  const spec = raw.startsWith("npm:") ? raw.slice(4) : raw;

  if (!spec) {
    throw new SourceError("Invalid npm source: empty package spec");
  }

  let packageName: string;
  let version: string | undefined;

  if (spec.startsWith("@")) {
    const match = spec.match(/^(@[^/]+\/[^@]+)(?:@(.+))?$/);
    if (!match) {
      throw new SourceError(`Invalid npm source: ${raw}`);
    }
    packageName = match[1];
    version = match[2] || undefined;
  } else {
    const atIndex = spec.lastIndexOf("@");
    if (atIndex > 0) {
      packageName = spec.slice(0, atIndex);
      version = spec.slice(atIndex + 1) || undefined;
    } else {
      packageName = spec;
    }
  }

  return {
    kind: "npm",
    raw,
    spec,
    packageName,
    version,
  };
}

function parseGitSource(raw: string): SourceDescriptor {
  const { base, ref } = splitRef(raw);

  if (isGitUrl(base)) {
    return {
      kind: "git",
      raw,
      url: base,
      ref,
    };
  }

  const shorthand = splitRef(raw);
  if (!isGitHubShorthand(raw)) {
    throw new SourceError(`Invalid git source: ${raw}`);
  }

  const repoPart = shorthand.base.endsWith(".git")
    ? shorthand.base.slice(0, -4)
    : shorthand.base;

  return {
    kind: "git",
    raw,
    url: `https://github.com/${repoPart}.git`,
    ref: shorthand.ref,
  };
}

function parseLocalPath(raw: string, cwd: string, homeDir: string): SourceDescriptor {
  if (raw.startsWith("file://")) {
    return {
      kind: "local",
      raw,
      path: new URL(raw).pathname,
    };
  }

  const expanded = raw.startsWith("~/") ? resolve(homeDir, raw.slice(2)) : raw;
  const absolutePath = isAbsolute(expanded) ? expanded : resolve(cwd, expanded);

  return {
    kind: "local",
    raw,
    path: absolutePath,
  };
}

export async function parseSource(
  sourceInput: string,
  options: ParseSourceOptions,
): Promise<SourceDescriptor> {
  const raw = sourceInput.trim();
  if (!raw) {
    throw new SourceError("Source input cannot be empty");
  }

  const cwd = options.cwd;
  const home = options.homeDir ?? homedir();

  if (isLocalPathHint(raw)) {
    return parseLocalPath(raw, cwd, home);
  }

  const existingRelativePath = resolve(cwd, raw);
  if (await pathExists(existingRelativePath)) {
    return {
      kind: "local",
      raw,
      path: existingRelativePath,
    };
  }

  if (isGitUrl(raw) || isGitHubShorthand(raw)) {
    return parseGitSource(raw);
  }

  return parseNpmSpec(raw);
}
