import { getDb } from "@appshelf/db";
import { describe, expect, it } from "vitest";
import { checkoutCompletedEvent, deliver, seedUserAndProduct, withCleanDatabase } from "@/test/fixtures";
import { checkSlug, slugify, validateSlug } from "./slug";

withCleanDatabase();

describe("slugify", () => {
  it.each([
    ["Luna Bistro", "luna-bistro"],
    ["  Café Mõnaco & Co.  ", "cafe-monaco-co"],
    ["Phở Đông Ba", "pho-dong-ba"],
    ["A", "a-site"],
    ["!!!", ""],
    ["This title is definitely far too long for an address", "this-title-is-definitely-far"],
  ])("%j -> %j", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });
});

describe("validateSlug", () => {
  it.each(["abc", "luna-bistro", "shop24", "a1-b2-c3", "x".repeat(30)])("accepts %j", (slug) => {
    expect(validateSlug(slug)).toEqual({ ok: true, slug });
  });

  it("normalises case and whitespace", () => {
    expect(validateSlug("  Luna-Bistro ")).toEqual({ ok: true, slug: "luna-bistro" });
  });

  it.each([
    ["ab", "characters"],
    ["x".repeat(31), "characters"],
    ["-start", "hyphens"],
    ["end-", "hyphens"],
    ["double--dash", "hyphens"],
    ["under_score", "hyphens"],
    ["space here", "hyphens"],
    ["café", "hyphens"],
    ["12345", "only numbers"],
    ["wp-admin", "reserved"],
    ["wp-anything", "reserved"],
    ["restaurant-demo", "reserved"],
    ["files", "reserved"],
    ["appshelf", "reserved"],
    ["appshelf-admin", "reserved"],
    ["  AppShelf ", "reserved"],
  ])("rejects %j", (slug, reason) => {
    const result = validateSlug(slug);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(reason);
  });
});

describe("checkSlug (database)", () => {
  it("reports a slug already used by a site", async () => {
    const { user, product } = await seedUserAndProduct();
    await deliver(
      checkoutCompletedEvent({
        subscriptionId: "sub_slug",
        metadata: { kind: "new", userId: user.id, productId: product.id, template: "agency", slug: "taken-name", title: "T" },
      }),
    );

    expect(await checkSlug(getDb(), "taken-name")).toEqual({ ok: false, error: "That address is already taken." });
    expect(await checkSlug(getDb(), "free-name")).toEqual({ ok: true, slug: "free-name" });
  });
});
