# linkedin-agent — Quickstart

Use these commands to call your deployed endpoints and (optionally) write outputs to local files.

## Health check
    curl -sS https://linkedin-agent-kozf.onrender.com/healthz

## Prompt Context (brand/company/design)
    curl -sS "https://linkedin-agent-kozf.onrender.com/v1/prompt-context?select=brand,company,design"

## Knowledge (raw + packs)
    curl -sS https://linkedin-agent-kozf.onrender.com/v1/knowledge
    curl -sS "https://linkedin-agent-kozf.onrender.com/v1/packs?select=brand,company"

## Writer API (outputs saved to local files)

### Blog → writes blog.md
    curl -sS -X POST "https://linkedin-agent-kozf.onrender.com/v1/write" \
      -H "Content-Type: application/json" \
      -d '{"type":"blog","topic":"3 hidden profit leaks in ecommerce analytics","audience":"Ecommerce founders","length":"short"}' \
    | python3 -c 'import sys,json,pathlib as p; t=json.load(sys.stdin)["text"]; p.Path("blog.md").write_text(t+"\n", encoding="utf-8"); print("Wrote blog.md")'

### Webpage → writes webpage.md
    curl -sS -X POST "https://linkedin-agent-kozf.onrender.com/v1/write" \
      -H "Content-Type: application/json" \
      -d '{"type":"webpage","topic":"Bark AI — Profit clarity without vanity metrics","length":"short"}' \
    | python3 -c 'import sys,json,pathlib as p; t=json.load(sys.stdin)["text"]; p.Path("webpage.md").write_text(t+"\n", encoding="utf-8"); print("Wrote webpage.md")'

### Sales → writes sales.md
    curl -sS -X POST "https://linkedin-agent-kozf.onrender.com/v1/write" \
      -H "Content-Type: application/json" \
      -d '{"type":"sales","topic":"Why switch to Bark AI from generic dashboards","audience":"COO at mid-market DTC","length":"short"}' \
    | python3 -c 'import sys,json,pathlib as p; t=json.load(sys.stdin)["text"]; p.Path("sales.md").write_text(t+"\n", encoding="utf-8"); print("Wrote sales.md")'

## Notes
- The `/v1/write` response includes `knowledge_version` for traceability.
- `blog.md`, `webpage.md`, and `sales.md` are generated locally; commit them if you want them in the repo.
