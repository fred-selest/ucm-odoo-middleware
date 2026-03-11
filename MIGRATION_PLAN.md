# 📋 Migration Plan: AMI → Webhook Mode

## Overview

Complete plan to migrate from AMI mode to Webhook (Action URL) mode for UCM ↔ Odoo middleware.

---

## Current State (Before Migration)

### Infrastructure
- **UCM**: IP 192.168.10.100, port 5039 (AMI mode)
- **Middleware**: Node.js on `/opt/stacks/ucm-odoo-middleware`
- **Network**: Direct network access required (VPN or firewall rules)
- **Configuration**: `.env` with AMI credentials

### Problems
- ❌ Requires VPN or port forwarding (riskier)
- ❌ Only one UCM supported per middleware instance
- ❌ Complex firewall rules for each client
- ❌ Less flexible for multi-client deployments

---

## Target State (After Migration)

### Infrastructure
- **UCM**: Same IP, but uses Action URL (HTTPS outbound)
- **Middleware**: Webhook mode, token-based client isolation
- **Network**: Outbound HTTPS only (no firewall needed)
- **Configuration**: `.env` with `UCM_MODE=webhook`

### Benefits
- ✅ No VPN or port forwarding needed
- ✅ Multiple clients with unique tokens
- ✅ Simpler deployment for remote clients
- ✅ Better security model (tokens in URL, HTTPS)

---

## Implementation Steps

### Step 1: Update Configuration Files

#### A. `.env` File

**File**: `/opt/stacks/ucm-odoo-middleware/.env`

**BEFORE** (current):
```env
UCM_HOST=192.168.10.100
UCM_AMI_PORT=5039
UCM_AMI_USERNAME=admin_selest
UCM_AMI_SECRET=@Selestinfo67
```

**AFTER** (webhook mode):
```env
# DISABLED - Using Webhook mode instead
# UCM_HOST=192.168.10.100
# UCM_AMI_PORT=5039
# UCM_AMI_USERNAME=admin_selest
# UCM_AMI_SECRET=@Selestinfo67

# ── UCM Webhook Mode Configuration ────────────────────────────────────────
# UCM_HOST (optional, only for admin panel to pre-fill UCM IPs)
# UCM_HOST=192.168.10.100
```

**Changes**:
- ✅ Comment out AMI parameters (UCM_AMI_PORT, UCM_AMI_USERNAME, UCM_AMI_SECRET)
- ✅ Keep UCM_HOST for admin panel pre-fill (not used by webhook mode)
- ✅ UCM_MODE defaults to 'ami' but is ignored in webhook-only implementation

---

#### B. `.env.example` File

**File**: `/opt/stacks/ucm-odoo-middleware/.env.example`

**BEFORE**:
```env
UCM_HOST=192.168.1.100
UCM_AMI_PORT=5038
UCM_AMI_USERNAME=admin
UCM_AMI_SECRET=your_ami_secret

# Mode de connexion UCM : 'ami' | 'websocket'
UCM_MODE=ami
```

**AFTER**:
```env
# ── UCM Mode Selection ─────────────────────────────────────────────────────
# Options: 'ami' (legacy), 'websocket', or 'webhook' (recommended)
# For Webhook mode: UCM sends HTTP GET requests - NO VPN/FIREWALL needed
UCM_MODE=webhook

# ── UCM AMI Configuration (disabled in webhook mode) ───────────────────────
# UCM_HOST=192.168.1.100
# UCM_AMI_PORT=5038
# UCM_AMI_USERNAME=admin
# UCM_AMI_SECRET=your_ami_secret

# ── UCM WebSocket Configuration (disabled in webhook mode) ─────────────────
# UCM_WEB_PORT=8089
# UCM_WEB_USER=admin
# UCM_WEB_PASSWORD=your_web_password

# ── UCM Default Settings (admin panel only - pre-fills UCM IPs) ────────────
UCM_HOST=192.168.1.100
UCM_WEB_PORT=8089
UCM_WEB_USER=admin
UCM_WEB_PASSWORD=your_web_password
```

