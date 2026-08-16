import { afterEach, describe, expect, it } from "vitest";
import { adminUids, isAdmin } from "./admin";

const original = process.env.ADMIN_UIDS;

afterEach(() => {
  if (original === undefined) delete process.env.ADMIN_UIDS;
  else process.env.ADMIN_UIDS = original;
});

describe("adminUids", () => {
  it("parses a comma-separated list, ignoring spacing", () => {
    process.env.ADMIN_UIDS = " u1 , u2,u3 ";
    expect(adminUids()).toEqual(["u1", "u2", "u3"]);
  });

  it("is empty when unset or blank", () => {
    delete process.env.ADMIN_UIDS;
    expect(adminUids()).toEqual([]);

    process.env.ADMIN_UIDS = " , ,";
    expect(adminUids()).toEqual([]);
  });
});

describe("isAdmin", () => {
  it("recognises a listed uid", () => {
    process.env.ADMIN_UIDS = "u1,u2";
    expect(isAdmin("u1")).toBe(true);
    expect(isAdmin("u2")).toBe(true);
  });

  it("rejects an unlisted uid", () => {
    process.env.ADMIN_UIDS = "u1";
    expect(isAdmin("u2")).toBe(false);
  });

  it("grants nothing when the allowlist is empty", () => {
    // Failing closed matters more than convenience during setup: an unset
    // variable must never mean "everyone is an admin".
    delete process.env.ADMIN_UIDS;
    expect(isAdmin("u1")).toBe(false);
    expect(isAdmin("")).toBe(false);
  });

  it("does not match on a prefix or substring", () => {
    process.env.ADMIN_UIDS = "abcdef";
    expect(isAdmin("abc")).toBe(false);
    expect(isAdmin("abcdefg")).toBe(false);
  });
});
