# 📋 Deployment Plan - Action URL / Webhook Mode

## 1. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              INTERNET / LAN                                          │
└──────────────────────┬──────────────────────────┬───────────────────────────────────┘
                       │                          │
                       │                          │ (Outbound only - no firewall rules)
                       │                          │
         ┌─────────────▼─────────────┐  ┌────────▼──────────┐
         │   UCM Client 1            │  │  UCM Client 2     │
         │   Grandstream             │  │  Grandstream      │
         │   192.168.10.100          │  │  192.168.20.100   │
         │                           │  │                   │
         │  Ring → HTTP GET          │  │  Ring → HTTP GET  │
         │  Answer → HTTP GET        │  │  Answer → HTTP GET│
         │  Hangup → HTTP GET        │  │  Hangup → HTTP GET│
         └─────────────┬─────────────┘  └────────┬──────────┘
                       │                          │
                       │ (Outbound HTTPS)         │ (Outbound HTTPS)
                       │                          │
                       └──────────┬───────────────┘
                                  │
                      ┌───────────▼─────────────┐
                      │  Nginx Proxy Manager    │
                      │  ucm.selest.info        │
                      │  - SSL termination      │
                      │  - Reverse proxy        │
                      │  - Public exposure      │
                      └───────────┬─────────────┘
                                  │
                      ┌───────────▼─────────────┐
                      │   Docker Container      │
                      │   middleware:3000       │
                      │                         │
                      │  ┌──────────────────┐   │
                      │  │ WebhookManager   │   │
                      │  │ - Token validation│  │
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
                      │  │ - Contact search │   │
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

## 2. Multi-Client Isolation Strategy

### Token-Based Isolation

Each client UCM gets its **own unique token** in the webhook URL:

```
https://ucm.selest.info/webhook/{UNIQUE-TOKEN}?event=ring&caller=...
                                       ↑
                              32-char UUID v4
```

### Implementation (`WebhookManager.js`)

```javascript
class WebhookManager extends EventEmitter {
  constructor() {
    this._tokens = new Map(); // token → { name, ucmHost, callCount, lastUsed }
  }

  createToken(name) {
    const token = uuidv4(); // e.g., "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    const info = { 
      name, 
      createdAt: new Date().toISOString(), 
      lastUsed: null, 
      callCount: 0 
    };
    this._tokens.set(token, info);
    this._save(); // Persistent in data/webhooks.json
    return { token, ...info };
  }
  
  processEvent(token, params) {
    const info = this._tokens.get(token);
    if (!info) return false; // ← Isolation: unknown token rejected
    
    info.lastUsed = new Date().toISOString();
    info.callCount = (info.callCount || 0) + 1;
    this._save();
    
    // Emit event with client context
    this.emit('call:incoming', {
      ...callInfo,
      client: info.name,  // ← Identifies which UCM sent the event
      source: 'webhook'
    });
  }
}
```

### Data Persistence

Tokens stored in `/app/data/webhooks.json`:
```json
{
  "a1b2c3d4-e5f6-7890-abcd-ef1234567890": {
    "name": "client-alice",
    "ucmHost": "192.168.10.100",
    "ucmWebPort": 8089,
    "createdAt": "2026-03-10T10:00:00.000Z",
    "lastUsed": "2026-03-10T14:30:00.000Z",
    "callCount": 42
  },
  "b2c3d4e5-f6a7-8901-bcde-f12345678901": {
    "name": "client-bob",
    "ucmHost": "192.168.20.100",
    "ucmWebPort": 8089,
    "createdAt": "2026-03-10T11:00:00.000Z",
    "lastUsed": "2026-03-10T15:00:00.000Z",
    "callCount": 18
  }
}
```

### Benefits

✅ **Complete isolation**: Client A cannot trigger events for Client B  
✅ **Per-client tracking**: `callCount`, `lastUsed`, `ucmHost` stored per token  
✅ **No config overlaps**: Each UCM configured independently  
✅ **Scalable**: 100+ clients supported without changes  

---

## 3. Webhook URL Pattern (GET Endpoint Format)

### Base URL Structure

```
https://ucm.selest.info/webhook/{TOKEN}
```