**Changes**:
- ✅ Set `UCM_MODE=webhook` as default
- ✅ Comment out AMI and WebSocket configuration examples
- ✅ Keep UCM defaults for admin panel (optional)

---

#### C. Create Documentation

**File**: `/opt/stacks/ucm-odoo-middleware/WEBHOOK_CONFIGURATION.md`

**Contents**:
- Architecture description
- Step-by-step UCM configuration (5 minutes setup)
- Parameter reference table
- Troubleshooting guide
- Testing commands
- API reference

**Use**: Client-facing documentation for deploying webhooks.

---

### Step 2: Verify Middleware Code (No Changes Needed)

The middleware already supports webhook mode:

**Key Files**:
- `src/application/WebhookManager.js` - Manages tokens and events
- `src/index.js` - Initializes WebhookManager
- `src/config/index.js` - Loads UCM_MODE configuration
- `src/presentation/api/router.js` - `/webhook/:token` route

**Current Behavior**:
```javascript
// src/index.js:6 Edition
const ucmMode = config.ucm.mode || 'ami';
const ucmClient = ucmMode === 'websocket' ? new UcmWsClient() : new UcmClient();
const webhookManager = new WebhookManager();
```

**Webhook Route** (src/presentation/api/router.js:54):
```javascript
router.get('/webhook/:token', (req, res) => {
    const { token } = req.params;
    if (!webhookManager?.hasToken(token)) {
        return res.status(401).json({ error: 'Token invalide' });
    }
    const ok = webhookManager.processEvent(token, req.query);
    if (!ok) return res.status(400).json({ error: 'Paramètre event manquant ou inconnu' });
    res.json({ ok: true });
});
```

**No code changes required** - webhook mode already fully implemented.

---

## Configuration for Multi-Client

### Token-Based Isolation

Each client UCM gets a unique token:

```
https://ucm.selest.info/webhook/{UNIQUE-TOKEN}?event=ring&...
                                        ↑
                              32-char UUID v4
```

### Creating Tokens

1. **Access admin panel**: `https://ucm.selest.info/admin`
2. **Login** with Odoo credentials
3. **Click "Webhooks"** tab
4. **Click "Create Webhook"**
5. **Fill in**:
   - Name: `paris-office`, `client-alice`, etc.
   - UCM Host: `192.168.10.100` (optional)
   - Notes: `Alice's UCM` (optional)
6. **Save**
7. **Copy** the three generated URLs (ring, answer, hangup)

### UCM Configuration

In UCM web interface (**Settings → Integration → Action URL**):

**Ring (Incoming)**:
```
https://ucm.selest.info/webhook/a1b2c3d4-e5f6-7890-abcd-ef1234567890?event=ring&caller=${CALLERID(num)}&exten=${EXTEN}&uniqueid=${UNIQUEID}&callerid_name=${CALLERID(name)}
```

**Answer**:
```
https://ucm.selest.info/webhook/a1b2c3d4-e5f6-7890-abcd-ef1234567890?event=answer&caller=${CALLERID(num)}&exten=${EXTEN}&uniqueid=${UNIQUEID}&agent=${AGENT}
```

**Hangup**:
```
https://ucm.selest.info/webhook/a1b2c3d4-e5f6-7890-abcd-ef1234567890?event=hangup&caller=${CALLERID(num)}&exten=${EXTEN}&uniqueid=${UNIQUEID}&duration=${DURATION}
```

---

## Verification Commands

### 1. Check Middleware Status

```bash
# Health check (expected: degraded - AMI not connected)
curl https://ucm.selest.info/health

# Expected response (webhook mode):
{
  "status": "degraded",
  "ucm": false,
  "timestamp": "2026-03-10T14:30:00.000Z"
}
```

### 2. List Webhook Tokens

