import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanTitle, scriptEnv, shellWpScripts } from "./wp-scripts.js";

const SECRETS = {
  STRIPE_SECRET_KEY: "sk_test_secret",
  STRIPE_WEBHOOK_SECRET: "whsec_secret",
  CLOUDFLARE_API_TOKEN: "cf-token",
  POSTGRES_PASSWORD: "pg-secret",
  DATABASE_URL: "postgres://appshelf:pg-secret@postgres:5432/appshelf",
  MARIADB_ROOT_PASSWORD: "root-secret",
  WP_NETWORK_ADMIN_PASSWORD: "network-admin-secret",
  TUNNEL_TOKEN: "tunnel-secret",
  SESSION_SECRET: "session-secret",
};

const WORKER_ENV = {
  ...SECRETS,
  PATH: "/usr/local/bin:/usr/bin:/bin",
  HOME: "/root",
  WORDPRESS_DB_HOST: "mariadb:3306",
  WORDPRESS_DB_NAME: "wordpress",
  WORDPRESS_DB_USER: "wordpress",
  WORDPRESS_DB_PASSWORD: "wp-db-password",
  WP_DOMAIN: "wp.appshelf.localhost",
  WP_PATH: "/var/www/html",
};

describe("scriptEnv", () => {
  it("passes the WordPress settings and nothing secret", () => {
    const env = scriptEnv(WORKER_ENV);
    expect(Object.keys(env).sort()).toEqual(
      [
        "HOME",
        "PATH",
        "WORDPRESS_DB_HOST",
        "WORDPRESS_DB_NAME",
        "WORDPRESS_DB_PASSWORD",
        "WORDPRESS_DB_USER",
        "WP_DOMAIN",
        "WP_PATH",
      ].sort(),
    );
    for (const name of Object.keys(SECRETS)) expect(env).not.toHaveProperty(name);
  });
});

// A stand-in site script records the environment it was started with. Needs a
// POSIX shell, so it runs in the worker image and on Linux/macOS, not on Windows.
describe.skipIf(process.platform === "win32")("site scripts environment", () => {
  let dir = "";
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("starts the scripts without the worker's Stripe, Cloudflare or Postgres secrets", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "appshelf-env-"));
    const script = path.join(dir, "site-archive.sh");
    await writeFile(
      script,
      `#!/bin/sh\nenv > "${dir}/env.txt"\nprintf '%s\\n' '{"blogId":7,"archived":true}'\n`,
    );
    await chmod(script, 0o755);

    await shellWpScripts({ dir, timeoutMs: 10_000, env: scriptEnv(WORKER_ENV) }).archive(7);

    const seen = await readFile(path.join(dir, "env.txt"), "utf8");
    const names = new Set(seen.split("\n").map((line) => line.split("=")[0]));
    expect(names.has("WORDPRESS_DB_PASSWORD")).toBe(true);
    for (const [name, value] of Object.entries(SECRETS)) {
      expect(names.has(name)).toBe(false);
      expect(seen).not.toContain(value);
    }
  });
});

describe("cleanTitle", () => {
  it.each([
    ["Luna Bistro", "Luna Bistro"],
    ["Luna\u0000Bistro", "Luna Bistro"],
    ["  Tab\there\r\nand\u007fdel ", "Tab here and del"],
    ["\u0000\u0001", "fallback-slug"],
    ["Café Đông Ba", "Café Đông Ba"],
  ])("%j -> %j", (input, expected) => {
    expect(cleanTitle(input, "fallback-slug")).toBe(expected);
  });
});
