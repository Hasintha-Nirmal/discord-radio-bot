# 📻 Sri Lankan Radio Discord Bot

A feature-rich Discord bot that streams Sri Lankan radio stations directly into your voice channels — 24/7, via Docker.

## ✨ Features

- 🎵 **6 Sri Lankan Stations** — Hiru FM, Sirasa FM, Neth FM, Sooriyan FM, Gold FM, Shaa FM
- 🔁 **Fallback URLs** — Automatically retries with a backup stream if primary fails
- 🎨 **Beautiful Embeds** — Rich Discord embeds with station colors, logos, and genres
- 🔄 **Rotating Status** — Bot status rotates between station info
- 🐳 **Docker 24/7** — Runs continuously with auto-restart
- 🛡️ **Permission Checks** — Handles missing bot permissions gracefully

## 🤖 Commands

| Command | Description |
|---|---|
| `!play <station>` | Play a radio station |
| `!stop` | Stop and disconnect |
| `!list` | List all stations |
| `!now` | Show currently playing station |
| `!ping` | Bot latency and uptime |
| `!help` | Show all commands |

## 📻 Stations

| Key | Station | Frequency |
|---|---|---|
| `hiru` | Hiru FM | 100.9 FM |
| `sirasa` | Sirasa FM | 99.7 FM |
| `neth` | Neth FM | 97.4 FM |
| `sooriyan` | Sooriyan FM | 93.3 FM |
| `gold` | Gold FM | 89.0 FM |
| `shaa` | Shaa FM | 101.0 FM |

## 🚀 Setup

### 1. Create a Discord Bot
1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application → Bot → Copy the Token
3. Enable **Message Content Intent** under Privileged Gateway Intents

### 2. Configure the Bot
```bash
cp .env.example .env
# Edit .env and paste your BOT_TOKEN
```

### 3. Run with Docker (Recommended — 24/7)
```bash
docker-compose up -d --build
# Check logs:
docker-compose logs -f
```

### 4. Run Locally (Development)
```bash
npm install
npm start
```

## ➕ Adding New Stations
Edit `stations.json` — no code changes needed!
```bash
docker-compose restart   # after editing stations.json
```

## 📝 Notes
- Stream URLs may change over time. Update `stations.json` if a station stops working.
- The bot uses `ffmpeg` to transcode audio streams.
