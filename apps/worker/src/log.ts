// One JSON line per event on stdout (errors on stderr). Never pass credentials in fields.

type Level = "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

export interface Logger {
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

function write(level: Level, msg: string, fields: LogFields = {}): void {
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields });
  if (level === "error") console.error(line);
  else console.log(line);
}

export const consoleLogger: Logger = {
  info: (msg, fields) => write("info", msg, fields),
  warn: (msg, fields) => write("warn", msg, fields),
  error: (msg, fields) => write("error", msg, fields),
};

export const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
