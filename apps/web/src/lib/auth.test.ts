import { getDb, sessions, users } from "@appshelf/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withCleanDatabase } from "@/test/fixtures";
import {
  createSessionRecord,
  deleteSessionRecord,
  findUserBySessionToken,
  hashPassword,
  hashSessionToken,
  safeNextPath,
  verifyPassword,
} from "./auth";

withCleanDatabase();

describe("passwords", () => {
  it("hashes with argon2id and verifies", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(hash, "correct horse battery")).toBe(true);
    expect(await verifyPassword(hash, "wrong")).toBe(false);
    expect(await verifyPassword("not-a-hash", "x")).toBe(false);
  });
});

describe("sessions", () => {
  it("stores only the token hash and resolves the user until deleted", async () => {
    const db = getDb();
    const [user] = await db.insert(users).values({ email: "a@example.com", passwordHash: "x" }).returning();
    const { token } = await createSessionRecord(user!.id);

    const [row] = await db.select().from(sessions).where(eq(sessions.userId, user!.id));
    expect(row!.tokenHash).toBe(hashSessionToken(token));
    expect(row!.tokenHash).not.toContain(token);
    expect((await findUserBySessionToken(token))?.id).toBe(user!.id);

    await deleteSessionRecord(token);
    expect(await findUserBySessionToken(token)).toBeNull();
  });

  it("ignores expired sessions", async () => {
    const db = getDb();
    const [user] = await db.insert(users).values({ email: "b@example.com", passwordHash: "x" }).returning();
    const { token } = await createSessionRecord(user!.id);
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) });
    expect(await findUserBySessionToken(token)).toBeNull();
  });

  it("rejects upper-case emails at the database level", async () => {
    await expect(getDb().insert(users).values({ email: "Upper@Example.com", passwordHash: "x" })).rejects.toThrow();
  });
});

describe("safeNextPath", () => {
  it.each([
    ["/dashboard", "/dashboard"],
    ["/sites/new?template=agency", "/sites/new?template=agency"],
    ["/dashboard?plan=cancelled#site-1", "/dashboard?plan=cancelled#site-1"],
    ["/sites/new?title=Caf%C3%A9", "/sites/new?title=Caf%C3%A9"],
    ["//evil.example", "/dashboard"],
    ["///evil.example", "/dashboard"],
    ["https://evil.example", "/dashboard"],
    ["http://app.appshelf.localhost/dashboard", "/dashboard"],
    ["javascript:alert(1)", "/dashboard"],
    ["/\\evil.example", "/dashboard"],
    ["/\\/evil.example", "/dashboard"],
    ["/\t/evil.example", "/dashboard"],
    ["/\n/evil.example", "/dashboard"],
    ["/\r\n/evil.example", "/dashboard"],
    ["/\u0000/evil.example", "/dashboard"],
    ["/%09/evil.example", "/dashboard"],
    ["/%0a/evil.example", "/dashboard"],
    ["/%0D%0A/evil.example", "/dashboard"],
    ["/%5C/evil.example", "/dashboard"],
    ["/%5c%5cevil.example", "/dashboard"],
    ["/%2F%2Fevil.example", "/dashboard"],
    ["/%2f/evil.example", "/dashboard"],
    ["%2F%2Fevil.example", "/dashboard"],
    ["", "/dashboard"],
    [undefined, "/dashboard"],
    [42, "/dashboard"],
  ])("%j -> %j", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it("never resolves to another origin", () => {
    for (const next of ["/\t/evil.example", "/%09/evil.example", "/\\evil.example", "//evil.example"]) {
      expect(new URL(safeNextPath(next), "http://app.appshelf.localhost").origin).toBe("http://app.appshelf.localhost");
    }
  });
});
