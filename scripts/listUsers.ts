/**
 * Lists Firebase Auth accounts so a uid can be copied into `ADMIN_UIDS`
 * (PLAN 4.1).
 *
 * A uid does not exist until its owner signs in once — there is no way to
 * mint one ahead of time, which is why this prints instructions rather than an
 * empty table when nobody has signed in yet.
 */
import { getAdminAuth } from "../src/server/adminApp";

const PAGE_SIZE = 50;

async function main() {
  const { users } = await getAdminAuth().listUsers(PAGE_SIZE);

  if (users.length === 0) {
    console.log("No accounts yet.\n");
    console.log("A uid is created by signing in, so:");
    console.log("  1. npm run dev");
    console.log("  2. open http://localhost:3000/login and sign in with Google");
    console.log("  3. run this again\n");
    console.log("localhost is an authorized domain by default, so this works before any deploy.");
    return;
  }

  const width = Math.max(...users.map((user) => user.uid.length));
  console.log(`${users.length} account(s):\n`);
  for (const user of users) {
    const admin = process.env.ADMIN_UIDS?.split(",").map((uid) => uid.trim()).includes(user.uid);
    console.log(
      `  ${user.uid.padEnd(width)}  ${(user.email ?? "(no email)").padEnd(28)}` +
        `${user.displayName ?? ""}${admin ? "  [admin]" : ""}`,
    );
  }

  console.log(`\nTo grant review access, set in .env.local (and in the host's env for production):`);
  console.log(`  ADMIN_UIDS=${users[0].uid}`);
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exit(1);
});
