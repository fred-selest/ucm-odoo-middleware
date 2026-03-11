# 📞 UCM Webhook Configuration Guide

## Quick Start (3 minutes)

This guide explains how to configure your Grandstream UCM to use Webhook mode instead of AMI.

### ✅ Benefits of Webhook Mode

- **No VPN required** ✅
- **No firewall port forwarding needed** ✅
- **Works from any network** ✅
- **Multi-client isolation** (each UCM has unique token) ✅
- **Easier deployment** ✅

---

## Architecture

```
                         ┌─────────────────────────────┐
                         │    Internet / LAN           │
                         └───────────┬─────────────────┘
                                     │
          ┌──────────────────────────┼──────────────────┐
          │                          │                  │
    ┌─────▼─────┐              ┌────▼─────┐       ┌────▼─────┐
    │  UCM-1    │              │  UCM-2   │       │  UCM-N   │
    │ 192.168.10│              │...       │       │...       │
    │           │              │          │       │          │
    │ Ring →    │              │ Ring →   │       │ Ring →   │
    │ HTTP GET  │              │ HTTP GET │       │ HTTP GET │
    └─────┬─────┘              └────┬─────┘       └────┬─────┘
          │                         │                  │
          │ (Outbound HTTPS only)   │                  │
          └───────────┬─────────────┴──────────────────┘
                      │
          ┌───────────▼─────────────┐
          │  Nginx Proxy Manager    │
          │  ucm.selest.info        │
          │  - SSL termination      │
          │  - Reverse proxy        │
          └───────────┬─────────────┘
                      │
          ┌───────────▼─────────────┐
          │    Docker Container     │
          │    middleware:3000      │
          │                         │
          │  ┌──────────────────┐   │
          │  │ WebhookManager   │   │
          │  │ - Token          │   │
          │  │   validation     │   │
          │  │ - Event routing  │   │
          │  └──────────────────┘   │
          │           │              │
          │           ▼              │
          │  ┌──────────────────┐   │
          │  │ CallHandler      │   │
          │  │ - Event parsing  │   │
          │  │ - Contact lookup │   │
          │  └──────────────────┘   │
          │           │              │
          │           ▼              │
          │  ┌──────────────────┐   │
          │  │ OdooClient       │   │
          │  │ - XML-RPC        │   │
          │  └──────────────────┘   │
          └─────────────────────────┘
                      │
          ┌───────────▼─────────────┐
          │  WebSocket Server       │
          │  - Real-time updates    │
          │  - Agent popups         │
          └─────────────────────────┘
```

---

## Step-by-Step Configuration

### Step 1: Generate Webhook URLs

1. **Access the admin panel**: `https://ucm.selest.info/admin`
2. **Log in** with your Odoo credentials (email + password)
3. **Click "Webhooks"** tab in the admin panel
4. **Click "Create Webhook"** button
5. **Fill in the form**:
   - **Name**: `client-alice` (use a descriptive identifier, e.g., `paris-office`, `client-x`)
   - **UCM Host**: `192.168.10.100` (optional, for admin reference only)
   - **UCM Web Port**: `8089` (optional, defaults to 8089)
   - **Notes**: `Alice's UCM - Paris office` (optional)
6. **Click "Save"**
7. **Copy the three generated URLs** from the table (one for each event type)

#### Example Generated URLs:

```
Ring (Incoming Call):
https://ucm.selest.info/webhook/a1b2c3d4-e5f6-7890-abcd-ef1234567890?event=ring&caller=${CALLERID(num)}&exten=${EXTEN}&uniqueid=${UNIQUEID}&callerid_name=${CALLERID(name)}

Answer (Call Answered):
https://ucm.selest.info/webhook/a1b2c3d4-e5f6-7890-abcd-ef1234567890?event=answer&caller=${CALLERID(num)}&exten=${EXTEN}&uniqueid=${UNIQUEID}&agent=${AGENT}

Hangup (Call Ended):
https://ucm.selest.info/webhook/a1b2c3d4-e5f6-7890-abcd-ef1234567890?event=hangup&caller=${CALLERID(num)}&exten=${EXTEN}&uniqueid=${UNIQUEID}&duration=${DURATION}
```

---

### Step 2: Configure UCM Action URL

