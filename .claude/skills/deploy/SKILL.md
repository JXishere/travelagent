---
description: Build, check, and deploy Sam to Railway
disable-model-invocation: true
allowed-tools: Bash
---

# /deploy — Build and Deploy to Railway

Deploy Sam's WhatsApp bot to Railway.

## Process

### 1. Type Check

Run the TypeScript compiler to check for errors:
```bash
npx tsc --noEmit
```

If there are type errors, stop and report them. Do not deploy broken code.

### 2. Check for Uncommitted Changes

Run `git status` to check for uncommitted changes.

If there are uncommitted changes:
- Show the user what's changed (`git diff --stat`)
- Ask if they want to commit before deploying
- If yes, create a descriptive commit

### 3. Deploy

Before deploying, confirm the target environment with the user if not already clear. Default is **production**.

| Environment | Command | URL |
|-------------|---------|-----|
| production | `railway up --service "@sam/bot"` | `https://sambot-production-6ab1.up.railway.app` |
| development | `railway up --service "@sam/bot" --environment development` | `https://sambot-development.up.railway.app` |

Try deployment in this order:

**Option A: Railway MCP** (preferred)
- Use the Railway MCP `deploy` tool with the appropriate `environment` parameter

**Option B: Railway CLI** (fallback)
```bash
# Production (default)
railway up --service "@sam/bot"

# Development
railway up --service "@sam/bot" --environment development
```

### 4. Verify Deployment

After deployment completes:
- Check the deployment status via Railway MCP or `railway status`
- Hit the `/health` endpoint to verify the server is responding:
```bash
# Production
curl -s https://sambot-production-6ab1.up.railway.app/health
# Development
curl -s https://sambot-development.up.railway.app/health
```
- Report the deployment URL and status

### 5. Report

```
## Deploy Report
- Type check: ✓ passed
- Commit: [committed / no changes / skipped]
- Deploy: ✓ succeeded
- Health check: ✓ responding
- URL: https://...
```

## Troubleshooting

- If Railway CLI is not installed: `npm install -g @railway/cli` then `railway login`
- If deploy fails, check logs: `railway logs` or via Railway MCP
- If health check fails, check logs for startup errors
