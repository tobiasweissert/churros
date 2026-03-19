import { getPairingRecency } from "../db/pairings";

export interface Pair {
  userA: string;
  userB: string;
}

export type DepartmentMap = Map<string, string | null>;

/**
 * Greedy matching algorithm that:
 *  1. Shuffles the eligible user list for fairness
 *  2. Scores each candidate partner and picks the highest score
 *  3. Scoring: never met (10000) > days since last pairing (0–180) > cross-dept (50)
 *
 * Returns an array of pairs. If there's an odd number of users, the last
 * user is left unpaired (no trio support in MVP).
 */
export function matchUsers(
  channelId: string,
  eligibleUsers: string[],
  lastLeftOut: string | null = null,
  departments: DepartmentMap = new Map()
): Pair[] {
  if (eligibleUsers.length < 2) return [];

  const pairingRecency = getPairingRecency(channelId);
  const users = shuffle([...eligibleUsers]);

  // Move the person who was left out last round to the front so they
  // get paired first and are least likely to be the odd one out again.
  if (lastLeftOut) {
    const idx = users.indexOf(lastLeftOut);
    if (idx > 0) {
      users.splice(idx, 1);
      users.unshift(lastLeftOut);
    }
  }
  const paired = new Set<string>();
  const pairs: Pair[] = [];

  for (let i = 0; i < users.length; i++) {
    const userA = users[i];
    if (paired.has(userA)) continue;

    const partner = findBestPartner(userA, users, paired, pairingRecency, departments);
    if (!partner) continue;

    pairs.push({ userA, userB: partner });
    paired.add(userA);
    paired.add(partner);
  }

  return pairs;
}

/**
 * Scores a candidate partner for userA based on pairing history and department diversity.
 * Higher score = better match. Never-met pairs score 10,000, otherwise uses days since
 * last pairing (capped at 180), with a +50 cross-department bonus.
 */
export function scoreCandidate(
  userA: string,
  candidate: string,
  pairingRecency: Map<string, Map<string, number>>,
  departments: DepartmentMap
): number {
  const recencyMap = pairingRecency.get(userA);
  const daysSince = recencyMap?.get(candidate);

  let score: number;
  if (daysSince === undefined) {
    // Never met — always dominates
    score = 10_000;
  } else {
    // Linear recency score: longer ago = higher score (max 180)
    score = daysSince;
  }

  // Cross-department tiebreaker
  const deptA = departments.get(userA);
  const deptB = departments.get(candidate);
  if (deptA != null && deptB != null && deptA !== deptB) {
    score += 50;
  }

  return score;
}

/**
 * Finds the highest-scoring unpaired partner for userA from the remaining users list.
 * Returns null if no eligible candidate exists.
 */
function findBestPartner(
  userA: string,
  users: string[],
  paired: Set<string>,
  pairingRecency: Map<string, Map<string, number>>,
  departments: DepartmentMap
): string | null {
  let bestPartner: string | null = null;
  let bestScore = -Infinity;

  for (const candidate of users) {
    if (candidate === userA) continue;
    if (paired.has(candidate)) continue;

    const score = scoreCandidate(userA, candidate, pairingRecency, departments);
    if (score > bestScore) {
      bestScore = score;
      bestPartner = candidate;
    }
  }

  return bestPartner;
}

/** Fisher-Yates in-place shuffle. Returns the same array for convenience. */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
