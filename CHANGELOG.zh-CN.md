# 更新日志

本项目的所有重要变更都会记录在此文档中。

本文档格式参考 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，
并遵循 [Semantic Versioning](https://semver.org/spec/v2.0.0.html) 版本规范。

## [未发布]

### 新增

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
