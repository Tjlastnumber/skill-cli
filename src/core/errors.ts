export enum ExitCode {
  OK = 0,
  INTERNAL = 1,
  USER_INPUT = 2,
  CONFIG = 3,
  SOURCE = 4,
  FILESYSTEM = 5,
}

export class SkillCliError extends Error {
  readonly exitCode: ExitCode;
  readonly suggestion?: string;

  constructor(message: string, exitCode: ExitCode, suggestion?: string, cause?: unknown) {
    super(message, cause ? { cause } : undefined);
    this.name = "SkillCliError";
    this.exitCode = exitCode;
    this.suggestion = suggestion;
  }
}

export class ConfigError extends SkillCliError {
  constructor(message: string, suggestion?: string, cause?: unknown) {
    super(message, ExitCode.CONFIG, suggestion, cause);
    this.name = "ConfigError";
  }
}

export class SourceError extends SkillCliError {
  constructor(message: string, suggestion?: string, cause?: unknown) {
    super(message, ExitCode.SOURCE, suggestion, cause);
    this.name = "SourceError";
  }
}

export class FilesystemError extends SkillCliError {
  constructor(message: string, suggestion?: string, cause?: unknown) {
    super(message, ExitCode.FILESYSTEM, suggestion, cause);
    this.name = "FilesystemError";
  }
}
