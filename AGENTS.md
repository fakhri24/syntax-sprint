# AGENTS.md - Syntax Sprint Technical Specifications

## 1. System Overview
Syntax Sprint is a real-time speed typing game where developers type syntactically valid code snippets (CSS, SVG, JavaScript) that incrementally render and execute inside an isolated live sandbox.

### Core Gameplay Invariants
1. **Hard-Locked Typo Policy:** If a user types a wrong character, the editor immediately halts cursor advancement. The user **MUST** press `Backspace` to clear the incorrect character before any new input is accepted.
2. **Real-Syntax Execution:** Code is not cosmetic. Typed tokens are parsed and applied to a live Shadow DOM or sandboxed iframe runtime as the cursor advances (see §4.2 for per-language execution granularity).
3. **Google Authentication for Scoring:** Anyone may play. Submitting a run to an official leaderboard requires a verified Google account via Firebase Auth, and the user must be signed in *before* the run starts (§4.6).
4. **Curated Content Only:** All snippets are authored and reviewed in-repo. There is no user-generated snippet pipeline; clients can never write to the `snippets` collection.
5. **Server-Authoritative Scoring:** Clients never write scores. All run metrics are recomputed server-side from raw keystroke telemetry; client-computed values are treated as untrusted display state only.
6. **Physical Keyboard Required:** The game loop is a desktop experience. Touch-only devices are shown an explicit interstitial rather than a degraded game (§4.9).

---

## 2. Technical Stack
- **Frontend Framework:** Next.js (App Router) / React 19 + TypeScript
- **Styling:** Tailwind CSS + Radix UI primitives
- **State Management:** Zustand (decoupling input loops from React render cycles)
- **Database & Authentication:** Firebase (Firestore + Firebase Auth with Google Provider)
- **Server Runtime:** Next.js Route Handlers (Node runtime) + Firebase Admin SDK for all privileged writes
- **Code Analysis (build/seed-time only):** `acorn` (ESTree parsing) + `magic-string` (surgical source edits) — see §4.12
- **Syntax Highlighting (seed-time only):** `shiki` — tokens are precomputed and stored on the manifest; nothing highlights at runtime (§4.11)
- **Live Stage Sandbox:**
  - *CSS / SVG Levels:* Shadow DOM encapsulating dynamic `<style>` and SVG nodes.
  - *JavaScript Levels:* Sandboxed `<iframe>` (`sandbox="allow-scripts"`, no `allow-same-origin`) communicating via `postMessage`.
- **Audio Engine:** Web Audio API (synthesized mechanical switch profiles & error tones)
- **Testing:** Vitest + React Testing Library (unit/engine), Playwright (real keyboard input, IME, and stage integration)

---

## 3. Directory Structure

syntax-sprint/
├── src/
│   ├── app/
│   │   ├── (auth)/login/       # Google OAuth sign-in flow
│   │   ├── (game)/play/[id]/   # Core game arena & split viewport
│   │   ├── leaderboard/        # Global & snippet leaderboards
│   │   └── api/runs/
│   │       ├── start/          # Issues single-use signed run token (anti-replay)
│   │       └── submit/         # Server-authoritative run validation & persistence
│   ├── components/
│   │   ├── editor/             # Tokenized code display, caret, error-shake
│   │   ├── stage/              # Shadow DOM & Iframe execution stages
│   │   ├── metrics/            # Speedometer, accuracy gauge, timer
│   │   └── gates/              # DesktopRequired interstitial, auth prompts
│   ├── engine/
│   │   ├── fsm.ts              # Game lifecycle state machine
│   │   ├── input.ts            # beforeinput/composition normalization layer
│   │   ├── keystroke.ts        # Hard-lock diffing & backspace interceptor
│   │   ├── layout.ts           # Newline / indentation auto-skip rules
│   │   ├── metrics.ts          # WPM, Net WPM, and Accuracy formulas (shared client/server)
│   │   ├── telemetry.ts        # Keystroke interval recorder & payload encoder
│   │   ├── checkpoints.ts      # Statement-boundary index builder for JS snippets
│   │   ├── loopGuard.ts        # AST-level loop instrumentation for iframe execution
│   │   └── sandbox.ts          # Incremental code parser & injector
│   ├── lib/
│   │   ├── firebase.ts         # Firebase client SDK initialization
│   │   ├── firebaseAdmin.ts    # Admin SDK (server-only, never imported by client code)
│   │   └── audio.ts            # Low-latency Web Audio sound triggers
│   ├── server/
│   │   ├── runToken.ts         # Signs & redeems single-use run tokens
│   │   ├── verifyRun.ts        # Telemetry validation + metric recomputation
│   │   └── leaderboard.ts      # Best-per-user aggregate maintenance
│   └── types/
│       ├── game.ts             # Keystroke states & level manifest types
│       └── schema.ts           # Firestore document definitions
├── content/snippets/           # Curated snippet manifests (source of truth)
├── scripts/seedSnippets.ts     # Seeds content/snippets/ into Firestore via Admin SDK
├── firestore.rules             # Security rules for collections
├── e2e/                        # Playwright specs
├── vitest.config.ts
└── package.json

