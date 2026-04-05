/**
 * Minecraft Server Watcher
 * Fetches server status via mcsrvstat.us API and upserts to Supabase.
 */

import { createClient } from "@supabase/supabase-js";
import https from "https";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;

const TIMEOUT_MS = 8000;
const BATCH_SIZE = 20;
const CONCURRENCY = 5;

// ─── HTTP Fetch ─────────────────────────────────────────────────────────────

function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { "User-Agent": "PvPServerList-Watcher/1.0" },
      timeout: TIMEOUT_MS,
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error("Invalid JSON"));
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Timeout"));
    });
  });
}

// ─── Supabase ───────────────────────────────────────────────────────────────

interface Server {
  id: string;
  ip: string;
  port: number;
  name: string;
}

async function fetchAllServers(): Promise<Server[]> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const servers: Server[] = [];
  let page: Server[] = [];
  let offset = 0;

  do {
    const { data } = await supabase
      .from("servers")
      .select("id, ip, port, name")
      .order("created_at", { ascending: true })
      .range(offset, offset + 999);

    page = (data as Server[]) ?? [];
    servers.push(...page);
    offset += 1000;
  } while (page.length === 1000);

  return servers;
}

async function upsertServerStatus(
  supabase: any,
  serverId: string,
  status: boolean,
  latencyMs: number | null,
  playerCount: number,
  maxPlayers: number,
  motd: string
): Promise<void> {
  await (supabase as any).from("server_status").upsert(
    {
      server_id: serverId,
      status,
      latency_ms: latencyMs,
      player_count: playerCount,
      max_players: maxPlayers,
      motd,
      last_checked: new Date().toISOString(),
    },
    { onConflict: "server_id" }
  );
}

// ─── Server Status via mcsrvstat.us ────────────────────────────────────────

interface PingResult {
  status: boolean;
  latency_ms: number | null;
  player_count: number;
  max_players: number;
  motd: string;
}

async function pingServer(ip: string, port: number): Promise<PingResult> {
  const url = `https://api.mcsrvstat.us/3/${ip}:${port}`;
  try {
    const data = await fetchJson(url);
    if (!data?.online) {
      return { status: false, latency_ms: null, player_count: 0, max_players: 0, motd: "" };
    }
    const latency = data.debug?.ping ?? null;
    const motd = data.motd?.clean?.[0] ?? data.motd?.html?.[0] ?? "";
    const players = data.players?.online ?? 0;
    const maxPlayers = data.players?.max ?? 0;
    return { status: true, latency_ms: latency, player_count: players, max_players: maxPlayers, motd };
  } catch {
    return { status: false, latency_ms: null, player_count: 0, max_players: 0, motd: "" };
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

export async function runWatcherCycle(): Promise<{ online: number; offline: number; errors: string[] }> {
  console.log(`[${new Date().toISOString()}] Watcher: starting cycle...`);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const servers = await fetchAllServers();
  console.log(`Watcher: found ${servers.length} servers to check`);

  let online = 0, offline = 0;
  const errors: string[] = [];

  // Process in batches with controlled concurrency
  for (let i = 0; i < servers.length; i += BATCH_SIZE * CONCURRENCY) {
    const batch = servers.slice(i, i + BATCH_SIZE * CONCURRENCY);

    const chunkResults = await Promise.all(
      batch.map(async (server) => {
        try {
          const result = await pingServer(server.ip, server.port);
          return { server, result, error: null };
        } catch (err) {
          return { server, result: null, error: String(err) };
        }
      })
    );

    // Upsert in smaller sub-batches to avoid overwhelming Supabase
    for (let j = 0; j < chunkResults.length; j += BATCH_SIZE) {
      const subBatch = chunkResults.slice(j, j + BATCH_SIZE);

      await Promise.all(
        subBatch.map(async ({ server, result, error }) => {
          if (error || !result) {
            errors.push(`Error checking ${server.name}: ${error}`);
            return;
          }
          try {
            await upsertServerStatus(
              supabase,
              server.id,
              result.status,
              result.latency_ms,
              result.player_count,
              result.max_players,
              result.motd
            );
            if (result.status) {
              online++;
              console.log(`  ✓ ${server.name} (${server.ip}) — ${result.player_count}/${result.max_players} players${result.latency_ms ? `, ${result.latency_ms}ms` : ""}`);
            } else {
              offline++;
              console.log(`  ✗ ${server.name} (${server.ip}) — offline`);
            }
          } catch (err) {
            errors.push(`Failed to upsert ${server.name}: ${err}`);
          }
        })
      );
    }
  }

  console.log(`[${new Date().toISOString()}] Watcher: done. Online=${online}, Offline=${offline}`);
  return { online, offline, errors };
}

// Run immediately if executed directly
if (require.main === module) {
  runWatcherCycle()
    .then(({ online, offline, errors }) => {
      console.log(`Result: online=${online}, offline=${offline}, errors=${errors.length}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Watcher failed:", err);
      process.exit(1);
    });
}
