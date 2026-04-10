import type { ResolvedConfig } from "./schema.js";

export const defaultConfig: ResolvedConfig = {
  storeDir: "~/.skills",
  tools: {
    "claude-code": {
      globalDir: "~/.claude/skills",
      projectDir: ".claude/skills",
      entryPattern: "**/SKILL.md",
      nameStrategy: "parentDir",
    },
    codex: {
      globalDir: "~/.codex/skills",
      projectDir: ".codex/skills",
      entryPattern: "**/SKILL.md",
      nameStrategy: "parentDir",
    },
    opencode: {
      globalDir: "~/.config/opencode/skills",
      projectDir: ".opencode/skills",
      entryPattern: "**/SKILL.md",
      nameStrategy: "parentDir",
    },
  },
};
