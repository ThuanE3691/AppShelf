// Worker settings from the environment. Defaults follow docs/contracts.md.

export interface WorkerConfig {
  databaseUrl: string;
  stripeSecretKey: string;
  /** Folder holding the site-*.sh scripts (copied from wordpress/scripts). */
  scriptsDir: string;
  /** Rule 5: poll every 2 s when the queue is empty. */
  pollIntervalMs: number;
  /** Rule 5: run_after = now() + 2^attempts * backoffBaseMs. */
  backoffBaseMs: number;
  /** A job left in `running` longer than this is reclaimed (its worker crashed). */
  lockTimeoutMs: number;
  /** A script is killed after this long; always below lockTimeoutMs. */
  scriptTimeoutMs: number;
  /** Rule 4: expiry pass on start and every 5 minutes. */
  expiryIntervalMs: number;
  /** Jobs run at the same time (each is one wp-cli process). */
  concurrency: number;
}

/**
 * AppShelf is a demo and must never touch live money: anything other than a
 * Stripe test-mode secret key (sk_test_...) stops the worker.
 */
export function assertStripeTestKey(key: string | undefined): string {
  if (!key || !key.startsWith("sk_test_")) {
    throw new Error(
      "Refusing to run: STRIPE_SECRET_KEY must be a Stripe test-mode secret key (sk_test_...). " +
        "AppShelf is a demo and never takes live payments.",
    );
  }
  return key;
}

/** DATABASE_URL, or one built from the generated Postgres password (same rule as the web image). */
export function databaseUrlFromEnv(env: NodeJS.ProcessEnv): string {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  if (!env.POSTGRES_PASSWORD) throw new Error("DATABASE_URL or POSTGRES_PASSWORD must be set");
  const user = encodeURIComponent(env.POSTGRES_USER || "appshelf");
  const pass = encodeURIComponent(env.POSTGRES_PASSWORD);
  const host = env.POSTGRES_HOST || "postgres";
  const port = env.POSTGRES_PORT || "5432";
  const db = env.POSTGRES_DB || "appshelf";
  return `postgres://${user}:${pass}@${host}:${port}/${db}`;
}

function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const config: WorkerConfig = {
    databaseUrl: databaseUrlFromEnv(env),
    stripeSecretKey: assertStripeTestKey(env.STRIPE_SECRET_KEY),
    scriptsDir: env.WP_SCRIPTS_DIR || "/opt/appshelf/wp",
    pollIntervalMs: positiveInt(env, "WORKER_POLL_INTERVAL_MS", 2_000),
    backoffBaseMs: positiveInt(env, "WORKER_BACKOFF_BASE_MS", 5_000),
    lockTimeoutMs: positiveInt(env, "WORKER_LOCK_TIMEOUT_MS", 10 * 60_000),
    scriptTimeoutMs: positiveInt(env, "WORKER_SCRIPT_TIMEOUT_MS", 2 * 60_000),
    expiryIntervalMs: positiveInt(env, "WORKER_EXPIRY_INTERVAL_MS", 5 * 60_000),
    concurrency: positiveInt(env, "WORKER_CONCURRENCY", 2),
  };
  if (config.scriptTimeoutMs >= config.lockTimeoutMs) {
    throw new Error("WORKER_SCRIPT_TIMEOUT_MS must be below WORKER_LOCK_TIMEOUT_MS");
  }
  return config;
}
