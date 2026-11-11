import { describe, expect, it } from "vitest";
import { TITLE_MAX, validateTitle } from "./site-title";

describe("validateTitle", () => {
  it.each([
    ["Luna Bistro", "Luna Bistro"],
    ["  Café Mõnaco & Co.  ", "Café Mõnaco & Co."],
    ["Phở Đông Ba", "Phở Đông Ba"],
    ["x".repeat(TITLE_MAX), "x".repeat(TITLE_MAX)],
  ])("accepts %j", (input, title) => {
    expect(validateTitle(input)).toEqual({ ok: true, title });
  });

  it.each([
    ["", "Give your site a title."],
    ["   ", "Give your site a title."],
    [null, "Give your site a title."],
    ["x".repeat(TITLE_MAX + 1), "under"],
    ["Luna\u0000Bistro", "control characters"],
    ["Luna\tBistro", "control characters"],
    ["Luna\nBistro", "control characters"],
    ["Luna\u007fBistro", "control characters"],
    ["Luna\u0085Bistro", "control characters"],
  ])("rejects %j", (input, reason) => {
    const result = validateTitle(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(reason);
  });
});
