import { pathToFileURL } from 'node:url';

import { sql } from '../src/db/client.js';
import { executeCleanup, planCleanup } from '../src/lib/cleanup-screencasters.js';

import { PROTECTED_ACCOUNT_MARKERS } from './reconcile-run.js';

// Mariem 05/11 — « Nettoyage des comptes Screencasters (test et production) ». The rules live in
// src/lib/cleanup-screencasters.ts (operator ruling 3A: an account that never aired is deleted
// completely; one whose campaigns aired keeps them, the rest goes and the account is deactivated).
// DRY-RUN BY DEFAULT: it prints the plan, account by account, and writes NOTHING.
//
// Usage:  pnpm --filter @toodooh/api cleanup:screencasters
//         ... -- --include-demo                       (demo accounts too — sales use them)
//         ... -- --execute --by <superadmin-user-id> [--include-demo]

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const includeDemo = args.includes('--include-demo');
  const execute = args.includes('--execute');
  const byIndex = args.indexOf('--by');
  const by = byIndex >= 0 ? args[byIndex + 1] : undefined;

  const plans = await planCleanup({ includeDemo, protectedMarkers: PROTECTED_ACCOUNT_MARKERS });
  console.log(
    `${plans.length} screencaster account(s)${includeDemo ? ', demo included' : ', demo left out'}:`,
  );
  for (const p of plans) {
    console.log(
      `  ${p.kind === 'delete' ? 'DELETE    ' : 'DEACTIVATE'} ${p.label}${p.demo ? ' (démo)' : ''} [${p.status}]` +
        ` — stop ${p.live.length}, reject ${p.pending.length}, delete ${p.purge.length}` +
        (p.kept > 0 ? `, keep ${p.kept} aired` : ''),
    );
  }
  if (!execute) {
    console.log('DRY RUN — nothing written. Re-run with --execute --by <superadmin-user-id>.');
    return;
  }
  if (!by) throw new Error('--execute needs --by <superadmin-user-id>');
  const report = await executeCleanup(plans, { adminId: by });
  console.log(JSON.stringify(report, null, 2));
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then(() => sql.end())
    .catch(async (err: unknown) => {
      console.error(err);
      await sql.end();
      process.exit(1);
    });
}
