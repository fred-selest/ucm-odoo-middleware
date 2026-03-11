# 📞 UCM Webhook URL Configuration

## Quick Reference - Copy/Paste URLs

After creating a webhook in the admin panel (`/admin` → **Webhooks** → **Create Webhook**), you'll receive three URLs to configure in your UCM.

---

## UCM Action URL Configuration

### Step 1: Access UCM Web Interface
- URL: `https://[UCM_IP]:8089`
- Default credentials: admin / admin (change after first login)

### Step 2: Navigate to Action URL
- Go to **Settings** → **Integration** → **Action URL**
- ✅ Check **Enable Action URL**

### Step 3: Configure Three Events

#### 1. Ring (Incoming Call)

Paste into **Ring URL** field:

```
https://ucm.selest.info/webhook/YOUR-TOKEN-HERE?event=ring&caller=${CALLERID(num)}&exten=${EXTEN}&uniqueid=${UNIQUEID}&callerid_name=${CALLERID(name)}
```

**Parameters:**
- `event=ring` - Event type
- `caller=${CALLERID(num)}` - Phone number of caller
- `exten=${EXTEN}` - Dialed extension
- `uniqueid=${UNIQUEID}` - Unique call identifier
- `callerid_name=${CALLERID(name)}` - Caller name

---

#### 2. Answer (Call Answered)

Paste into **Answer URL** field:

```
https://ucm.selest.info/webhook/YOUR-TOKEN-HERE?event=answer&caller=${CALLERID(num)}&exten=${EXTEN}&uniqueid=${UNIQUEID}&agent=${AGENT}
```

**Parameters:**
- `event=answer` - Event type
- `caller=${CALLERID(num)}` - Phone number of caller
- `exten=${EXTEN}` - Dialed extension
- `uniqueid=${UNIQUEID}` - Unique call identifier
- `agent=${AGENT}` - Agent extension who answered

---

#### 3. Hangup (Call Ended)

Paste into **Hangup URL** field:

```
https://ucm.selest.info/webhook/YOUR-TOKEN-HERE?event=hangup&caller=${CALLERID(num)}&exten=${EXTEN}&uniqueid=${UNIQUEID}&duration=${DURATION}
```

**Parameters:**
- `event=hangup` - Event type
- `caller=${CALLERID(num)}` - Phone number of caller
- `exten=${EXTEN}` - Dialed extension
- `uniqueid=${UNIQUEID}` - Unique call identifier
- `duration=${DURATION}` - Call duration in seconds

---

## Template for All Events

### Base URL (Same for All)
```
https://ucm.selest.info/webhook/YOUR-TOKEN-HERE
```

### Event Parameters

| Event | Required Parameters | Optional Parameters |
|-------|-------------------|-------------------|
| **ring** | `event`, `caller`, `exten`, `uniqueid` | `callerid_name` |
| **answer** | `event`, `caller`, `exten`, `uniqueid` | `agent` |
| **hangup** | `event`, `caller`, `exten`, `uniqueid` | `duration` |

---

## Example: Complete Call Flow

### 1. Incoming Call (Ring)
```
https://ucm.selest.info/webhook/a1b2c3d4-e5f6-7890-abcd-ef1234567890?event=ring&caller=0612345678&exten=1001&uniqueid=1710000000.123&callerid_name=Jean+Dupont
```

### 2. Call Answered
```
https://ucm.selest.info/webhook/a1b2c3d4-e5f6-7890-abcd-ef1234567890?event=answer&caller=0612345678&exten=1001&uniqueid=1710000000.123&agent=1002
```

### 3. Call Ended (Hangup)
```
https://ucm.selest.info/webhook/a1b2c3d4-e5f6-7890-abcd-ef1234567890?event=hangup&caller=0612345678&exten=1001&uniqueid=1710000000.123&duration=45
```

---

## Testing URLs

### Test with cURL (Manual Simulation)

```bash
# Ring event
curl -G "https://ucm.selest.info/webhook/YOUR-TOKEN-HERE" \
  --data-urlencode "event=ring" \
  --data-urlencode "caller=0612345678" \
  --data-urlencode "exten=1001" \
  --data-urlencode "uniqueid=1710000000.123" \
  --data-urlencode "callerid_name=Jean+Dupont"

# Expected response: { "ok": true }
```

### Test Script

```bash
# Run the test script (included in middleware directory)
cd /opt/stacks/ucm-odoo-middleware
./test-webhook.sh flow -t YOUR-TOKEN-HERE
```

---

## Troubleshooting

### UCM Cannot Reach Middleware?

**From UCM CLI (if available):**
```bash
ping ucm.selest.info
curl -k https://ucm.selest.info/health
```

**Expected response:**
```json
{
  "status": "degraded",
  "ucm": false,
  "timestamp": "2026-03-10T14:30:00.000Z"
}
```

### Action URL Not Working?

1. ✅ Verify **Enable Action URL** is checked
2. ✅ Check token exists in admin panel → Webhooks tab
3. ✅ Verify no spaces in URL in UCM configuration
4. ✅ Check UCM internet connectivity

### Wrong Contact Displayed?

- Verify UCM sends caller in correct format
- Check Odoo contact phone matches exactly
- Use E.164 format: `+33612345678`

---

## Important Notes

### ✅ No VPN Required
- UCM initiates all connections (outbound HTTPS only)
- No port forwarding needed
- Works from any network with internet access

### ✅ Token-Based Security
- Each UCM has unique token (UUID v4)
- HTTPS protects all traffic in transit
- Tokens can be revoked via admin panel

### ✅ Multi-Client Support
- Each UCM gets own token
- Events isolated per client
- No configuration overlap

---

## Support

For issues or questions:
- Check `WEBHOOK_CONFIGURATION.md` for detailed guide
- Check `WEBHOOK_DEPLOYMENT_PLAN.md` for architecture
- Contact: `support@selest.info`

---

*Last updated: 2026-03-10*
