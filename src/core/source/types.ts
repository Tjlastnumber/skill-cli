export interface LocalSourceDescriptor {
  kind: "local";
  raw: string;
  path: string;
}

export interface GitSourceDescriptor {
  kind: "git";
  raw: string;
  url: string;
  ref?: string;
}

export interface NpmSourceDescriptor {
  kind: "npm";
  raw: string;
  spec: string;
  packageName: string;
  version?: string;
}

export type SourceDescriptor =
  | LocalSourceDescriptor
  | GitSourceDescriptor
  | NpmSourceDescriptor;