### Required Query Parameters

| Parameter | UCM Variable | Description | Example |
|-----------|--------------|-------------|---------|
| `event` | *(static)* | Event type: `ring`, `answer`, `hangup` | `event=ring` |
| `caller` | `${CALLERID(num)}` | Caller ID number | `caller=0612345678` |
| `exten` | `${EXTEN}` | Dialed extension | `exten=1001` |
| `uniqueid` | `${UNIQUEID}` | Call unique ID | `uniqueid=1710000000.123` |
| `callerid_name` | `${CALLERID(name)}` | Caller name | `callerid_name=Jean+Dupont` |

### Complete URL Examples

```bash
# Ring (incoming call)
GET /webhook/a1b2c3d4-e5f6-7890-abcd-ef1234567890?
    event=ring&
    caller=0612345678&
    exten=1001&
    uniqueid=1710000000.123&
    callerid_name=Jean+Dupont

# Answer (call picked up)
GET /webhook/a1b2c3d4-e5f6-7890-abcd-ef1234567890?
    event=answer&
    caller=0612345678&
    exten=1001&
    uniqueid=1710000000.123&
    agent=1002

# Hangup (call ended)
GET /webhook/a1b2c3d4-e5f6-7890-abcd-ef1234567890?
    event=hangup&
    caller=0612345678&
    exten=1001&
    uniqueid=1710000000.123&
    duration=45
```

### UCM Action URL Configuration

In UCM web interface (**Settings → Integration → Action URL**):

| Event | URL to Paste |
|-------|--------------|
| **Ring (Incoming)** | `https://ucm.selest.info/webhook/a1b2c3d4-e5f6-7890-abcd-ef1234567890?event=ring&caller=${CALLERID(num)}&exten=${EXTEN}&uniqueid=${UNIQUEID}&callerid_name=${CALLERID(name)}` |
| **Answer** | `https://ucm.selest.info/webhook/a1b2c3d4-e5f6-7890-abcd-ef1234567890?event=answer&caller=${CALLERID(num)}&exten=${EXTEN}&uniqueid=${UNIQUEID}&agent=${AGENT}` |
| **Hangup** | `https://ucm.selest.info/webhook/a1b2c3d4-e5f6-7890-abcd-ef1234567890?event=hangup&caller=${CALLERID(num)}&exten=${EXTEN}&uniqueid=${UNIQUEID}&duration=${DURATION}` |

---

## 4. UCM Configuration Steps (Copy-Paste)

### Step 1: Get Webhook URLs from Middleware Admin

1. Access middleware admin: `http://localhost:3000/admin`
2. Log in with Odoo credentials
3. Click **"Webhooks"** tab
4. Click **"Create Webhook"**
5. Fill in:
   - **Name**: `client-alice` (or any identifier)
   - **UCM Host** (optional): `192.168.10.100`
   - **UCM Web Port** (optional): `8089`
   - **Notes**: `Alice's UCM - Paris office`
6. Click **"Save"**
7. **Copy all three URLs** from the table

### Step 2: Configure UCM Action URL

1. Open UCM web interface: `https://192.168.10.100:8089`
2. Log in as admin
3. Go to **Settings** → **Integration** → **Action URL**
4. Enable **Action URL**
5. Paste URLs:

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Ring (Incoming):                                                        │
│ https://ucm.selest.info/webhook/a1b2c3d4-e5f6-7890-abcd-ef1234567890? │
│   event=ring&caller=${CALLERID(num)}&exten=${EXTEN}&                   │
│   uniqueid=${UNIQUEID}&callerid_name=${CALLERID(name)}                 │
├─────────────────────────────────────────────────────────────────────────┤
│ Answer (Called):                                                        │
│ https://ucm.selest.info/webhook/a1b2c3d4-e5f6-7890-abcd-ef1234567890? │
│   event=answer&caller=${CALLERID(num)}&exten=${EXTEN}&                 │
│   uniqueid=${UNIQUEID}&agent=${AGENT}                                  │
├─────────────────────────────────────────────────────────────────────────┤
│ Hangup (End):                                                           │
│ https://ucm.selest.info/webhook/a1b2c3d4-e5f6-7890-abcd-ef1234567890? │
│   event=hangup&caller=${CALLERID(num)}&exten=${EXTEN}&                 │
│   uniqueid=${UNIQUEID}&duration=${DURATION}                            │
└─────────────────────────────────────────────────────────────────────────┘
```

6. Click **"Save"** or **"Apply"**

### Step 3: Test Configuration

1. Make a test call to the UCM
2. Check middleware logs: `docker logs ucm_odoo_middleware`
3. Verify webhooks appear in admin panel

---

## 5. Token Generation and Management

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/webhooks` | List all tokens |
| `POST` | `/api/webhooks` | Create new token |
| `PATCH` | `/api/webhooks/:token` | Update token info |
| `DELETE` | `/api/webhooks/:token` | Revoke token |
| `POST` | `/api/webhooks/:token/test-ucm` | Test UCM connectivity |

