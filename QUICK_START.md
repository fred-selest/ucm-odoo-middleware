# 📋 UCM Webhook Migration - Quick Reference

## 🎯 5-Minute Migration

### 1. Verify `.env` Configuration (1 min)

AMI mode is **already commented out** in `.env` (lines 2-6). 
`UCM_HOST` is also commented (optional, only for admin panel pre-fill).

```bash
# Check .env (should show AMI disabled)
nano /opt/stacks/ucm-odoo-middleware/.env

# Lines 1-10 should look like:
# ── UCM (Grandstream AMI) ──────────────────────────────────────────────────
# DISABLED - Using Webhook mode instead
# UCM_HOST=192.168.10.100
# UCM_AMI_PORT=5039
# UCM_AMI_USERNAME=admin_selest
# UCM_AMI_SECRET=@Selestinfo67

# ── UCM Webhook Mode Configuration ────────────────────────────────────────
# UCM_HOST (optional, only for admin panel to pre-fill UCM IPs)
# UCM_HOST=192.168.10.100
```

### 2. Restart Middleware (1 min)

```bash
cd /opt/stacks/ucm-odoo-middleware
docker compose down && docker compose up -d
```

### 3. Configure UCM (2 min)

1. Open `https://ucm.selest.info/admin`
2. Login with Odoo credentials
3. Click **Webhooks** tab
4. Click **Create Webhook**
5. Paste into UCM: **Settings → Integration → Action URL**
   - Ring URL (incoming)
   - Answer URL (picked up)
   - Hangup URL (ended)

### 4. Test (1 min)

```bash
# Test health
curl https://ucm.selest.info/health

# Make test call, check agent popups
```

---

## 🔑 Key URLs

| Purpose | URL |
|---------|-----|
| Admin Panel | `https://ucm.selest.info/admin` |
| Health Check | `https://ucm.selest.info/health` |
| Webhook (generic) | `https://ucm.selest.info/webhook/{TOKEN}` |
| API Docs | `https://ucm.selest.info/api-docs` |
| Websocket | `wss://ucm.selest.info/ws` |

---

## 📝 Default UCM URLs to Paste

### Ring (Incoming Call)
```
https://ucm.selest.info/webhook/YOUR-TOKEN-HERE?event=ring&caller=${CALLERID(num)}&exten=${EXTEN}&uniqueid=${UNIQUEID}&callerid_name=${CALLERID(name)}
```

### Answer (Call Answered)
```
https://ucm.selest.info/webhook/YOUR-TOKEN-HERE?event=answer&caller=${CALLERID(num)}&exten=${EXTEN}&uniqueid=${UNIQUEID}&agent=${AGENT}
```

### Hangup (Call Ended)
```
https://ucm.selest.info/webhook/YOUR-TOKEN-HERE?event=hangup&caller=${CALLERID(num)}&exten=${EXTEN}&uniqueid=${UNIQUEID}&duration=${DURATION}
```

---

## 🧪 Testing Commands

```bash
# Test webhook manually (replace YOUR-TOKEN-HERE)
curl -G "https://ucm.selest.info/webhook/YOUR-TOKEN-HERE" \
  --data-urlencode "event=ring" \
  --data-urlencode "caller=0612345678" \
  --data-urlencode "exten=1001" \
  --data-urlencode "uniqueid=1710000000.123"

# Use test script (auto-generates token)
./test-webhook.sh all

# Run test script
./test-webhook.sh all
```

---

## 📊 Multi-Client Support

Each UCM needs unique token:

```
Client 1: https://ucm.selest.info/webhook/UUID-1?...
Client 2: https://ucm.selest.info/webhook/UUID-2?...
Client 3: https://ucm.selest.info/webhook/UUID-3?...
```

**Create in admin**: `/admin` → **Webhooks** → **Create Webhook**

---

## 🚨 Troubleshooting

| Problem | Quick Fix |
|---------|-----------|
| No events? | Check UCM Action URL is **enabled** |
| 401 error? | Token not created - create in admin panel |
| Wrong contact? | Verify phone number format matches Odoo |
| Can't reach UCM? | Verify `ucm.selest.info` is accessible from UCM |

---

## 📚 Documentation

| File | Purpose |
|------|---------|
| `MIGRATION_PLAN.md` | Complete migration guide |
| `WEBHOOK_CONFIGURATION.md` | Detailed configuration steps |
| `WEBHOOK_DEPLOYMENT_PLAN.md` | Architecture and deployment |
| `test-webhook.sh` | Automated testing script |

---

## ✅ Post-Migration Checklist

- [ ] `.env` AMI settings commented
- [ ] Middleware restart confirmed
- [ ] Webhook created in admin panel
- [ ] UCM Action URL configured
- [ ] Test call successful
- [ ] Agent popups working
- [ ] Contact identification correct

---

## 🎉 Success!

**You're done!** UCM now uses Webhook mode:
- ✅ No VPN needed
- ✅ No firewall rules
- ✅ Multiple clients supported
- ✅ Outbound HTTPS only

---

** questions?** Check `WEBHOOK_CONFIGURATION.md` or contact `support@selest.info`
