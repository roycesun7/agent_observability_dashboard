# 🔭 Agent Observatory

Real-time observability dashboard for OpenClaw AI agents.

![Dashboard Preview](https://img.shields.io/badge/Status-Active-brightgreen)

## Features

- **Live Metrics** - Token usage, costs, session status
- **Session Tracking** - View all active and recent sessions
- **Auto-Refresh** - Updates every 5 seconds
- **Token Visualization** - Bar chart of usage by session

## Quick Start

```bash
# Install dependencies
npm install

# Start API server (reads from OpenClaw session files)
npm run server

# In another terminal, start the frontend
npm run dev

# Or run both at once
npm run dev:all
```

Then open http://localhost:5174

## Configuration

The API server reads session transcripts from:
```
~/.openclaw/agents/main/sessions/*.jsonl
```

To customize, set the `SESSIONS_DIR` environment variable:
```bash
SESSIONS_DIR=/path/to/sessions npm run server
```

## Architecture

```
┌─────────────────┐     ┌─────────────────┐
│   React App     │────▶│  Express API    │
│  (port 5174)    │     │  (port 3001)    │
└─────────────────┘     └────────┬────────┘
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │  OpenClaw Session      │
                    │  Transcripts (JSONL)   │
                    └────────────────────────┘
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/sessions` | List recent sessions |
| `GET /api/sessions/:id` | Get session details |
| `GET /api/stats` | Aggregate statistics |

## Tech Stack

- **Frontend**: React 19, Vite, Tailwind CSS, TypeScript
- **Backend**: Express.js
- **Data**: OpenClaw JSONL transcripts

## License

MIT