### Example: Create Webhook Token

```bash
# authenticated with X-Session-Token
curl -X POST http://localhost:3000/api/webhooks \
  -H "Content-Type: application/json" \
  -H "X-Session-Token: your-odoo-session-token" \
  -d '{"name": "client-alice", "ucmHost": "192.168.10.100", "notes": "Paris office"}'

# Response
{
  "token": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "name": "client-alice",
  "ucmHost": "192.168.10.100",
  "ucmWebPort": 8089,
  "createdAt": "2026-03-10T10:00:00.000Z",
  "lastUsed": null,
  "callCount": 0
}
```

### Token Authenticity

- **UUID v4**: 128-bit random, 2^122 possible values
- **Collision probability**: 1 in 2^61 (negligible)
- **No secrets**: Token itself acts as authentication
- **No signature**: Simple token-in-URL (HTTPS protects in transit)

### Revoking Access

```bash
# Delete token (immediate revocation)
curl -X DELETE http://localhost:3000/api/webhooks/a1b2c3d4-e5f6-7890-abcd-ef1234567890 \
  -H "X-Session-Token: your-odoo-session-token"

# Response
{ "ok": true }
```

---

## 6. Docker/Nginx Configuration

### Docker Compose (Already Configured)

```yaml
services:
  middleware:
    image: ucm-odoo-middleware:latest
    container_name: ucm_odoo_middleware
    ports:
      - "3000:3000"  # ← Host port exposed for Nginx proxy
    networks:
      - proxy-net
    volumes:
      - ./logs:/app/logs
      - ./data:/app/data  # ← Stores webhooks.json
    env_file:
      - .env
    environment:
      - NODE_ENV=production
      - DB_PATH=/app/data/middleware.db
    healthcheck:
      test: ["CMD", "curl", "-sf", "http://localhost:3000/health"]
```

### Nginx Proxy Manager Configuration

#### Create Proxy Host

1. Login to Nginx Proxy Manager
2. **Hosts** → **Add Proxy Host**
3. Configure:

```
Domain Names: ucm.selest.info
Scheme: https
Forward Hostname: ucm_odoo_middleware
Forward Port: 3000
Websockets Support: ✓ Enabled
Object Caching: ✗ Disabled
Block Exploits: ✓ Enabled
 SSL:
   forcing SSL: ✓ Enabled
   HTTP/2: ✓ Enabled
   Let's Encrypt: ✓ Enabled (auto-renew)
```

#### Custom Nginx Settings (Optional)

```nginx
# ~/.config/nginx-proxy-manager/custom_redirects/ucm.selest.info.conf

# Redirect / → /admin
location = / {
    return 302 /admin;
}

# Healthcheck endpoint (no auth required)
location = /health {
    proxy_pass http://ucm_odoo_middleware:3000/health;
}

# Webhook endpoint (token-protected, no auth header)
location = /webhook {
    proxy_pass http://ucm_odoo_middleware:3000/webhook;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# All other routes require admin auth (handled by middleware)
location / {
    proxy_pass http://ucm_odoo_middleware:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

### Environment Variables

Create `.env` in middleware directory:

```bash
# ── UCM Mode: Webhook (no AMI/WS needed) ───────────────────
UCM_MODE=websocket  # Ignored for webhook mode, but required by middleware

