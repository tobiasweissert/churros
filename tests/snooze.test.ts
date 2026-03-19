import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DB } from "../src/db/store";

// Mock the store so snooze functions never touch the filesystem
vi.mock("../src/db/store", () => {
  let _db: DB = makeEmptyDb();

  function makeEmptyDb(): DB {
    return {
      config: null,
      pairings: [],
      nextPairingId: 1,
      lastLeftOut: null,
      snoozedUsers: {},
      lastPairingRunAt: null,
    };
  }

  return {
    readDb: vi.fn(() => structuredClone(_db)),
    writeDb: vi.fn((db: DB) => { _db = structuredClone(db); }),
    // Expose reset helper for tests
    __reset: () => { _db = makeEmptyDb(); },
  };
});

import * as store from "../src/db/store";
import { snoozeUser, optOutUser, unsnoozeUser, isUserSnoozed, getUserSnoozeEntry, cleanExpiredSnoozes } from "../src/db/snooze";

function resetDb() {
  (store as unknown as { __reset: () => void }).__reset();
}

beforeEach(() => {
  resetDb();
  vi.clearAllMocks();
  // Re-bind mocks after reset so readDb/writeDb still work
  const mod = store as unknown as { __reset: () => void } & typeof store;
  mod.__reset();
});

describe("snoozeUser", () => {
  it("creates a temporary snooze entry with correct expiry", () => {
    const before = Date.now();
    snoozeUser("U1", 2);
    const after = Date.now();

    const entry = getUserSnoozeEntry("U1");
    expect(entry).not.toBeNull();
    expect(entry!.type).toBe("temporary");
    expect(entry!.expires_at).not.toBeNull();

    const expiry = new Date(entry!.expires_at!).getTime();
    const twoWeeksMs = 14 * 24 * 60 * 60 * 1000;
    const toleranceMs = 2 * 60 * 60 * 1000; // ±2h to account for DST transitions
    expect(expiry).toBeGreaterThanOrEqual(before + twoWeeksMs - toleranceMs);
    expect(expiry).toBeLessThanOrEqual(after + twoWeeksMs + toleranceMs);
  });

  it("overwrites an existing snooze", () => {
    snoozeUser("U1", 1);
    snoozeUser("U1", 4);
    const entry = getUserSnoozeEntry("U1");
    const expiry = new Date(entry!.expires_at!).getTime();
    const expectedMin = Date.now() + 27 * 24 * 60 * 60 * 1000 - 1000;
    expect(expiry).toBeGreaterThan(expectedMin);
  });
});

describe("optOutUser", () => {
  it("creates a permanent snooze entry", () => {
    optOutUser("U2");
    const entry = getUserSnoozeEntry("U2");
    expect(entry).not.toBeNull();
    expect(entry!.type).toBe("permanent");
    expect(entry!.expires_at).toBeNull();
  });
});

describe("unsnoozeUser", () => {
  it("removes the snooze entry", () => {
    optOutUser("U3");
    unsnoozeUser("U3");
    expect(getUserSnoozeEntry("U3")).toBeNull();
  });

  it("is a no-op for a user who is not snoozed", () => {
    expect(() => unsnoozeUser("U_unknown")).not.toThrow();
  });
});

describe("isUserSnoozed", () => {
  it("returns false for a user with no entry", () => {
    expect(isUserSnoozed("U_none")).toBe(false);
  });

  it("returns true for a permanently opted-out user", () => {
    optOutUser("U4");
    expect(isUserSnoozed("U4")).toBe(true);
  });

  it("returns true for a temporarily snoozed user whose window has not expired", () => {
    snoozeUser("U5", 1);
    expect(isUserSnoozed("U5")).toBe(true);
  });

  it("returns false for a temporarily snoozed user whose window has expired", () => {
    // Manually inject an already-expired entry
    const db = store.readDb();
    db.snoozedUsers["U6"] = {
      type: "temporary",
      expires_at: new Date(Date.now() - 1000).toISOString(),
      created_at: new Date().toISOString(),
    };
    store.writeDb(db);
    expect(isUserSnoozed("U6")).toBe(false);
  });
});

describe("cleanExpiredSnoozes", () => {
  it("removes expired temporary entries", () => {
    const db = store.readDb();
    db.snoozedUsers["U7"] = {
      type: "temporary",
      expires_at: new Date(Date.now() - 1000).toISOString(),
      created_at: new Date().toISOString(),
    };
    store.writeDb(db);
    cleanExpiredSnoozes();
    expect(getUserSnoozeEntry("U7")).toBeNull();
  });

  it("keeps permanent entries", () => {
    optOutUser("U8");
    cleanExpiredSnoozes();
    expect(getUserSnoozeEntry("U8")).not.toBeNull();
  });

  it("keeps non-expired temporary entries", () => {
    snoozeUser("U9", 1);
    cleanExpiredSnoozes();
    expect(getUserSnoozeEntry("U9")).not.toBeNull();
  });

  it("does not write to DB when nothing has changed", () => {
    snoozeUser("U10", 2); // active snooze, won't be cleaned
    vi.clearAllMocks();
    cleanExpiredSnoozes();
    expect(store.writeDb).not.toHaveBeenCalled();
  });
});
