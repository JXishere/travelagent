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

Try deployment in this order:

**Option A: Railway MCP** (preferred)
- Use the Railway MCP server to deploy the service

**Option B: Railway CLI** (fallback)
```bash
railway up
```

### 4. Verify Deployment

After deployment completes:
- Check the deployment status via Railway MCP or `railway status`
- Hit the `/health` endpoint to verify the server is responding:
```bash
curl -s https://<your-railway-domain>/health
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