1. **Open UCM web interface**: `https://192.168.10.100:8089` (replace IP with your UCM's IP)
2. **Log in** with admin credentials
3. **Navigate to**: **Settings** → **Integration** → **Action URL**
4. **Enable Action URL**: Check ✅ **Enable Action URL**
5. **Paste the three URLs** into their respective fields:

#### Ring (Incoming Call)

```
https://ucm.selest.info/webhook/a1b2c3d4-e5f6-7890-abcd-ef1234567890?event=ring&caller=${CALLERID(num)}&exten=${EXTEN}&uniqueid=${UNIQUEID}&callerid_name=${CALLERID(name)}
```

#### Answer (Call Answered)

```
https://ucm.selest.info/webhook/a1b2c3d4-e5f6-7890-abcd-ef1234567890?event=answer&caller=${CALLERID(num)}&exten=${EXTEN}&uniqueid=${UNIQUEID}&agent=${AGENT}
```

#### Hangup (Call Ended)

```
https://ucm.selest.info/webhook/a1b2c3d4-e5f6-7890-abcd-ef1234567890?event=hangup&caller=${CALLERID(num)}&exten=${EXTEN}&uniqueid=${UNIQUEID}&duration=${DURATION}
```

6. **Click "Save"** or **"Apply"** button

---

### Step 3: Verify Configuration

1. **Check middleware status**: Visit `https://ucm.selest.info/admin`
2. **Verify UCM connection**: Status should show `degraded` (AMI not connected, webhook is active)
3. **Make a test call**:
   - Dial into your UCM
   - Answer the call
   - Hang up

4. **Check middleware logs**:
   ```bash
   docker logs -f ucm_odoo_middleware
   ```

   Expected log entries:
   ```
   [INFO] Webhook: événement reçu { client: "paris-office", event: "ring", caller: "0612345678", exten: "1001" }
   [INFO] Webhook: événement reçu { client: "paris-office", event: "answer", caller: "0612345678", exten: "1001" }
   [INFO] Webhook: événement reçu { client: "paris-office", event: "hangup", caller: "0612345678", exten: "1001" }
   ```

5. **Check agent popups**: Browser should show contact popup when call arrives

---

## URL Parameter Reference

| Parameter | UCM Variable | Description | Example |
|-----------|--------------|-------------|---------|
| `event` | *(static)* | Event type: `ring`, `answer`, `hangup` | `event=ring` |
| `caller` | `${CALLERID(num)}` | Caller ID number | `caller=0612345678` |
| `exten` | `${EXTEN}` | Dialed extension | `exten=1001` |
| `uniqueid` | `${UNIQUEID}` | Call unique ID (required) | `uniqueid=1710000000.123` |
| `callerid_name` | `${CALLERID(name)}` | Caller name | `callerid_name=Jean+Dupont` |
| `agent` | `${AGENT}` | Agent extension who answered | `agent=1002` |
| `duration` | `${DURATION}` | Call duration in seconds | `duration=45` |

---

## Token-Based Security

### How It Works

Each UCM gets its **own unique token** (UUID v4) in the webhook URL:

```
https://ucm.selest.info/webhook/{UNIQUE-TOKEN}?...
                                        ↑
                              32-char UUID v4
```

### Security Features

- **128-bit random tokens**: 2^122 possible combinations
- **No secrets needed**: Token itself acts as authentication
- **HTTPS-protected**: All traffic encrypted in transit
- **Token revocation**: Can be disabled remotely via admin panel

### Token Management

From admin panel (`/admin` → **Webhooks** tab):

| Action | Description |
|--------|-------------|
| **Create Webhook** | Generate new token + URLs |
| **Edit Webhook** | Update name, UCM host, notes |
| **Delete Webhook** | Revoke token (stops events immediately) |
| **Test UCM** | Verify UCM is reachable |

---

## Troubleshooting

### No Events Received?

1. **Check UCM can reach middleware**:
   ```bash
   # From UCM (if you have CLI access)
   ping ucm.selest.info
   wget https://ucm.selest.info/health
   ```

2. **Verify Action URL is enabled** in UCM:
   - Settings → Integration → Action URL
   - ✅ Enable Action URL checked

3. **Check middleware logs**:
   ```bash
   docker logs ucm_odoo_middleware | grep Webhook
   ```

4. **Verify token exists**:
   - Admin panel → Webhooks tab
   - Ensure token was created and not deleted

### Token Invalid (401 Error)?

- Check URL in UCM matches exactly what's shown in admin panel
- No spaces or extra characters in the URL
- Token hasn't been deleted

### Wrong Contact Displayed?

- Verify phone number format in UCM matches Odoo contact numbers
- UCM should send `caller` parameter in E.164 format: `+33612345678`
- Odoo contact must have matching phone number

### Calling UCM Not Reachable?

- UCM must have internet access to reach `ucm.selest.info`
- Check if firewall blocks outbound HTTPS (port 443)
- Try from UCM CLI (if available):
  ```bash
  curl -k https://ucm.selest.info/health
  ```

---

## Testing Webhooks Manually

### Simulate UCM Events with cURL

```bash
# Ring (incoming call)
curl -G "https://ucm.selest.info/webhook/a1b2c3d4-e5f6-7890-abcd-ef1234567890" \
  --data-urlencode "event=ring" \
  --data-urlencode "caller=0612345678" \
  --data-urlencode "exten=1001" \
  --data-urlencode "uniqueid=1710000000.123" \
  --data-urlencode "callerid_name=Jean+Dupont"

# Answer (call picked up)
curl -G "https://ucm.selest.info/webhook/a1b2c3d4-e5f6-7890-abcd-ef1234567890" \
  --data-urlencode "event=answer" \
  --data-urlencode "caller=0612345678" \
  --data-urlencode "exten=1001" \
  --data-urlencode "uniqueid=1710000000.123" \
  --data-urlencode "agent=1002"

# Hangup (call ended)
curl -G "https://ucm.selest.info/webhook/a1b2c3d4-e5f6-7890-abcd-ef1234567890" \
  --data-urlencode "event=hangup" \
  --data-urlencode "caller=0612345678" \
  --data-urlencode "exten=1001" \
  --data-urlencode "uniqueid=1710000000.123" \
  --data-urlencode "duration=45"
```

Expected response: `{ "ok": true }`

---

## Monitoring

### Check Webhook Statistics

From admin panel → Webhooks tab:

- **Name**: Identifier you set
- **Created**: When webhook was created
- **Last Used**:Last time event was received
- **Call Count**: Total events processed

### Health Check

```bash
curl https://ucm.selest.info/health
```

Expected response:
```json
{
  "status": "degraded",
  "ucm": false,
  "timestamp": "2026-03-10T14:30:00.000Z"
}
```

Note: `ucm: false` is **expected** in webhook-only mode (AMI not connected).

---

## Multi-Client Support

### Adding Another Client

1. **Create new webhook** in admin panel with different name
2. **Copy new URLs** to UCM configuration
3. **Repeat** for each additional UCM

### Token Isolation

Each UCM:
- ✅ Has unique token
- ✅ Events不会 affect other clients
- ✅ Can be enabled/disabled independently
- ✅ Has separate statistics

---

## API Reference (Admin)

### List All Webhooks

```bash
curl "https://ucm.selest.info/api/webhooks" \
  -H "X-Session-Token: your-odoo-session-token"
```

### Create Webhook

```bash
curl -X POST "https://ucm.selest.info/api/webhooks" \
  -H "Content-Type: application/json" \
  -H "X-Session-Token: your-odoo-session-token" \
  -d '{"name": "paris-office", "ucmHost": "192.168.10.100", "notes": "Main office"}'
```

### Delete Webhook

```bash
curl -X DELETE "https://ucm.selest.info/api/webhooks/a1b2c3d4-e5f6-7890-abcd-ef1234567890" \
  -H "X-Session-Token: your-odoo-session-token"
```

---

## Summary Checklist

- ✅ UCM can reach `ucm.selest.info` via HTTPS
- ✅ Action URL enabled in UCM
- ✅ Three URLs configured (ring, answer, hangup)
- ✅ Webhook token contains unique UUID
- ✅ Middleware logs show events
- ✅ Agent popups appear on calls
- ✅ Contact identified correctly from Odoo

---

## Next Steps

1. **Deploy to production**: Repeat for all client UCMs
2. **Document tokens**: Keep record of which token belongs to which client
3. **Monitor usage**: Check webhook statistics weekly
4. **Scale**: No infrastructure changes needed for 100+ clients

---

*For support: contact@selest.info*
