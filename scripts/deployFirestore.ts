/**
 * Deploys the Firestore configuration the app depends on (AGENTS.md §4.7, §4.10,
 * §4.13): security rules, the leaderboard composite index, and the TTL policy
 * that reclaims spent run tokens.
 *
 * Uses the Admin SDK's own credentials rather than the firebase CLI, so it works
 * in CI with nothing but the service account already in `.env.local`.
 *
 * Run with `npm run deploy:firestore`; `--dry-run` validates and reports without
 * changing anything live. `--only=rules,indexes,ttl` narrows the run, which
 * matters because the three use different APIs and therefore different IAM
 * permissions — one of them failing should not block the others.
 */
import fs from "node:fs";
import { getAdminApp } from "../src/server/adminApp";

const RULES_FILE = "firestore.rules";
const INDEXES_FILE = "firestore.indexes.json";
const DATABASE = "(default)";

/** Fields carrying a TTL policy: Firestore deletes the document once they pass. */
const TTL_FIELDS = [{ collectionGroup: "runTokens", field: "expiresAt" }];

interface IndexSpec {
  collectionGroup: string;
  queryScope: string;
  fields: Array<{ fieldPath: string; order: string }>;
}

const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID ?? "";
const dryRun = process.argv.includes("--dry-run");

const onlyArg = process.argv.find((arg) => arg.startsWith("--only="));
const selected = onlyArg ? onlyArg.slice("--only=".length).split(",") : ["rules", "indexes", "ttl"];
const wants = (step: string) => selected.includes(step);

async function token(): Promise<string> {
  const app = getAdminApp();
  const { access_token } = await app.options.credential!.getAccessToken();
  return access_token;
}

async function call(url: string, init: RequestInit, accessToken: string) {
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body };
}

/**
 * Rules deploy is two steps by design: creating a ruleset only compiles it, and
 * a release is what actually points the database at it. Splitting them means a
 * syntax error is caught before anything live changes.
 */
async function deployRules(accessToken: string) {
  const source = fs.readFileSync(RULES_FILE, "utf8");
  const base = `https://firebaserules.googleapis.com/v1/projects/${projectId}`;

  const created = await call(
    `${base}/rulesets`,
    { method: "POST", body: JSON.stringify({ source: { files: [{ name: RULES_FILE, content: source }] } }) },
    accessToken,
  );
  if (!created.ok) throw new Error(`rules did not compile: ${JSON.stringify(created.body)}`);

  const rulesetName = (created.body as { name: string }).name;
  console.log(`✓ rules compile  ${rulesetName.split("/").pop()}`);

  if (dryRun) {
    await call(`https://firebaserules.googleapis.com/v1/${rulesetName}`, { method: "DELETE" }, accessToken);
    console.log("  (validation ruleset deleted, nothing released)");
    return;
  }

  const releaseName = `projects/${projectId}/releases/cloud.firestore`;
  // The release exists after the first deploy, so create-then-patch rather than
  // assuming either.
  let released = await call(
    `${base}/releases`,
    { method: "POST", body: JSON.stringify({ name: releaseName, rulesetName }) },
    accessToken,
  );
  if (!released.ok && released.status === 409) {
    released = await call(
      `https://firebaserules.googleapis.com/v1/${releaseName}`,
      { method: "PATCH", body: JSON.stringify({ release: { name: releaseName, rulesetName } }) },
      accessToken,
    );
  }
  if (!released.ok) throw new Error(`release failed: ${JSON.stringify(released.body)}`);
  console.log("✓ rules released — now enforcing on the live database");
}

async function deployIndexes(accessToken: string) {
  const { indexes } = JSON.parse(fs.readFileSync(INDEXES_FILE, "utf8")) as { indexes: IndexSpec[] };
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${encodeURIComponent(DATABASE)}/collectionGroups`;

  for (const index of indexes) {
    const label = `${index.collectionGroup} (${index.fields.map((f) => `${f.fieldPath} ${f.order.slice(0, 4).toLowerCase()}`).join(", ")})`;
    if (dryRun) {
      console.log(`· index ${label} — not created (--dry-run)`);
      continue;
    }

    const result = await call(
      `${base}/${index.collectionGroup}/indexes`,
      {
        method: "POST",
        body: JSON.stringify({
          queryScope: index.queryScope,
          fields: index.fields.map(({ fieldPath, order }) => ({ fieldPath, order })),
        }),
      },
      accessToken,
    );

    // Already present is success, not failure: this script must be re-runnable.
    if (result.ok) console.log(`✓ index ${label} — building`);
    else if (result.status === 409) console.log(`✓ index ${label} — already exists`);
    else throw new Error(`index ${label} failed: ${JSON.stringify(result.body)}`);
  }
}

async function configureTtl(accessToken: string) {
  for (const { collectionGroup, field } of TTL_FIELDS) {
    const name = `projects/${projectId}/databases/${encodeURIComponent(DATABASE)}/collectionGroups/${collectionGroup}/fields/${field}`;

    if (dryRun) {
      console.log(`· ttl ${collectionGroup}.${field} — not configured (--dry-run)`);
      continue;
    }

    const result = await call(
      `https://firestore.googleapis.com/v1/${name}?updateMask=ttlConfig`,
      { method: "PATCH", body: JSON.stringify({ ttlConfig: {} }) },
      accessToken,
    );
    if (!result.ok) throw new Error(`ttl ${collectionGroup}.${field} failed: ${JSON.stringify(result.body)}`);
    console.log(`✓ ttl ${collectionGroup}.${field} — expired documents reclaimed automatically`);
  }
}

async function main() {
  if (!projectId) throw new Error("FIREBASE_ADMIN_PROJECT_ID is not set");
  console.log(`${dryRun ? "Validating" : "Deploying to"} ${projectId}\n`);

  const accessToken = await token();
  if (wants("rules")) await deployRules(accessToken);
  if (wants("indexes")) await deployIndexes(accessToken);
  if (wants("ttl")) await configureTtl(accessToken);

  console.log(dryRun ? "\nvalidated — nothing changed" : "\ndone");
}

main().catch((error) => {
  console.error(`\n${(error as Error).message}`);
  process.exit(1);
});
