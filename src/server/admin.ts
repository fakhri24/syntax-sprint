/**
 * Admin identification (PLAN 4.1).
 *
 * There is no admin role in Firestore and deliberately so: a role stored in a
 * document is only as trustworthy as the rules protecting it. An environment
 * variable cannot be edited by anyone who has not already got the server.
 */
export function adminUids(): string[] {
  return (process.env.ADMIN_UIDS ?? "")
    .split(",")
    .map((uid) => uid.trim())
    .filter(Boolean);
}

export function isAdmin(uid: string): boolean {
  const allowed = adminUids();
  // An empty allowlist grants nothing. Failing closed matters more here than
  // convenience during setup.
  return allowed.length > 0 && allowed.includes(uid);
}