```bash
# Get list of all webhook tokens (requires admin auth)
curl "https://ucm.selest.info/api/webhooks" \
  -H "X-Session-Token: your-odoo-session-token"
```

### 3. Test Webhook with cURL

```bash
# Simulate RING event
curl -G "https://ucm.selest.info/webhook/a1b2c3d4-e5f6-7890-abcd-ef1234567890" \
  --data-urlencode "event=ring" \
  --data-urlencode "caller=0612345678" \
  --data-urlencode "exten=1001" \
  --data-urlencode "uniqueid=1710000000.123" \
  --data-urlencode "callerid_name=Jean+Dupont"

# Expected response:
{ "ok": true }
```

### 4. View Middleware Logs

```bash
# Real-time log monitoring
docker logs -f ucm_odoo_middleware | grep Webhook

# Expected output:
[INFO] Webhook: événement reçu { client: "paris-office", event: "ring", caller: "0612345678", exten: "1001" }
[INFO] Webhook: événement reçu { client: "paris-office", event: "answer", caller: "0612345678", exten: "1001" }
[INFO] Webhook: événement reçu { client: "paris-office", event: "hangup", caller: "0612345678", exten: "1001" }
```

---

## Testing Script

A test script is provided at `/opt/stacks/ucm-odoo-middleware/test-webhook.sh`

### Usage Examples:

```bash
# Test healthcheck
./test-webhook.sh health

# Test complete call flow
./test-webhook.sh flow

# Custom parameters
./test-webhook.sh ring -t MyToken -c 0388588621 -e 1001

# All tests
./test-webhook.sh all

# With custom middleware URL
MW_URL=http://localhost:3000 ./test-webhook.sh all
```

---

## Rollback Plan (If Needed)

If you need to revert to AMI mode:

1. **Stop middleware**:
   ```bash
   cd /opt/stacks/ucm-odoo-middleware
   docker compose down
   ```

2. **Restore `.env`** (uncomment AMI settings):
   ```env
   UCM_HOST=192.168.10.100
   UCM_AMI_PORT=5039
   UCM_AMI_USERNAME=admin_selest
   UCM_AMI_SECRET=@Selestinfo67
   ```

3. **Update `.env.example`**:
   ```env
   UCM_MODE=ami
   ```

4. **Restart middleware**:
   ```bash
   docker compose up -d
   ```

---

## Complete UCM Webhook URL Pattern

### Base URL

```
https://ucm.selest.info/webhook/{TOKEN}
```

### Query Parameters

| Parameter | Required | UCM Variable | Description |
|-----------|----------|--------------|-------------|
| `event` | ✅ | static | `ring`, `answer`, or `hangup` |
| `caller` | ✅ | `${CALLERID(num)}` | Caller phone number |
| `exten` | ✅ | `${EXTEN}` | Dialed extension |
| `uniqueid` | ✅ | `${UNIQUEID}` | Unique call ID (MUST be unique) |
| `callerid_name` | Optional | `${CALLERID(name)}` | Caller name |
| `agent` | Optional | `${AGENT}` | Agent extension (answer event) |
| `duration` | Optional | `${DURATION}` | Call duration in seconds (hangup event) |

### Complete URLs

**RING** (incoming call):
```
https://ucm.selest.info/webhook/TOKEN?event=ring&caller=${CALLERID(num)}&exten=${EXTEN}&uniqueid=${UNIQUEID}&callerid_name=${CALLERID(name)}
```

**ANSWER** (call picked up):
```
https://ucm.selest.info/webhook/TOKEN?event=answer&caller=${CALLERID(num)}&exten=${EXTEN}&uniqueid=${UNIQUEID}&agent=${AGENT}
```

**HANGUP** (call ended):
```
https://ucm.selest.info/webhook/TOKEN?event=hangup&caller=${CALLERID(num)}&exten=${EXTEN}&uniqueid=${UNIQUEID}&duration=${DURATION}
```

---

## Token Security

### How It Works