---

## 4. Engineering Rules & Invariants

### 4.1 Input Layer, Keyboard Layouts & IME
Character input is **not** read from `keydown`. A synchronous `keydown` handler cannot represent dead keys, AltGr combinations, or IME composition — and `{`, `[`, `\`, `|` are exactly the characters that move around on non-US layouts. `input.ts` normalizes input as follows:

- A hidden, focused `<textarea>` is the input target.
- **Characters** come from `beforeinput`. Only `inputType === 'insertText'` produces a game keystroke, and only when `event.data` is exactly one character.
- **Composition:** all `beforeinput` events are ignored while `isComposing` is true. The committed result arrives as `insertCompositionText` / `insertText` at `compositionend` and is then fed through the normal path, one character at a time.
- **Control keys** come from `keydown`: `Backspace` (§4.3), `Enter` (§4.2), `Tab`, `Escape`.
  - `Tab` is `preventDefault`-ed to protect focus and is a **no-op**, never an error — indentation is auto-skipped, so there is nothing for `Tab` to type.
- **Paste and drop are rejected.** `paste`/`drop` are `preventDefault`-ed, and `insertFromPaste` / `insertFromDrop` / any multi-character `data` are discarded **without** counting as an error and without advancing the cursor.
- Modifier keys (`Shift`, `Control`, `Alt`, `Meta`, `CapsLock`) never reach the engine and never trigger error states.
- Playwright coverage is mandatory here: US and non-US layouts, a dead-key sequence, and an IME composition must each be asserted, because none of this is reachable from jsdom.

### 4.2 Newline & Indentation Rules
Users never type leading whitespace. Typing four spaces to reach a nested line is neither skill nor fun, and it inflates WPM for deeply indented code.

- Snippet manifests are stored with trailing whitespace stripped from every line.
- When the cursor sits at end-of-line, the only accepted input is `Enter`. Any character input there is an error.
- A single `Enter` atomically advances the cursor past the `\n`, past all leading whitespace of the next line, and past any fully blank lines, landing on the next non-whitespace character.
- **Auto-skipped characters are not typed, so they are not scored.** They never increment `correctKeystrokes` and never emit a telemetry interval.
- Each snippet therefore has two lengths, both precomputed at seed time:
  - `targetCode.length` — full text, used for rendering and stage injection.
  - `billableLength` — count of characters the user actually types (`\n` counts as one; leading whitespace counts as zero). This is the denominator for WPM and the expected `intervals.length` in §4.6.

### 4.3 Keystroke & Hard-Lock Engine
- The engine state tracks `hasError: boolean` and `errorChar: string | null`. **At most one error character can exist at a time** — the lock engages on the first wrong input, so a second wrong character can never be entered.
- When `hasError === true`:
  - All character inputs are blocked.
  - An error sound and CSS shake animation trigger on every additional keypress.
  - Only `Backspace` resets `hasError = false` and unlocks forward progression.
- **When `hasError === false`, `Backspace` is a no-op.** Correct characters cannot be deleted. Cursor progress is strictly monotonic, which keeps telemetry a flat forward-only sequence and removes an entire class of scoring ambiguity. The UI should give a soft non-error "nothing to delete" cue rather than silence.
- `Backspace` is never counted as an error and never as a correct keystroke.
- **Error accounting (authoritative definitions, consumed by `metrics.ts`):**
  - `totalErrors` — count of *transitions* into the locked state. One typo equals exactly one error, regardless of how many additional keys are mashed while locked.
  - `blockedKeystrokes` — every rejected input including repeats while locked. Telemetry and anti-cheat only; never enters a scoring formula.

### 4.4 Sandboxed Execution Pipeline
- **CSS / SVG Snippets:** Substrings up to `cursorIndex` are injected into the Shadow DOM root on every accepted keystroke. Incomplete tokens are tolerated gracefully by the browser's own error recovery and must not crash the main application.
- **JavaScript Snippets — checkpoint execution:** Executing an arbitrary prefix of JavaScript is not meaningful; a partial statement is almost always a syntax error. Therefore:
  - Each JS snippet ships with a precomputed **checkpoint index**: the set of character offsets at which the prefix is guaranteed to parse (top-level `;` and closing `}` of top-level blocks), produced by `checkpoints.ts` at authoring/seed time and stored on the snippet manifest.
  - The iframe re-executes the full prefix **only when the cursor crosses a checkpoint**, never per keystroke. Between checkpoints the stage holds its last successful render.
  - Each execution is a fresh run of the whole prefix in a reset iframe document — there is no incremental state carried across executions.
- **JavaScript containment:** `window.onerror` inside the iframe catches thrown exceptions only. It does **not** catch runaway loops, which block the iframe's event loop.
  1. **Loop guard (the only defence against a synchronous hang):** before execution, `loopGuard.ts` instruments every `for` / `while` / `for-in` / `for-of` / `do-while` body with an iteration counter that throws once a budget (default 100k iterations) is exceeded. This converts a hang into a catchable exception. Instrumentation is **unconditional** — there is no opt-out, for the reason below.
  2. **Watchdog (secondary, and narrower than it looks):** the parent posts `EXEC` and expects an `ACK` within 750ms; on timeout it reloads the frame and surfaces a "stage reset".
- **Measured limitation — the watchdog cannot rescue a spin.** A `srcdoc` iframe has no separate URL to isolate on, so Chromium keeps it in the parent's renderer process and on the parent's main thread. A synchronous infinite loop inside the frame therefore freezes the parent too, and the watchdog's `setTimeout` never runs. This was verified directly: with instrumentation disabled, the parent's own interval stopped ticking and even `page.evaluate` never returned.
  - Consequence: the loop guard is not a first line of defence with a backstop behind it — for synchronous hangs it is the **whole** defence. That is why it cannot be turned off.
  - What the watchdog does still cover: a frame that fails to answer for reasons that leave the thread alive — a crashed or never-loaded bootstrap, or a lost message.
  - Infinite recursion is not a loop and is not instrumented, but it terminates itself with a `RangeError`, which the existing `try/catch` reports normally.
  - Moving execution to a Web Worker would give real preemption via `terminate()`, but a worker has no DOM — and DOM manipulation is precisely what the JavaScript levels teach. The trade was taken knowingly.
- Curated snippets are reviewed before seeding, so the loop guard exists to contain authoring mistakes, not adversarial input.

### 4.5 Metrics Formulas
All formulas live in `metrics.ts` and are imported by both the client display layer and `server/verifyRun.ts`, so the two can never drift.

Because the Hard-Lock policy makes it impossible for an incorrect character to remain in the final text, uncorrected errors are always zero and the textbook Net WPM formula would collapse into Gross WPM. Syntax Sprint therefore penalizes **error attempts** instead:

```
minutes        = elapsedMs / 60000
grossWpm       = (correctKeystrokes / 5) / minutes
netWpm         = max(0, grossWpm - (totalErrors / minutes))
accuracy       = correctKeystrokes / (correctKeystrokes + totalErrors)
```

- `correctKeystrokes` equals the snippet's `billableLength` on a completed run — auto-skipped indentation is excluded (§4.2).
- This is deliberately **not** the standard Net WPM definition; the UI must label it "Net WPM (error-penalized)" so players are not misled when comparing against other typing sites.
- Leaderboards sort by `netWpm`, so mashing through typos is penalized even though the final text is always perfect.

### 4.6 Trust Boundary & Run Submission
- The client is display-only. `runs` documents are created exclusively by `POST /api/runs/submit` using the Admin SDK.
- **Run tokens (anti-replay):** a run becomes submittable only if the client called `POST /api/runs/start` before typing. That route requires a valid Firebase ID token and returns a single-use signed token binding `{ uid, snippetId, serverStartMs, nonce }`. Submission without a valid, unredeemed token is rejected. This also gives the server an independent wall-clock lower bound on the run, which client-reported timing alone can never provide. Full lifecycle and storage in §4.13.
- Consequence: **guest runs cannot be submitted retroactively.** A signed-out player gets full practice mode with local-only results and must sign in before starting a fresh run to score (§1.3).
- The client submits **raw telemetry**, not scores:

```typescript
interface RunSubmission {
  runToken: string;      // from /api/runs/start, single-use
  snippetId: string;
  intervals: number[];   // ms delta between consecutive accepted keystrokes; intervals[0] === 0
  errorOffsets: number[];// cursorIndex into targetCode at each error transition
  clientElapsedMs: number;
}
```

- **The clock starts on the first keystroke**, not when the arena mounts, so reading time is never charged. That leaves the first keystroke with nothing to measure against, so `intervals[0]` is defined as `0`: the array stays exactly `billableLength` long and `sum(intervals) === elapsedMs` still holds. Every timing heuristic in this section ignores index 0, or a legitimate run would trip the sub-8ms check on its very first entry.
- `verifyRun.ts` **recomputes** `grossWpm`, `netWpm`, `accuracy`, `elapsedMs`, and `totalErrors` from `intervals` and `errorOffsets`. Any metric sent by the client is discarded.
- Rejection / flagging checks:
  - `runToken` valid, unredeemed, matching `snippetId`, and not older than a sane ceiling.
  - `intervals.length` must equal the snippet's `billableLength`; `sum(intervals)` must equal `clientElapsedMs` within a small tolerance, and must not be shorter than `now - serverStartMs` allows.
  - Recomputed `grossWpm > 250` is rejected outright.
  - Interval standard deviation below a floor (machine-uniform timing) is flagged.
  - Any sustained window of intervals below ~8ms is flagged.
  - `errorOffsets` are cursor positions in `targetCode`, so they must be within `[0, targetCode.length)` — **not** `billableLength`, which is smaller because it excludes auto-skipped indentation. They must also be non-decreasing, since the cursor never moves backwards (§4.3).
- Flagged-but-not-rejected runs are persisted with `verified: false` and excluded from leaderboard queries and aggregates.
- Telemetry is bounded: snippets are capped at 1,000 billable characters so a submission payload stays small.

### 4.7 Leaderboards
Raw `runs` cannot back a leaderboard — Firestore has no `DISTINCT`, so a single fast player would occupy dozens of Top-100 slots.

- The submit route maintains a **best-run-per-user aggregate** in the same transaction that writes the run:
  - `leaderboardEntries/{snippetId}__{uid}` — best `netWpm` for that user on that snippet.
  - `globalEntries/{uid}` — that user's single best `netWpm` across all snippets, with `snippetId` denormalized so the UI can show which level it came from.
- An entry is written only if the new run is `verified` **and** beats the stored `netWpm`; otherwise the run is still persisted for history but the aggregate is untouched.
- Entries denormalize `displayName` and `photoURL` so leaderboard reads never fan out to `users`. A profile change refreshes them lazily on next submission.
- Leaderboard queries read these aggregate collections, never `runs`. Composite indexes are created alongside the queries, not at deploy time.

### 4.8 Database Schema (Firestore)
```typescript
// users/{uid}
interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
  createdAt: number;
}

