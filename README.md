# PvP Server List — Watcher

Standalone Node.js process that pings all Minecraft servers via UDP SLP protocol and updates their live status in Supabase.

## Setup

```bash
cp .env.example .env
# Edit .env with your Supabase credentials
npm install
npm run build
npm start
```

## Deploy to VPS

### Option 1: PM2 (recommended)

```bash
npm install -g pm2
pm2 start dist/cron.js --name pvpserverlist-watcher
pm2 save
pm2 startup
```

### Option 2: systemd

```bash
sudo cp pvpserverlist-watcher.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable pvpserverlist-watcher
sudo systemctl start pvpserverlist-watcher
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase service role key |

## How it works

- Fetches all servers from Supabase `servers` table
- Pings each server via Minecraft SLP (Server List Ping) protocol on UDP
- Upserts status to `server_status` table every 5 minutes
- Runs indefinitely with 5-minute intervals between cycles
