/**
 * TEMPORARY DEV FILE (safe to delete with the rest of the topple-* harness).
 *
 * Headless solver check. Run with:  npx tsx src/dev/topple-stability.ts
 * Exits non-zero if any stability check fails.
 */
import {
  formatStabilityReport,
  runStabilityChecks,
} from '../modes/topple/physics/stability';

const results = runStabilityChecks();
console.log(formatStabilityReport(results));
if (results.some((r) => !r.pass)) {
  // No @types/node in this project, so reach for the exit through globalThis.
  (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1;
}