// snippets/{snippetId}  — seeded from content/snippets/, client write-denied
interface Snippet {
  id: string;
  title: string;
  difficulty: 'easy' | 'medium' | 'hard';
  language: 'css' | 'svg' | 'javascript';
  targetCode: string;
  billableLength: number;     // typed characters only; excludes auto-skipped indentation (§4.2)
  initialStageHTML: string;   // trusted: curated in-repo and code-reviewed, never user input
  checkpoints: number[];      // JS only; character offsets safe to execute at (§4.4)
  tokens: HighlightToken[];   // precomputed by Shiki at seed time (§4.11)
  authorUid: string;          // attribution/credit only, carries no write permission
}

interface HighlightToken {
  start: number;              // inclusive offset into targetCode
  end: number;                // exclusive
  light: string;              // hex color for the light theme
  dark: string;               // hex color for the dark theme
}

// runs/{runId}  — created only by the server; client write-denied
interface RunRecord {
  id: string;
  userId: string;
  snippetId: string;
  grossWpm: number;           // all metrics server-recomputed from telemetry
  netWpm: number;
  accuracy: number;
  elapsedMs: number;
  totalErrors: number;
  verified: boolean;          // false = failed a heuristic, excluded from aggregates
  flags: string[];            // e.g. ['low-variance', 'sub-8ms-window']
  createdAt: number;          // server timestamp; client clocks are not trusted
}

