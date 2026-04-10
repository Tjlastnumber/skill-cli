export interface Output {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

export function createOutput(): Output {
  return {
    info: (message) => {
      process.stdout.write(`${message}\n`);
    },
    warn: (message) => {
      process.stderr.write(`WARN: ${message}\n`);
    },
    error: (message) => {
      process.stderr.write(`ERROR: ${message}\n`);
    },
  };
}
