import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { extractLocalSkillDescription } from "../src/core/skill-description.js";
import {
  readSourceManifest,
  writeSourceManifest,
  type SourceManifest,
} from "../src/core/store/source-manifest.js";
import { readSourceMetadata, writeSourceMetadata } from "../src/core/store/source-metadata.js";

const cleanupDirs: string[] = [];

afterEach(async () => {
  for (const dir of cleanupDirs.splice(0, cleanupDirs.length)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("skill description", () => {
  it("extracts description from frontmatter or first paragraph", async () => {
    expect(
      extractLocalSkillDescription(`---
description: Browser automation helper
---
# browser
`),
    ).toBe("Browser automation helper");

    expect(
      extractLocalSkillDescription(`# debugger

Inspect local runtime state safely.
`),
    ).toBe("Inspect local runtime state safely.");
  });
});

describe("source manifest", () => {
  it("writes and reads a manifest with skill entries and descriptions", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-source-manifest-"));
    cleanupDirs.push(base);

    const manifest: SourceManifest = {
      version: 1,
      sourceKind: "git",
      sourceRaw: "git@github.com:obra/superpowers.git",
      sourceCanonical: "github.com/obra/superpowers",
      sourceRevision: "0123456789abcdef0123456789abcdef01234567",
      sourceDisplayName: "superpowers",
      sourceCacheKey: "cache-key-1",
      skills: [
        {
          skillName: "using-superpowers",
          description: "Bootstrap OpenCode superpowers.",
          relativeSkillDir: "using-superpowers",
        },
      ],
    };

    await writeSourceManifest(join(base, "manifest.json"), manifest);
    await expect(readSourceManifest(join(base, "manifest.json"))).resolves.toEqual(manifest);
  });

  it("rejects manifests with malformed skill entries", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-source-manifest-invalid-"));
    cleanupDirs.push(base);

    await writeFile(
      join(base, "manifest.json"),
      `${JSON.stringify({
        version: 1,
        sourceKind: "git",
        sourceRaw: "git@github.com:obra/superpowers.git",
        sourceCanonical: "github.com/obra/superpowers",
        sourceRevision: "0123456789abcdef0123456789abcdef01234567",
        sourceDisplayName: "superpowers",
        sourceCacheKey: "cache-key-1",
        skills: [{ skillName: 123, description: "ok", relativeSkillDir: "using-superpowers" }],
      }, null, 2)}\n`,
      "utf8",
    );

    await expect(readSourceManifest(join(base, "manifest.json"))).resolves.toBeUndefined();
  });

  it("rejects manifests with duplicate or unsafe skill entries", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-source-manifest-duplicate-"));
    cleanupDirs.push(base);

    await writeFile(
      join(base, "manifest.json"),
      `${JSON.stringify({
        version: 1,
        sourceKind: "git",
        sourceRaw: "git@github.com:obra/superpowers.git",
        sourceCanonical: "github.com/obra/superpowers",
        sourceRevision: "0123456789abcdef0123456789abcdef01234567",
        sourceDisplayName: "superpowers",
        sourceCacheKey: "cache-key-1",
        skills: [
          { skillName: "browser", description: "one", relativeSkillDir: "browser" },
          { skillName: "browser", description: "two", relativeSkillDir: "../browser" },
        ],
      }, null, 2)}\n`,
      "utf8",
    );

    await expect(readSourceManifest(join(base, "manifest.json"))).resolves.toBeUndefined();
  });

  it("rejects manifests with traversal-equivalent relative skill directories", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-source-manifest-traversal-"));
    cleanupDirs.push(base);

    await writeFile(
      join(base, "manifest.json"),
      `${JSON.stringify({
        version: 1,
        sourceKind: "git",
        sourceRaw: "git@github.com:obra/superpowers.git",
        sourceCanonical: "github.com/obra/superpowers",
        sourceRevision: "0123456789abcdef0123456789abcdef01234567",
        sourceDisplayName: "superpowers",
        sourceCacheKey: "cache-key-1",
        skills: [
          {
            skillName: "using-superpowers",
            description: "Bootstrap OpenCode superpowers.",
            relativeSkillDir: "using-superpowers/..",
          },
        ],
      }, null, 2)}\n`,
      "utf8",
    );

    await expect(readSourceManifest(join(base, "manifest.json"))).resolves.toBeUndefined();
  });

  it("stores skill-level metadata with description and manifest linkage", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-source-metadata-"));
    cleanupDirs.push(base);

    await writeSourceMetadata(base, {
      version: 2,
      storeEntryKind: "skill",
      bundleName: "superpowers",
      skillName: "using-superpowers",
      description: "Bootstrap OpenCode superpowers.",
      relativeSkillDir: "using-superpowers",
      sourceKind: "git",
      sourceRaw: "git@github.com:obra/superpowers.git",
      sourceCanonical: "github.com/obra/superpowers",
      sourceRevision: "0123456789abcdef0123456789abcdef01234567",
      sourceDisplayName: "superpowers",
      sourceManifestPath: "/tmp/manifest.json",
      sourceCacheKey: "cache-key-1",
    });

    await expect(readSourceMetadata(base)).resolves.toMatchObject({
      version: 2,
      storeEntryKind: "skill",
      bundleName: "superpowers",
      skillName: "using-superpowers",
      description: "Bootstrap OpenCode superpowers.",
      sourceManifestPath: "/tmp/manifest.json",
    });
  });

  it("rejects metadata files with invalid source kinds", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-source-metadata-invalid-kind-"));
    cleanupDirs.push(base);

    await writeFile(
      join(base, ".skill-cli-source.json"),
      `${JSON.stringify({
        version: 2,
        storeEntryKind: "skill",
        skillName: "using-superpowers",
        description: "Bootstrap OpenCode superpowers.",
        relativeSkillDir: "using-superpowers",
        sourceKind: "svn",
        sourceRaw: "git@github.com:obra/superpowers.git",
        sourceCanonical: "github.com/obra/superpowers",
        sourceRevision: "0123456789abcdef0123456789abcdef01234567",
        sourceDisplayName: "superpowers",
        sourceManifestPath: "/tmp/manifest.json",
        sourceCacheKey: "cache-key-1",
      }, null, 2)}\n`,
      "utf8",
    );

    await expect(readSourceMetadata(base)).resolves.toBeUndefined();
  });

  it("rejects metadata files with unsafe paths and requires bundleName in v2", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-source-metadata-invalid-paths-"));
    cleanupDirs.push(base);

    await writeFile(
      join(base, ".skill-cli-source.json"),
      `${JSON.stringify({
        version: 2,
        storeEntryKind: "skill",
        skillName: "using-superpowers",
        description: "Bootstrap OpenCode superpowers.",
        relativeSkillDir: "../using-superpowers",
        sourceKind: "git",
        sourceRaw: "git@github.com:obra/superpowers.git",
        sourceCanonical: "github.com/obra/superpowers",
        sourceRevision: "0123456789abcdef0123456789abcdef01234567",
        sourceDisplayName: "superpowers",
        sourceManifestPath: "",
        sourceCacheKey: "cache-key-1",
      }, null, 2)}\n`,
      "utf8",
    );

    await expect(readSourceMetadata(base)).resolves.toBeUndefined();
  });

  it("rejects metadata files with traversal-equivalent relative skill directories", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-source-metadata-traversal-"));
    cleanupDirs.push(base);

    await writeFile(
      join(base, ".skill-cli-source.json"),
      `${JSON.stringify({
        version: 2,
        storeEntryKind: "skill",
        bundleName: "superpowers",
        skillName: "using-superpowers",
        description: "Bootstrap OpenCode superpowers.",
        relativeSkillDir: "using-superpowers/..",
        sourceKind: "git",
        sourceRaw: "git@github.com:obra/superpowers.git",
        sourceCanonical: "github.com/obra/superpowers",
        sourceRevision: "0123456789abcdef0123456789abcdef01234567",
        sourceDisplayName: "superpowers",
        sourceManifestPath: "/tmp/manifest.json",
        sourceCacheKey: "cache-key-1",
      }, null, 2)}\n`,
      "utf8",
    );

    await expect(readSourceMetadata(base)).resolves.toBeUndefined();
  });

  it("rejects metadata files with malformed or ambiguous manifest paths", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-source-metadata-manifest-path-"));
    cleanupDirs.push(base);

    await writeFile(
      join(base, ".skill-cli-source.json"),
      `${JSON.stringify({
        version: 2,
        storeEntryKind: "skill",
        bundleName: "superpowers",
        skillName: "using-superpowers",
        description: "Bootstrap OpenCode superpowers.",
        relativeSkillDir: "using-superpowers",
        sourceKind: "git",
        sourceRaw: "git@github.com:obra/superpowers.git",
        sourceCanonical: "github.com/obra/superpowers",
        sourceRevision: "0123456789abcdef0123456789abcdef01234567",
        sourceDisplayName: "superpowers",
        sourceManifestPath: "/tmp/skills/../manifest.json",
        sourceCacheKey: "cache-key-1",
      }, null, 2)}\n`,
      "utf8",
    );

    await expect(readSourceMetadata(base)).resolves.toBeUndefined();
  });

  it("stores bundleName in skill-level metadata", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-source-metadata-bundle-name-"));
    cleanupDirs.push(base);

    await writeSourceMetadata(base, {
      version: 2,
      storeEntryKind: "skill",
      bundleName: "superpowers",
      skillName: "using-superpowers",
      description: "Bootstrap OpenCode superpowers.",
      relativeSkillDir: "using-superpowers",
      sourceKind: "git",
      sourceRaw: "git@github.com:obra/superpowers.git",
      sourceCanonical: "github.com/obra/superpowers",
      sourceRevision: "0123456789abcdef0123456789abcdef01234567",
      sourceDisplayName: "superpowers",
      sourceManifestPath: "/tmp/manifest.json",
      sourceCacheKey: "cache-key-1",
    });

    await expect(readSourceMetadata(base)).resolves.toMatchObject({
      version: 2,
      bundleName: "superpowers",
    });
  });
});