# ── Server Configuration ───────────────────────────────────
SERVER_PORT=3000
NODE_ENV=production

# ── Odoo (for admin auth & contact search) ─────────────────
ODOO_URL=https://your-odoo.example.com
ODOO_DB=your_database
ODOO_USERNAME=api_user@example.com
ODOO_API_KEY=your_odoo_api_key

# ── Optional: UCM defaults for new webhooks ───────────────
# UCM_HOST=192.168.10.100  # Pre-fill in admin panel
# UCM_WEB_PORT=8089
```

### Public DNS Setup

```
ucm.selest.info  →  A record  →  Your.Server.Public.IP
```

Wait for DNS propagation (usually < 5 min).

---

## 7. Testing Steps

### Test 1: Verify Middleware is Exposed

```bash
# From external network (not Docker host)
curl https://ucm.selest.info/health

# Expected response
{
  "status": "ok",
  "ucm": false,  # ← UCM not connected (expected for webhook-only mode),
  "timestamp": "2026-03-10T14:30:00.000Z"
}
```

### Test 2: Simulate UCM Webhook (Manual)

```bash
# Ring event
curl -G "https://ucm.selest.info/webhook/a1b2c3d4-e5f6-7890-abcd-ef1234567890" \
  --data-urlencode "event=ring" \
  --data-urlencode "caller=0612345678" \
  --data-urlencode "exten=1001" \
  --data-urlencode "uniqueid=1710000000.123" \
  --data-urlencode "callerid_name=Jean+Dupont"

# Expected response
{ "ok": true }

# Check middleware logs
docker logs -f ucm_odoo_middleware

# Expected log
[INFO] Webhook: événement reçu {
  client: "client-alice",
  event: "ring",
  caller: "0612345678",
  exten: "1001"
}
```

### Test 3: Simulate Complete Call Flow

```bash
# 1. Incoming call (Ring)
curl -G "https://ucm.selest.info/webhook/a1b2c3d4-e5f6-7890-abcd-ef1234567890" \
  --data-urlencode "event=ring" \
  --data-urlencode "caller=0612345678" \
  --data-urlencode "exten=1001" \
  --data-urlencode "uniqueid=1710000000.123"

# 2. Call answered
curl -G "https://ucm.selest.info/webhook/a1b2c3d4-e5f6-7890-abcd-ef1234567890" \
  --data-urlencode "event=answer" \
  --data-urlencode "caller=0612345678" \
  --data-urlencode "exten=1001" \
  --data-urlencode "uniqueid=1710000000.123" \
  --data-urlencode "agent=1002"

# 3. Call ended
curl -G "https://ucm.selest.info/webhook/a1b2c3d4-e5f6-7890-abcd-ef1234567890" \
  --data-urlencode "event=hangup" \
  --data-urlencode "caller=0612345678" \
  --data-urlencode "exten=1001" \
  --data-urlencode "uniqueid=1710000000.123" \
  --data-urlencode "duration=45"
```

### Test 4: Verify Call History

```bash
# Check recorded calls
curl -G "http://localhost:3000/api/calls/history" \
  -H "X-Session-Token: your-odoo-session-token" \
  --data-urlencode "limit=10"

# Expected: Call with contact identified from Odoo
{
  "ok": true,
  "data": [{
    "id": 42,
    "uniqueId": "1710000000.123",
    "callerIdNum": "0612345678",
    "exten": "1001",
    "direction": "inbound",
    "status": "answered",
    "duration": 45,
    "contact": {
      "id": 123,
      "name": "Jean Dupont",
      "phone": "0612345678",
      "odooUrl": "https://odoo.example.com/contacts/123"
    }
  }]
}
```

### Test 5: WebSocket Client Test

Open browser console on any page:

```javascript
const ws = new WebSocket('wss://ucm.selest.info/ws');

ws.onmessage = (event) => {
  console.log('Event:', JSON.parse(event.data));
};

