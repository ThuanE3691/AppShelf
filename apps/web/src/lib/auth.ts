import { createHash, randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { getDb, sessions, users, type Database, type User } from "@appshelf/db";
import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { cache } from "react";
import { appUrl } from "./config";

export const SESSION_COOKIE = "appshelf_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// argon2id with the OWASP-recommended baseline (19 MiB, 2 passes).
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string) => hash(password, ARGON2_OPTIONS);

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// Verified when an email is unknown so both paths take about the same time.
let dummyHash: Promise<string> | undefined;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword("appshelf-timing-equaliser");
  await verifyPassword(await dummyHash, password);
}

export const normaliseEmail = (email: string) => email.trim().toLowerCase();

/** Only the SHA-256 of the cookie token is stored, so a leaked table cannot be replayed. */
export const hashSessionToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSessionRecord(userId: string, db: Database = getDb()) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({ userId, tokenHash: hashSessionToken(token), expiresAt });
  return { token, expiresAt };
}

export async function findUserBySessionToken(token: string, db: Database = getDb()): Promise<User | null> {
  const [row] = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashSessionToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return row?.user ?? null;
}

export async function deleteSessionRecord(token: string, db: Database = getDb()) {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashSessionToken(token)));
}

/** Starts a session for the user and sets the httpOnly cookie (server actions only). */
export async function signIn(userId: string) {
  const { token, expiresAt } = await createSessionRecord(userId);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: appUrl().startsWith("https://"),
    path: "/",
    expires: expiresAt,
  });
}

export async function signOut() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await deleteSessionRecord(token);
  jar.delete(SESSION_COOKIE);
}

/** The signed-in user for this request, or null. */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return findUserBySessionToken(token);
});

// Browsers drop tab/CR/LF and read "\" as "/" while parsing a URL, so "/\t/evil.example"
// or "/\evil.example" become "//evil.example". Refuse those characters, raw or
// percent-encoded, and encoded slashes too.
const UNSAFE_PATH_CHARS = /[\u0000-\u001f\u007f\\]|%(?:[01][0-9a-f]|7f|2f|5c)/i;

/** Keeps redirects on this site: only a same-origin path (with query and hash) is returned. */
export function safeNextPath(value: unknown, fallback = "/dashboard"): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return fallback;
  if (UNSAFE_PATH_CHARS.test(value)) return fallback;
  let base: URL;
  let target: URL;
  try {
    base = new URL(appUrl());
    target = new URL(value, base);
  } catch {
    return fallback;
  }
  if (target.origin !== base.origin) return fallback;
  return `${target.pathname}${target.search}${target.hash}`;
}
