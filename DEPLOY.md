# Deploying Syntax Sprint

Two things ship separately: the Firestore configuration (rules, index, TTL) and
the Next.js app. Neither depends on the other being done first, but the app is
only half-working until the rules land — see "What breaks without it" below.

---

## 1. Firestore configuration

### The permission problem

`npm run deploy:firestore` uses the service account already in `.env.local`. It
can **compile** rules, but not release them:

```
release failed: 403 IAM_PERMISSION_DENIED — firebaserules.releases.create
index leaderboardEntries failed: 403 PERMISSION_DENIED
```

The `firebase-adminsdk` service account is provisioned for the data plane —
reading and writing documents — and deliberately not for the admin plane that
changes rules and indexes. Pick one of the two fixes.

### Option A — deploy as yourself (simplest)

`firebase-tools` is already installed and `firebase.json` is in the repo.

```bash
firebase login
firebase deploy --only firestore --project syntax-sprint
```

That releases `firestore.rules` and creates the index from
`firestore.indexes.json`.

### Option B — grant the service account admin rights (needed for CI)

In Google Cloud IAM, add these roles to
`firebase-adminsdk-…@syntax-sprint.iam.gserviceaccount.com`:

- `roles/firebaserules.admin` — release rules
- `roles/datastore.indexAdmin` — create indexes

Then `npm run deploy:firestore` works unattended, which is what a deploy
pipeline needs. Use `--dry-run` to validate without changing anything, and
`--only=rules,indexes,ttl` to run one part at a time.

### TTL policy (either option)

Spent run tokens are reclaimed by a TTL policy on `runTokens.expiresAt`
(AGENTS.md §4.13). The Firebase CLI does not manage TTL, so use gcloud or the
console:

```bash
gcloud firestore fields ttls update expiresAt \
  --collection-group=runTokens --enable-ttl --project=syntax-sprint
```

Without it nothing breaks — the tokens are still single-use — but the collection
grows forever.

### What breaks without the rules deploy

The database is currently in full lockdown (`allow read, write: if false`).

- **Works:** the arena. `/play/[id]` reads the snippet server-side through the
  Admin SDK, which bypasses rules entirely.
- **Broken:** the leaderboard. It reads through the client SDK, so every query
  is denied and the page shows its error state.
- **Safe:** nothing is exposed. Lockdown is more restrictive than our rules, not
  less.

### Verifying afterwards

```bash
npm run test:rules   # 24 assertions against a throwaway emulator
```

These run against the emulator, not production, so they can be run at any time
without touching live data.

---

## 2. The Next.js app

### Environment variables

Set every variable from `.env.example` in the hosting provider. The split
matters (AGENTS.md §4.14):

| Variable | Scope | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_FIREBASE_*` (6) | Public | Safe to expose; secured by rules, not secrecy |
| `FIREBASE_ADMIN_PROJECT_ID` | Server | |
| `FIREBASE_ADMIN_CLIENT_EMAIL` | Server | |
| `FIREBASE_ADMIN_PRIVATE_KEY` | Server | Paste with real newlines; the code also accepts `\n` escapes |
| `RUN_TOKEN_SECRET` | Server | Generate fresh for production — do not reuse the local one |
| `ADMIN_UIDS` | Server | Comma-separated. Empty means nobody can review flagged runs |

Generate the production signing secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Rotating `RUN_TOKEN_SECRET` invalidates only runs in flight, never stored
scores.

### Deploy

```bash
npx vercel --prod
```

Build command and output are Next.js defaults; no configuration needed. The
`/api/runs/*` and `/api/admin/*` routes need the Node runtime, which they
already declare.

### After the first deploy

1. **Add the production domain to Firebase Auth** → Authentication → Settings →
   Authorized domains. Google sign-in fails silently on an unlisted domain.
2. **Seed the snippets** if the target project is new:
   `npm run seed:snippets` (already done for `syntax-sprint`).
3. **Set `ADMIN_UIDS`** to your own uid, or the flagged-run review surface stays
   inaccessible — it fails closed by design.
4. **Check `/dev/*` routes are gone.** They `notFound()` when
   `NODE_ENV === "production"`; confirm `/dev/input-probe` returns 404.

---

## Deploy checklist

- [ ] `npm run test` — 385 unit tests
- [ ] `npm run test:rules` — 24 rules assertions (needs a JVM)
- [ ] `npm run test:e2e` — 33 browser specs
- [ ] `npm run build`
- [ ] Firestore rules + index released (§1 above)
- [ ] TTL policy on `runTokens.expiresAt`
- [ ] Environment variables set, with a fresh `RUN_TOKEN_SECRET`
- [ ] Production domain authorized in Firebase Auth
- [ ] `/dev/input-probe` returns 404 in production
