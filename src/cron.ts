/**
 * Cron runner — calls the watcher every 5 minutes.
 * Usage: npm start (runs indefinitely)
 */

import { runWatcherCycle } from "./index";

const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

async function run() {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] Cron: starting watcher cycle`);
  try {
    const { online, offline, errors } = await runWatcherCycle();
    console.log(`[${new Date().toISOString()}] Cron: cycle complete — online=${online}, offline=${offline}, errors=${errors.length}`);
  } catch (err: unknown) {
    const error = err as { message?: string };
    console.error(`[${new Date().toISOString()}] Cron: error —`, error?.message ?? err);
  }
}

// Run immediately on start
run();

// Then every 5 minutes
setInterval(run, INTERVAL_MS);

console.log(`Watcher cron started — will run every ${INTERVAL_MS / 1000 / 60} minutes`);
