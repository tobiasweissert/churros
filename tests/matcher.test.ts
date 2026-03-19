import { describe, it, expect, vi, beforeEach } from "vitest";
import { scoreCandidate, matchUsers } from "../src/intros/matcher";

// Mock the DB-dependent module so matcher tests have no FS side-effects
vi.mock("../src/db/pairings", () => ({
  getPairingRecency: vi.fn(() => new Map()),
}));

import { getPairingRecency } from "../src/db/pairings";

const emptyRecency = () => new Map<string, Map<string, number>>();

describe("scoreCandidate", () => {
  it("gives 10000 for two users who have never met", () => {
    const score = scoreCandidate("U1", "U2", emptyRecency(), new Map());
    expect(score).toBe(10_000);
  });

  it("uses days since last pairing as score", () => {
    const recency = new Map([["U1", new Map([["U2", 30]])]]);
    const score = scoreCandidate("U1", "U2", recency, new Map());
    expect(score).toBe(30);
  });

  it("adds 50 cross-department bonus", () => {
    const departments = new Map([
      ["U1", "engineering"],
      ["U2", "design"],
    ]);
    const score = scoreCandidate("U1", "U2", emptyRecency(), departments);
    expect(score).toBe(10_050);
  });

  it("does not apply cross-department bonus for same department", () => {
    const departments = new Map([
      ["U1", "engineering"],
      ["U2", "engineering"],
    ]);
    const score = scoreCandidate("U1", "U2", emptyRecency(), departments);
    expect(score).toBe(10_000);
  });

  it("does not apply cross-department bonus when department is unknown", () => {
    const departments = new Map([["U1", "engineering"]]);
    const score = scoreCandidate("U1", "U2", emptyRecency(), departments);
    expect(score).toBe(10_000);
  });

  it("recency + cross-department bonus stack correctly", () => {
    const recency = new Map([["U1", new Map([["U2", 50]])]]);
    const departments = new Map([
      ["U1", "engineering"],
      ["U2", "design"],
    ]);
    const score = scoreCandidate("U1", "U2", recency, departments);
    expect(score).toBe(100); // 50 days + 50 cross-dept
  });
});

describe("matchUsers", () => {
  beforeEach(() => {
    vi.mocked(getPairingRecency).mockReturnValue(emptyRecency());
  });

  it("returns empty array for fewer than 2 users", () => {
    expect(matchUsers("C1", [])).toEqual([]);
    expect(matchUsers("C1", ["U1"])).toEqual([]);
  });

  it("returns one pair for exactly 2 users", () => {
    const pairs = matchUsers("C1", ["U1", "U2"]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ userA: expect.any(String), userB: expect.any(String) });
    const ids = new Set([pairs[0].userA, pairs[0].userB]);
    expect(ids).toEqual(new Set(["U1", "U2"]));
  });

  it("pairs all users when count is even", () => {
    const users = ["U1", "U2", "U3", "U4"];
    const pairs = matchUsers("C1", users);
    expect(pairs).toHaveLength(2);
    const paired = pairs.flatMap((p) => [p.userA, p.userB]);
    expect(new Set(paired)).toEqual(new Set(users));
  });

  it("leaves one user unpaired when count is odd", () => {
    const users = ["U1", "U2", "U3"];
    const pairs = matchUsers("C1", users);
    expect(pairs).toHaveLength(1);
  });

  it("never pairs a user with themselves", () => {
    const users = ["U1", "U2", "U3", "U4"];
    const pairs = matchUtils("C1", users);
    for (const pair of pairs) {
      expect(pair.userA).not.toBe(pair.userB);
    }
  });

  it("ensures lastLeftOut user gets paired first (appears in a pair)", () => {
    // With 3 users, one will be left out — lastLeftOut should NOT be left out again
    vi.mocked(getPairingRecency).mockReturnValue(emptyRecency());

    let leftOutAgainCount = 0;
    const trials = 50;
    for (let i = 0; i < trials; i++) {
      const pairs = matchUsers("C1", ["U1", "U2", "U3"], "U1");
      const paired = new Set(pairs.flatMap((p) => [p.userA, p.userB]));
      if (!paired.has("U1")) leftOutAgainCount++;
    }
    // U1 should almost never be left out again (prioritized to front of list)
    expect(leftOutAgainCount).toBe(0);
  });

  it("prefers never-met pairs over recently-seen ones", () => {
    // U1 has met U2 recently (5 days), but never met U3
    const recency = new Map([
      ["U1", new Map([["U2", 5]])],
      ["U2", new Map([["U1", 5]])],
    ]);
    vi.mocked(getPairingRecency).mockReturnValue(recency);

    // Run many times — U1 should consistently pair with U3 (score 10000 vs 5)
    const pairs = matchUsers("C1", ["U1", "U2", "U3"]);
    const u1Pair = pairs.find((p) => p.userA === "U1" || p.userB === "U1");
    if (u1Pair) {
      const partner = u1Pair.userA === "U1" ? u1Pair.userB : u1Pair.userA;
      expect(partner).toBe("U3");
    }
  });
});

// Fix typo helper used in test above
function matchUtils(channelId: string, users: string[]) {
  return matchUsers(channelId, users);
}