// leaderboardEntries/{snippetId}__{uid} and globalEntries/{uid}
interface LeaderboardEntry {
  uid: string;
  snippetId: string;
  displayName: string;        // denormalized for read-only leaderboard queries
  photoURL: string;
  netWpm: number;
  grossWpm: number;
  accuracy: number;
  runId: string;
  achievedAt: number;
}
```

### 4.9 Device Gating
- The game arena (`(game)/play/[id]`) requires a physical keyboard. When `matchMedia('(pointer: coarse)')` matches and no fine pointer is available, or the viewport is under 1024px wide, the route renders the `DesktopRequired` interstitial instead of the arena.
- The gate is a deliberate, explanatory screen — not a broken layout and not a silent redirect. It links to the leaderboard so mobile visitors still have somewhere to go.
- Login, leaderboard, and marketing routes remain fully responsive.
- Detection is heuristic; a detached-keyboard tablet user gets an "enter anyway" escape hatch. Runs started through that hatch are submitted normally — no separate score class.

### 4.10 Firestore Security Rules (intent)
- `snippets`: public read; **all writes denied** to every client. Populated only by `scripts/seedSnippets.ts` via the Admin SDK, which bypasses rules.
- `runs`: public read; `create`, `update`, and `delete` **denied** to every client. Written only by the submit route via the Admin SDK.
- `leaderboardEntries`, `globalEntries`: public read; **all client writes denied**. Server-maintained only.
- `users/{uid}`: read public; write allowed only where `request.auth.uid == uid`, restricted to the profile fields above.
- Rules must be covered by emulator tests asserting that a direct client write to `runs`, `snippets`, or either leaderboard collection fails.

### 4.11 Editor Rendering & Syntax Highlighting
The editor viewport is the single largest performance risk in the product: it must move a caret at 60 FPS while a keystroke lands every ~80ms. The rule is that **nothing is re-tokenized, re-parsed, or re-laid-out during a run.**

- **Highlighting happens at seed time, never at runtime.** `scripts/seedSnippets.ts` runs Shiki's `codeToTokens` over `targetCode` with a light/dark theme pair and stores the flat `HighlightToken[]` on the manifest (§4.8). `shiki` is a **devDependency** and must never appear in a client bundle.
- Colors are emitted as inline `--tok-light` / `--tok-dark` custom properties on each span, with a single CSS rule selecting between them by theme. This keeps one static DOM for both themes.
- **One span per character.** On mount, `targetCode` renders to a static list of character spans, each tagged with its highlight color and a state class (`pending`). At 1,000 characters this DOM is built exactly once.
- **A keystroke mutates at most two spans' `className`** (`pending` → `typed`, or → `error`). No React re-render of the snippet; the editor subscribes to Zustand with a selector that returns the cursor index only, and span mutation is done imperatively in a `useEffect` against a ref array.
- **Caret is a separate absolutely-positioned element.** Its position comes from a `{left, top}` table measured once after mount (and on resize) by reading each span's `offsetLeft` / `offsetTop`. Moving the caret is a `transform: translate()` — never a layout read during the run.
- Auto-skipped leading whitespace (§4.2) renders with a `skipped` class: visible, dimmed, and never assigned a state.
- The error-shake animation runs on the editor container via a CSS class toggle, so it cannot force per-character style recalculation.

### 4.12 Code Analysis Toolchain
`checkpoints.ts` and `loopGuard.ts` share one parser. Both run at **seed time or immediately before an iframe execution**, never in the per-keystroke hot path.

- **Parser: `acorn`.** Small, standard ESTree output, and its `Node.start` / `Node.end` offsets map directly onto the character offsets the game already uses for the cursor.
- **Editor: `magic-string`.** The loop guard inserts a counter into existing source rather than regenerating it, so no code generator dependency is needed and the output stays recognizable when debugging.
- `checkpoints.ts`: parse `targetCode`, walk `Program.body`, and emit `node.end` for each top-level statement. These are exactly the offsets at which a prefix is guaranteed to parse.
- `loopGuard.ts`: for each `ForStatement` / `ForInStatement` / `ForOfStatement` / `WhileStatement` / `DoWhileStatement`, insert a budget check at the top of the body. A non-block body (`while (x) foo();`) is wrapped in braces by the same `magic-string` pass. The counter is declared in a scope the snippet cannot reach, and exceeding the budget throws a normal `Error` that the iframe's existing handler catches.
- Both modules are pure `(source: string) => T` functions with no DOM dependency, so they are Vitest-testable and reusable by the seed script.

### 4.13 Run Token Lifecycle
Single-use cannot be achieved with a signature alone — a stateless token is replayable until it expires. The design therefore uses two layers, so the cheap check rejects forgeries before any database read happens.

1. **Signature (stateless, first line).** `POST /api/runs/start` returns `base64url(payload) + '.' + HMAC_SHA256(payload, RUN_TOKEN_SECRET)` where the payload is `{ uid, snippetId, serverStartMs, nonce, expiresAt }`. `nonce` is a `crypto.randomUUID()`. On submit, a bad signature or an expired `expiresAt` is rejected immediately with no Firestore access.
2. **Redemption record (stateful, single-use guarantee).** `/start` also writes `runTokens/{nonce}` with `{ uid, snippetId, serverStartMs, expiresAt, status: 'issued' }`. `/submit` flips `status` to `'redeemed'` inside the **same transaction** that writes the run and updates the leaderboard aggregate; a document that is missing or already `'redeemed'` aborts the whole submission.

- `expiresAt` is 30 minutes from issuance — comfortably longer than any legitimate run, short enough to bound the collection.
- A Firestore **TTL policy on `runTokens.expiresAt`** reclaims the documents automatically; no cleanup job.
- `runTokens` is fully client-denied for read and write in `firestore.rules`.
- `RUN_TOKEN_SECRET` is server-only and must never be referenced from a `NEXT_PUBLIC_` variable.

### 4.14 Environment Variables
Client (`NEXT_PUBLIC_`-prefixed, safe to expose — Firebase web config is public by design and is secured by rules, not secrecy):

```
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
```

Server-only (never `NEXT_PUBLIC_`, never imported from a client component):

```
FIREBASE_ADMIN_PROJECT_ID
FIREBASE_ADMIN_CLIENT_EMAIL
FIREBASE_ADMIN_PRIVATE_KEY     # newlines escaped as \n
RUN_TOKEN_SECRET               # HMAC key for §4.13; rotate invalidates in-flight runs only
ADMIN_UIDS                     # comma-separated uids allowed to review flagged runs; empty = nobody
```

`.env.example` tracks this list and is the file kept in version control; `.env.local` never is.

---

## 5. Development Workflow
- Local development: `npm run dev`
- Run unit/engine tests: `npm run test`
- Run browser/input tests: `npm run test:e2e`
- Seed curated snippets: `npm run seed:snippets`
- Deploy Firestore rules: `firebase deploy --only firestore:rules`

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
