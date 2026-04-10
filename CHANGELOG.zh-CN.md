# 更新日志

本项目的所有重要变更都会记录在此文档中。

本文档格式参考 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，
并遵循 [Semantic Versioning](https://semver.org/spec/v2.0.0.html) 版本规范。

## [未发布]

### 新增

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
