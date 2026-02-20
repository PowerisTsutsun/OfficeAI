# Company AI Desktop

A production-grade, secure AI chat desktop application for enterprise teams.

## Architecture

```
OfficeAI/
├── backend/          FastAPI backend (Python)
│   ├── app/
│   │   ├── api/       REST endpoints
│   │   ├── core/      Security, RBAC, audit logging
│   │   ├── models/    SQLAlchemy ORM
│   │   └── services/  AI Gateway, rate limiter
│   └── migrations/   PostgreSQL migrations
└── desktop/          Tauri desktop app
    ├── src/          React + TypeScript frontend
    │   ├── components/
    │   ├── store/    Zustand state management
    │   ├── lib/      API client
    │   └── types/    TypeScript types
    └── src-tauri/    Rust Tauri backend
```

## Prerequisites

| Tool | Version |
|---|---|
| Node.js | ≥ 20 |
| Rust | ≥ 1.77 |
| Python | ≥ 3.11 |
| PostgreSQL | ≥ 16 |
| Redis | ≥ 7 |

## Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env with your settings

# Generate JWT keys
openssl genrsa -out jwt_private.pem 4096
openssl rsa -in jwt_private.pem -pubout -out jwt_public.pem
# Paste contents into .env as JWT_PRIVATE_KEY and JWT_PUBLIC_KEY

# Generate encryption key
python -c "import base64, os; print(base64.b64encode(os.urandom(32)).decode())"
# Paste into .env as MASTER_ENCRYPTION_KEY

# Run database migrations
psql -U postgres -c "CREATE DATABASE company_ai;"
psql -U postgres -d company_ai -f migrations/001_initial.sql

# Start development server
uvicorn app.main:app --reload --port 8000
```

## Desktop Setup

```bash
cd desktop

# Install dependencies
npm install

# Configure environment
echo "VITE_API_BASE_URL=http://localhost:8000/api/v1" > .env

# Run in browser (development, no Tauri)
npm run dev

# Run as Tauri desktop app (requires Rust + system deps)
npm run tauri:dev

# Build production binary
npm run tauri:build
```

## Environment Variables

See [backend/.env.example](backend/.env.example) for all required variables.

## Security Model

- **Auth**: Magic link (SHA-256 hashed, 10-min expiry) + optional OIDC SSO
- **Sessions**: RS256 JWT (15-min access) + bcrypt refresh tokens (7-day, rotating)
- **Encryption**: AES-256-GCM for all chat messages (per-user derived keys)
- **API keys**: Never leave the backend server
- **Audit logs**: SHA-256 hash chain, append-only, no prompt content
- **RBAC**: Enforced server-side, roles re-checked from DB on every request

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `⌘/Ctrl+K` | Command palette |
| `⌘/Ctrl+N` | New chat |
| `⌘/Ctrl+\` | Toggle sidebar |
| `⌘/Ctrl+]` | Toggle settings panel |
| `⌘/Ctrl+Enter` | Send message |
| `⌘/Ctrl+.` | Stop streaming |
| `Esc` | Close modal |

## Adding New AI Models

No client redeploy needed. Use the admin API:

```bash
curl -X POST http://localhost:8000/api/v1/admin/models \
  -H "Authorization: Bearer $SUPER_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "provider_id": "<openai-provider-id>",
    "model_id": "gpt-4o-2025-01-15",
    "display_name": "GPT-4o (Jan 2025)",
    "context_window": 128000,
    "is_enabled": true
  }'
```

## Testing

```bash
# Backend unit + integration tests
cd backend && pytest --cov=app tests/

# Frontend unit tests
cd desktop && npm test

# E2E tests
cd desktop && npm run test:e2e
```

## Production Checklist

- [ ] Set `APP_ENV=production` (disables API docs, debug mode)
- [ ] Configure real SMTP for magic links
- [ ] Set up Vault / AWS SM / Azure KV for API key storage
- [ ] Enable PostgreSQL SSL connections
- [ ] Configure Redis AUTH and TLS
- [ ] Set up log shipping to SIEM
- [ ] Configure audit log S3 export (WORM)
- [ ] Review and tighten CORS `ALLOWED_ORIGINS`
- [ ] Set up DB backup + point-in-time recovery
- [ ] Configure rate limit values for your user base
- [ ] Set `ALLOWED_EMAIL_DOMAINS` to your actual domain(s)
- [ ] Sign Tauri updater with your code signing certificate
- [ ] Run `npm audit` + `pip-audit` before each release

## License

Proprietary. See LICENSE.
