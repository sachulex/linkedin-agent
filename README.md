# Marketing Automation — Agent Backend

Cloud-hosted API that generates marketing posts (starting with **LinkedIn**), learns from feedback, and exposes simple endpoints for low-code frontends (e.g., **Base44**).

- **Prod URL:** https://linkedin-agent-kozf.onrender.com  
- **Repo:** https://github.com/sachulex/linkedin-agent  
- **Stack:** Node.js + TypeScript + Express • Neon Postgres • OpenAI (text) • Render (hosting)

> Images are **off by default** (`image_count: 0`) until the OpenAI org has access to `gpt-image-1`.

---

## Overview

- **Workflow(s):** `linkedin_post_v1` (extensible to more, e.g., `twitter_post_v1`)
- **Persistence:** `runs` table stores inputs/status/outputs; `style_memories` stores brand voice/style
- **Frontend:** Base44 calls this API via HTTPS (no local server required)

### High-level flow

Base44 UI ──► POST /v1/runs ──► (OpenAI) ──► save outputs to DB  
◄── GET /v1/runs/:id ◄────────────── poll until SUCCEEDED  
──► POST /v1/feedback ───────────────► update style_memories  
──► GET/POST /v1/style ──────────────► read/write style profile

---

## Project Layout

/ (repo root)  
• README.md  
• package.json  
• tsconfig.json  
• .env.example (sample, **no secrets**)  
• /src  
  • server.ts — Express app & routes (/healthz, /v1/runs, /v1/style, /v1/feedback)  
  • agent.ts — workflow logic (linkedin_post_v1) + OpenAI calls  
  • db.ts — Postgres client + initDb + helpers  
  • prompts.ts — prompt builders (text/image)

---

## Environment Variables

Set these in **Render → Environment**. For local dev, create a `.env` (do **not** commit).

OPENAI_API_KEY=sk-...  
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DB?sslmode=require&channel_binding=require  
PORT=8080

(Secrets live in Render. `.env` is ignored in git.)

---

## NPM Scripts

- `npm run dev` — local dev (nodemon + ts-node @ http://localhost:8080)  
- `npm run build` — compile TypeScript to `dist/`  
- `npm start` — run compiled server (`node dist/server.js`) — used by Render

---

## API

### Health
GET /healthz → `ok`

### Start a run (generate post)
POST /v1/runs  
Content-Type: application/json

{
  "workflow": "linkedin_post_v1",
  "inputs": {
    "topic": "3 ways of increasing profits without increasing media spend",
    "audience": "Ecommerce founders",
    "tone": "casual yet professional",
    "length": "short",
    "image_count": 0,
    "seed": 12345
  }
}

Response → `{ "run_id": "UUID" }`

### Get a run
GET /v1/runs/:id  
Response includes:
- `status`: QUEUED | RUNNING | SUCCEEDED | FAILED  
- `outputs`: { post, alt_text, hashtags[], images[] }

### Style profile
GET /v1/style → returns:
{
  "voice_rules": { "avoid_words": ["boost"], "prefer_words": ["profit clarity"] },
  "post_structure": { "hook": true, "one_liners": true },
  "image_style": { "character_name": "Brand Mascot", "palette": ["#ea43e3","#43eae4"], "seed": 12345 }
}

POST /v1/style  
Content-Type: application/json

{
  "voice_rules": { ... },
  "post_structure": { ... },
  "image_style": { ... }
}

Response → `{ "ok": true }`

### Feedback
POST /v1/feedback  
Content-Type: application/json

{
  "run_id": "UUID",
  "items": [
    { "target": "post", "dimension": "tone", "score": 2, "note": "More playful; no buzzwords." }
  ]
}

Response → `{ "ok": true }`

---

## Database (Neon)

Tables used:

**runs**  
- id UUID PRIMARY KEY  
- status TEXT  
- inputs JSONB  
- outputs JSONB  
- created_at TIMESTAMPTZ DEFAULT now()

**style_memories**  
- org_id TEXT (we use 'demo')  
- key TEXT in ('voice_rules','post_structure','image_style')  
- value JSONB  
- weight INT DEFAULT 1  
- updated_at TIMESTAMPTZ DEFAULT now()  
- Unique index `(org_id, key)`

---

## Base44 Wiring (summary)

- Generate → POST /v1/runs, then poll GET /v1/runs/:id until `SUCCEEDED`
- Styles panel → GET /v1/style and POST /v1/style
- Feedback → POST /v1/feedback

---

## Deploy (Render)

1) Create a **Web Service** from this GitHub repo  
2) Build Command: `npm run build`  
3) Start Command: `npm start`  
4) Env vars: `OPENAI_API_KEY`, `DATABASE_URL`, `PORT=8080`  
5) When status is **Live**, verify `GET /healthz` → `ok`

---

## Quick cURL Tests

# Health
curl -sS https://linkedin-agent-kozf.onrender.com/healthz

# Create run
curl -sS -X POST https://linkedin-agent-kozf.onrender.com/v1/runs \
  -H "Content-Type: application/json" \
  -d '{"workflow":"linkedin_post_v1","inputs":{"topic":"3 ways of increasing profits without increasing media spend","audience":"Ecommerce founders","tone":"casual yet professional","length":"short","image_count":0}}'

# Get run
curl -sS https://linkedin-agent-kozf.onrender.com/v1/runs/RUN_ID_HERE

# Feedback
curl -sS -X POST https://linkedin-agent-kozf.onrender.com/v1/feedback \
  -H "Content-Type: application/json" \
  -d '{"run_id":"RUN_ID_HERE","items":[{"target":"post","dimension":"tone","score":2,"note":"More playful; no buzzwords."}]}'

# Style
curl -sS https://linkedin-agent-kozf.onrender.com/v1/style
curl -sS -X POST https://linkedin-agent-kozf.onrender.com/v1/style \
  -H "Content-Type: application/json" \
  -d '{"voice_rules":{"avoid_words":["boost"],"prefer_words":["profit clarity"]},"post_structure":{"hook":true,"one_liners":true},"image_style":{"character_name":"Brand Mascot","palette":["#ea43e3","#43eae4"],"seed":12345}}'

---

## Troubleshooting

- `403 gpt-image-1` → keep `"image_count": 0` until org image access is enabled  
- `404 /v1/style` → push latest code; “Clear cache & deploy” on Render  
- UI can’t reach API → ensure Base44 uses the Render URL above  
- DB errors → verify `DATABASE_URL` set in Render

---

## License

Private project.
