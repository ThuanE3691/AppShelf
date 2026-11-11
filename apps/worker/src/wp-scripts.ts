// Calls the WordPress site scripts (docs/contracts.md, "WordPress scripts").
// Each prints exactly one JSON line on stdout on success and exits non-zero on
// failure; stderr is log output. stdout carries an admin password, so it is
// never logged.
import { execFile } from "node:child_process";
import path from "node:path";

export interface CreatedSite {
  blogId: number;
  url: string;
  adminUser: string;
  adminPassword: string;
}

export interface WpScripts {
  create(slug: string, title: string, template: string, adminEmail: string): Promise<CreatedSite>;
  archive(blogId: number): Promise<void>;
  unarchive(blogId: number): Promise<void>;
  delete(blogId: number): Promise<void>;
}

export class ScriptError extends Error {
  override name = "ScriptError";
}

const STDERR_TAIL = 1_500;

type Json = Record<string, unknown>;

function lastJsonLine(stdout: string): Json {
  const line = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .at(-1);
  if (!line) throw new ScriptError("script printed no JSON result");
  try {
    const value: unknown = JSON.parse(line);
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Json;
  } catch {
    // fall through
  }
  throw new ScriptError("script result is not a JSON object");
}

function positiveInt(value: unknown, what: string): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  throw new ScriptError(`script result has no valid ${what}`);
}

function nonEmpty(value: unknown, what: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new ScriptError(`script result has no ${what}`);
}

export function parseCreated(stdout: string): CreatedSite {
  const out = lastJsonLine(stdout);
  return {
    blogId: positiveInt(out.blogId, "blogId"),
    url: nonEmpty(out.url, "url"),
    adminUser: nonEmpty(out.adminUser, "adminUser"),
    adminPassword: nonEmpty(out.adminPassword, "adminPassword"),
  };
}

function expectFlag(stdout: string, blogId: number, flag: "archived" | "deleted", value: boolean): void {
  const out = lastJsonLine(stdout);
  if (out.blogId !== blogId || out[flag] !== value) {
    throw new ScriptError(`unexpected script result for blog ${blogId}`);
  }
}

/**
 * The only worker variables a site script sees. wp-cli runs PHP from the shared
 * wp_data volume (wp-config.php, mu-plugins), so the worker's own secrets
 * (Stripe key, Postgres password, anything else in its environment) must
 * never reach it.
 */
const SCRIPT_ENV_NAMES = [
  "PATH",
  "HOME",
  "LANG",
  "TZ",
  "WORDPRESS_DB_HOST",
  "WORDPRESS_DB_NAME",
  "WORDPRESS_DB_USER",
  "WORDPRESS_DB_PASSWORD",
  "WORDPRESS_CONFIG_EXTRA",
  "WP_DOMAIN",
  "WP_PATH",
  "WP_CLI_CACHE_DIR",
] as const;

/** Builds the explicit environment for a site script from the worker's environment. */
export function scriptEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of SCRIPT_ENV_NAMES) {
    const value = source[name];
    if (value !== undefined && value !== "") env[name] = value;
  }
  return env;
}

/**
 * Site titles reach the scripts as argv, and execFile refuses a NUL byte there.
 * The web form already rejects control characters; this keeps an older or
 * hand-made row from failing a paid site: they become spaces.
 */
export function cleanTitle(title: string, fallback: string): string {
  const cleaned = title.replace(/\p{Cc}+/gu, " ").replace(/\s+/g, " ").trim();
  return cleaned || fallback;
}

export interface ShellScriptsOptions {
  dir: string;
  timeoutMs: number;
  /** Receives the script's stderr (logs) after each run. */
  onStderr?: (script: string, stderr: string) => void;
  /** Environment the scripts run with; defaults to scriptEnv() of the worker's environment. */
  env?: NodeJS.ProcessEnv;
}

/** Runs the real scripts with execFile (no shell, so titles cannot inject arguments). */
export function shellWpScripts(options: ShellScriptsOptions): WpScripts {
  const env = options.env ?? scriptEnv();
  const run = (script: string, args: string[]) =>
    new Promise<string>((resolve, reject) => {
      execFile(
        path.posix.join(options.dir, script),
        args,
        { env, timeout: options.timeoutMs, killSignal: "SIGKILL", maxBuffer: 4 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (stderr) options.onStderr?.(script, stderr);
          if (error) {
            const reason = error.killed ? `timed out after ${options.timeoutMs} ms` : `exit ${error.code ?? "?"}`;
            const tail = stderr.trim().slice(-STDERR_TAIL);
            reject(new ScriptError(`${script} failed (${reason})${tail ? `: ${tail}` : ""}`));
            return;
          }
          resolve(stdout);
        },
      );
    });

  return {
    async create(slug, title, template, adminEmail) {
      return parseCreated(await run("site-create.sh", [slug, cleanTitle(title, slug), template, adminEmail]));
    },
    async archive(blogId) {
      expectFlag(await run("site-archive.sh", [String(blogId)]), blogId, "archived", true);
    },
    async unarchive(blogId) {
      expectFlag(await run("site-unarchive.sh", [String(blogId)]), blogId, "archived", false);
    },
    async delete(blogId) {
      expectFlag(await run("site-delete.sh", [String(blogId)]), blogId, "deleted", true);
    },
  };
}