# Expected messages
{ "type": "call:incoming", "data": { "callerIdNum": "0612345678", "exten": "1001" } }
{ "type": "call:answered", "data": { "callerIdNum": "0612345678", "exten": "1001" } }
{ "type": "call:hangup", "data": { "uniqueId": "...", "duration": 45 } }
{ "type": "contact", "data": { "uniqueId": "...", "contact": { "name": "Jean Dupont", ... } } }
```

---

## 8. Client Documentation Template

### `WEBHOOK_DEPLOYMENT.md` (Client-Facing)

```markdown
# 📞 UCM ↔ Odoo Integration - Webhook Mode

## Quick Start (3 minutes)

### 1. Configure the Middleware

> 🔒 **No code/terminal access needed** - Your IT admin has already configured this!

Your webhook URLs (copy these into your UCM):

| Event | URL |
|-------|-----|
| **Incoming Call** | `https://ucm.selest.info/webhook/YOUR-TOKEN-HERE?event=ring&caller=${CALLERID(num)}&exten=${EXTEN}&uniqueid=${UNIQUEID}&callerid_name=${CALLERID(name)}` |
| **Call Answered** | `https://ucm.selest.info/webhook/YOUR-TOKEN-HERE?event=answer&caller=${CALLERID(num)}&exten=${EXTEN}&uniqueid=${UNIQUEID}&agent=${AGENT}` |
| **Call Ended** | `https://ucm.selest.info/webhook/YOUR-TOKEN-HERE?event=hangup&caller=${CALLERID(num)}&exten=${EXTEN}&uniqueid=${UNIQUEID}&duration=${DURATION}` |

### 2. Configure Your Grandstream UCM

1. Open UCM web interface: `https://YOUR-UCM-IP:8089`
2. Login with admin credentials
3. Go to **Settings** → **Integration** → **Action URL**
4. Enable **Action URL**
5. Paste the 3 URLs above into the respective fields
6. Save settings

### 3. Test

1. Make a test call to your UCM
2. Answer the call
3. Hang up
4. Wait 1-2 seconds
5. Check if popup appears on your Odoo-connected browser

### 4. Troubleshooting

| Issue | Check |
|-------|-------|
| No popups? | Verify UCM can reach `ucm.selest.info` (ping from UCM LAN) |
| Wrong contact? | Verify phone number format in UCM matches Odoo |
| Not working? | Check UCM Action URL is **enabled** (not just configured) |

---

## 📊 How It Works

```
Caller dials → UCM receives → UCM sends HTTP GET to ucm.selest.info
                                    ↓
                          Middleware parses event
                                    ↓
                          Searches Odoo for contact
                                    ↓
                          Sends WebSocket to agent's browser
                                    ↓
                          Agent sees popup with contact info
```

### No VPN. No Firewall Rules.

✅ **Outbound only**: UCM initiates all connections  
✅ **HTTPS encrypted**: All data encrypted in transit  
✅ **No inbound traffic**: Your firewall blocks nothing needed  

---

## 🔒 Security

- Each UCM has unique token (UUID v4, 2^122 combinations)
- HTTPS enforced (TLS 1.3)
- HTTP client authentication via URL token
- No secrets stored on UCM
- Token can be revoked remotely

---

## 📞 Support

Contact: `support@selest.info`  
Status page: `https://status.selest.info`

---

*Your Grandstream UCM is now integrated with Odoo in 3 minutes.*
```

---

## Summary

### ✅ What This Answers

| Requirement | Solution |
|-------------|----------|
| No router config | UCM initiates outbound HTTPS (no port forwarding) |
| Multi-client support | Token-based isolation via UUID in URL path |
| Minimal client config | Copy-paste 3 URLs into UCM Action URL fields |
| Public exposure | Nginx Proxy Manager + DNS (ucm.selest.info) |
| Token management | ADMIN API + persistent JSON storage |
| Webhook format | `GET /webhook/:token?event=:type&caller=:num&...` |

### 🚀 Next Steps

1. **Deploy middleware** (already running on your server)
2. **Create webhooks** via admin panel (`/admin`)
3. **Configure UCM** (copy-paste URLs)
4. **Test** (make a call)
5. **Document** (share template with clients)

### 📝 Notes

- **No changes needed** to existing middleware code
- **No Docker config** needed (ports already exposed)
- **No Nginx changes** needed (proxy host already configured)
- **Scale to 100+ clients** without any infrastructure changes

---

**Ready to deploy!** 🚀