- Each UCM gets a **unique UUID v4 token** (e.g., `a1b2c3d4-e5f6-7890-abcd-ef1234567890`)
- Token stored in `data/webhooks.json` (persistent across restarts)
- Token is **authentication**: anyone with token can send events
- HTTPS protects token in transit
- No secrets transmitted

### Token Management API

```bash
# List all tokens
GET /api/webhooks

# Create new token
POST /api/webhooks
Body: { "name": "client-alice" }

# Update token
PATCH /api/webhooks/:token
Body: { "name": "paris-office", "ucmHost": "192.168.10.100" }

# Delete token (revoke)
DELETE /api/webhooks/:token
```

---

## Files Modified/Created

| File | Action | Purpose |
|------|--------|---------|
| `.env` | Modified | Comment AMI settings, keep UCM_HOST |
| `.env.example` | Modified | Set `UCM_MODE=webhook` as default |
| `WEBHOOK_CONFIGURATION.md` | Created | Client-facing configuration guide |
| `test-webhook.sh` | Created | Script to simulate UCM webhooks |
| `WEBHOOK_DEPLOYMENT_PLAN.md` | Existing | Detailed architecture and deployment guide |

---

## Post-Migration Tasks

### Immediate (After Migration)

1. ✅ Verify middleware starts in webhook mode
2. ✅ Test healthcheck endpoint
3. ✅ Create webhook token for current UCM
4. ✅ Configure UCM Action URL (copy-paste)
5. ✅ Make test call, verify webhook works
6. ✅ Check agent popups appear

### Short Term (1 week)

1. Monitor webhook statistics
2. Document token mappings (which token = which client)
3. Create backup of `data/webhooks.json`
4. Update monitoring alerts

### Long Term (Ongoing)

1. Add more UCM clients (scale to 100+)
2. Review webhook analytics
3. Consider adding webhook signing (optional future enhancement)

---

## Troubleshooting

### Problem: "Token invalide" (401)

**Cause**: Token not created in admin panel or deleted

**Fix**:
1. Check admin panel → Webhooks tab
2. Create new webhook if missing
3. Copy new URL to UCM

### Problem: Events not received

**Cause**: UCM cannot reach middleware

**Fix**:
1. From UCM CLI: `curl https://ucm.selest.info/health`
2. Check network connectivity
3. Verify port 443 outbound is allowed

### Problem: Wrong contact displayed

**Cause**: Phone number format mismatch

**Fix**:
1. Check UCM sends caller in correct format
2. Verify contact phone matches exactly in Odoo
3. Use E.164 format: `+33612345678`

---

## Migration Timeline

| Time | Task | Duration |
|------|------|----------|
| 0 min | Review this plan | 5 min |
| 5 min | Update `.env` and `.env.example` | 2 min |
| 7 min | Restart middleware | 3 min |
| 10 min | Create webhook token in admin | 3 min |
| 13 min | Configure UCM Action URL | 5 min |
| 18 min | Test with phone call | 5 min |
| 23 min | Document token mappings | 5 min |

**Total**: ~30 minutes for full migration

---

## Support

For issues or questions:
- Documentation: `WEBHOOK_CONFIGURATION.md`
- Architecture: `WEBHOOK_DEPLOYMENT_PLAN.md`
- Code: See `src/application/WebhookManager.js`

Contact: `support@selest.info`

---

## Summary

### ✅ What Changed

| Before (AMI) | After (Webhook) |
|--------------|-----------------|
| Port 5039 (AMP) | Port 443 outbound HTTPS |
| Direct network access | Outbound only |
| One UCM per middleware | Unlimited clients |
| Complex firewall rules | No firewall needed |
| AMI credentials in `.env` | Token in URL |

### ✅ Benefits

- Simpler deployment
- Better security model
- Multi-client support
- No infrastructure changes for new clients
- Easier to maintain

---

**Ready to migrate! 🚀**

Execute steps 1-5 above, then test with a phone call.
