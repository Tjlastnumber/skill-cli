# 更新日志

本项目的所有重要变更都会记录在此文档中。

本文档格式参考 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，
并遵循 [Semantic Versioning](https://semver.org/spec/v2.0.0.html) 版本规范。

## [未发布]

### 新增

- 新增可重复的 `skill prune --dir <path>`，使清理 store 时可以显式保护仍在使用的自定义目录安装。

### 变更

- 不再维护中心化 `registry.json`，改为通过当前 live 软链接扫描结果和项目 `skills-lock.yaml` 推导 `managed` / `discovered` 安装状态。
- 扩展 `doctor`，使其同时检查 live 安装状态、对照 `skills-lock.yaml` 的项目漂移，并显式提示 managed project bundle 的 source provenance 问题。

### 移除

- 移除 `skill register`、`skill relink` 和 `doctor --repair-registry`。
- 移除 install、list、remove、doctor、lock、prune 正常工作流中的中心化 registry 持久化依赖。

### 修复

- 修复两个不同本地 source 目录内容完全相同时会共享 provenance 的问题，确保本地 source 身份保持独立。
- 修复 managed project bundle 仍存在但 source provenance 不可恢复时，`skill lock` 和自动项目锁文件同步会静默清空锁文件的问题。

## [0.5.0] - 2026-04-28

### 新增

- 新增 `skill install <source> --skill <name>`，支持重复传入 `--skill`，并支持 `--skill '*'` 安装某个 source 下发现的全部 skills。
- 对同一个 source、同一个 tool 和 target 再次执行不同 `--skill` 选择时，保留之前已安装的命名 skill，而不是用后一次安装覆盖前一次选择。
- 新增默认项目 `skills-lock.yaml` 自动同步能力：成功执行 `skill install <source> --project` 和 `skill remove <bundle-name> --project` 后自动更新或删除锁文件。

### 变更

- 将 `skills-lock.yaml` 从 bundle 级 v1 结构改为 skill 级 v2 结构，并移除对 v1 的兼容；现有 lockfile 需要通过 `skill lock --force` 重新生成。

### 修复

- 修复以下问题：项目级 `--skill '*'` 全量安装后，如果项目内 skills links 被删除，后续再执行 `skill install --skill <name>` 时，不会再因为 registry 中残留的全量记录而把所有 skill 一起恢复。

## [0.4.0] - 2026-04-27

### 新增

- 新增 `skill lock`，可从当前项目中受管理的 bundle source 生成 `skills-lock.yaml`。
- 新增基于 lockfile 的 `skill install` 安装流程，并在缺少安装范围、工具或自定义目录时提供交互式提示。

### 修复

- 按解析后的 commit 去重 git bundle 安装结果，确保同一仓库版本只存储一次并可在不同 ref 间复用。

## [0.3.1] - 2026-04-24

### 修复

- 修复 GitHub Actions 发布流程，改为使用 `packageManager` 中的 pnpm 版本，避免 workflow 中重复指定 pnpm 版本。

## [0.3.0] - 2026-04-24

### 变更

- 将公开 GitHub 仓库 skills 命令从 `skill browse` 重命名为 `skill search`。

## [0.2.0] - 2026-04-24

### 新增

- 新增 `skill browse <github-repo-url> [--filter <text>]`，可直接浏览公开 GitHub 仓库中的 skills，无需克隆。
- 新增基于 GitHub API 的远程 skill 发现能力，支持默认分支中的仓库根目录 `SKILL.md` 与嵌套 skill 文件。
- 新增从 `SKILL.md` frontmatter 或正文首段提取描述的浏览结果展示能力。

### 修复

- 当 GitHub 递归树 API 返回截断结果时，显式报错而不是返回不完整的 skill 列表。

## [0.1.1] - 2026-04-10

### 新增

- `@tjlastnumber/skill-cli` 首个公开版本发布。
- 提供核心 CLI 命令：`install`、`list`、`remove`、`register`、`doctor`、`relink`、`prune`。
- 支持从本地路径、git 仓库、npm 包安装 skills。
- 支持 `claude-code`、`codex`、`opencode` 三类工具。
- 支持三种安装目标：`--global`、`--project`、`--dir`。
- 提供 bundle 级 skill 管理与成员追踪能力。
- 提供已安装 skill 的注册表回填能力（`register` 与 `doctor --repair-registry`）。
- 提供 bundle/成员查看能力（`list --expand`）与状态过滤（`list --status`）。
- 提供软链接修复能力（`relink`）与 store 清理能力（`prune`）。
- 提供开源项目文档（`README.md`、`README.zh-CN.md`）与 MIT License。
