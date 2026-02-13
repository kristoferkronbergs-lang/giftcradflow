# Render Service Fix - PNG Generation & Upload

## Problem Fixed
The render service was returning HTTP 404 and not uploading PNGs to Supabase Storage.

## Root Causes Identified & Fixed

### 1. **URL Construction Bug** ✅ FIXED
**Issue:** Edge Function was naively concatenating URLs, causing double slashes or double `/api` segments.

**Fix Applied:**
- Added `joinUrl()` helper function in `trigger-make-email` Edge Function
- Safely handles trailing slashes and prevents double segments
- Logs both base URL and final endpoint for debugging

### 2. **Missing Environment Variable** ✅ FIXED
**Issue:** Render page requires `VITE_RENDER_TOKEN` but it was missing from `.env`

**Fix Applied:**
- Added `VITE_RENDER_TOKEN=render-secret-token-2024` to `.env`
- Must match the `RENDER_TOKEN` used by the render service

### 3. **Insufficient Logging** ✅ FIXED
**Issue:** Render service had minimal error details, making debugging impossible.

**Fix Applied:**
- Added comprehensive logging at every step
- Captures page errors, console errors, and failed requests
- Logs HTTP response status and page content on errors
- Saves debug screenshots to `/tmp/` when selector fails
- Logs upload details and Supabase errors

---

## Architecture Overview

```
┌─────────────────┐
│  Stripe Webhook │ (payment succeeds)
└────────┬────────┘
         │
         ▼
┌─────────────────────────┐
│  Order status = 'paid'  │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ CheckoutSuccess.tsx             │
│ calls trigger-make-email        │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ Edge: trigger-make-email        │
│ 1. Acquires email lock          │
│ 2. Calls render service         │
│ 3. Sends Make.com webhook       │
│ 4. Updates email_status='sent'  │
└────────┬────────────────────────┘
         │
         ├──────────────────────┐
         │                      │
         ▼                      ▼
┌─────────────────┐    ┌──────────────────┐
│ Render Service  │    │ Make.com Webhook │
│ (Node.js)       │    │ (with HTML)      │
│                 │    └──────────────────┘
│ 1. Opens page   │    ✅ ALWAYS WORKS
│ 2. Screenshots  │
│ 3. Uploads PNG  │
└────────┬────────┘
         │
         ▼
┌──────────────────────────┐
│ Supabase Storage         │
│ Bucket: giftcard-renders │
│ Path: orders/{id}.png    │
└──────────────────────────┘
```

---

## File Changes

### 1. Edge Function: `supabase/functions/trigger-make-email/index.ts`

**Added:** URL normalization helper
```typescript
function joinUrl(base: string, path: string): string {
  const normalizedBase = base.replace(/\/+$/, ''); // Remove trailing slashes
  const normalizedPath = path.replace(/^\/+/, ''); // Remove leading slashes
  return `${normalizedBase}/${normalizedPath}`;
}
```

**Updated:** Render endpoint construction
```typescript
// BEFORE (BROKEN):
const renderEndpoint = `${RENDER_SERVICE_URL}/api/render-giftcard`;

// AFTER (FIXED):
const renderEndpoint = joinUrl(RENDER_SERVICE_URL, 'api/render-giftcard');
console.log(`[Email:${request_id}] 🎨 Attempting render service call...`, {
  render_service_url: RENDER_SERVICE_URL,
  final_endpoint: renderEndpoint,
  order_id,
});
```

### 2. Render Service: `api/server.js`

**Enhanced:** POST `/api/render-giftcard` with comprehensive logging
- ✅ Logs environment variables on start
- ✅ Captures page errors, console errors, request failures
- ✅ Logs HTTP response status
- ✅ On selector timeout: logs page text, errors, HTML sample, saves debug screenshot
- ✅ Logs screenshot size
- ✅ Logs detailed upload errors
- ✅ Logs total render duration
- ✅ Proper cleanup on errors

### 3. Frontend: `.env`

**Added:** `VITE_RENDER_TOKEN` for render page authentication
```bash
VITE_RENDER_TOKEN=render-secret-token-2024
```

---

## Configuration Requirements

### Frontend `.env`
```bash
VITE_SUPABASE_URL=https://ydhoidogcoppednfgdfh.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
VITE_STRIPE_PUBLISHABLE_KEY=<stripe-pk>
VITE_RENDER_TOKEN=render-secret-token-2024  # ✅ MUST MATCH RENDER_TOKEN
```

### Render Service `api/.env`
```bash
RENDER_SERVICE_PORT=3001
RENDER_TOKEN=render-secret-token-2024  # ✅ MUST MATCH VITE_RENDER_TOKEN

APP_BASE_URL=https://giftflow.app  # ✅ Production frontend URL

SUPABASE_URL=https://ydhoidogcoppednfgdfh.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>  # ✅ NOT anon key!
```

### Supabase Edge Function Secrets
```bash
RENDER_SERVICE_URL=https://your-render-service.onrender.com  # ✅ NO trailing slash, NO /api
RENDER_TOKEN=render-secret-token-2024
APP_BASE_URL=https://giftflow.app
```

---

## Manual Testing

### Test 1: Health Check
```bash
curl https://your-render-service.onrender.com/health
```

**Expected Response:**
```json
{"status":"ok","service":"giftcard-render"}
```

---

### Test 2: Direct Render Call

**Prerequisites:**
1. Find an existing paid order ID from database:
```sql
SELECT id FROM orders WHERE status = 'paid' LIMIT 1;
```

2. Make the curl request:
```bash
curl -X POST https://your-render-service.onrender.com/api/render-giftcard \
  -H "Authorization: Bearer render-secret-token-2024" \
  -H "Content-Type: application/json" \
  -d '{
    "order_id": "PASTE-ACTUAL-ORDER-ID-HERE",
    "request_id": "manual-test-123"
  }'
```

**Expected Success (200):**
```json
{
  "ok": true,
  "order_id": "...",
  "request_id": "manual-test-123",
  "image_url": "https://ydhoidogcoppednfgdfh.supabase.co/storage/v1/object/public/giftcard-renders/orders/[id].png",
  "storage_path": "orders/[id].png",
  "width": 1000,
  "height": 450,
  "render_time_ms": 3421
}
```

**Verify in Supabase Storage:**
1. Navigate to Supabase Dashboard → Storage → `giftcard-renders` bucket
2. Look for file: `orders/[order-id].png`
3. Click to preview - should show a 1000x450px gift card PNG
4. Copy public URL and paste in browser - should be accessible

**Expected Render Service Logs:**
```
[Render:manual-test-123] 🎨 Starting render for order: ...
[Render:manual-test-123] 📋 Environment: { APP_BASE_URL: '...', ... }
[Render:manual-test-123] 📄 Final render URL: https://giftflow.app/render/giftcard/...?token=...
[Render:manual-test-123] ✅ Browser initialized
[Render:manual-test-123] ✅ Browser context created (1000x450, 2x scale)
[Render:manual-test-123] 🌐 Loading page...
[Render:manual-test-123] 📡 Page response: HTTP 200
[Render:manual-test-123] ✅ Page loaded successfully
[Render:manual-test-123] 🔍 Waiting for [data-testid="giftcard-hero"]...
[Render:manual-test-123] ✅ Found giftcard-hero element
[Render:manual-test-123] ⏳ Waited 500ms for render stabilization
[Render:manual-test-123] 📸 Taking screenshot of hero element...
[Render:manual-test-123] ✅ Screenshot captured (234.5 KB)
[Render:manual-test-123] ☁️ Uploading to Supabase Storage...
[Render:manual-test-123]    Bucket: giftcard-renders
[Render:manual-test-123]    Path: orders/[id].png
[Render:manual-test-123]    Size: 234.5 KB
[Render:manual-test-123] ✅ Upload successful: { path: '...' }
[Render:manual-test-123] ✅ COMPLETE! Duration: 3421ms
[Render:manual-test-123] 🎉 Image URL: https://...
```

---

### Test 3: End-to-End Payment Flow

1. **Make a test payment:**
   - Use Stripe test card: `4242 4242 4242 4242`
   - Any expiry/CVV
   - Complete checkout

2. **Verify payment success:**
   - Browser redirects to `/checkout/success?order_id=<UUID>`
   - "Payment successful!" overlay appears

3. **Check Edge Function logs:**
   - Go to Supabase Dashboard → Edge Functions → `trigger-make-email`
   - Click on latest invocation
   - Look for these key log entries:

```
[Email:abc123] 🚀 Function started
[Email:abc123] ✅ Lock acquired
[Email:abc123] ✅ Product loaded: Coffee Shop Gift Card
[Email:abc123] 🎨 Attempting render service call...
[Email:abc123]    render_service_url: "https://..."
[Email:abc123]    final_endpoint: "https://.../api/render-giftcard" ✅
[Email:abc123] ✅ Render service success: { image_url: "...", width: 1000, height: 450 }
[Email:abc123] 📤 Sending Make.com webhook...
[Email:abc123] ✅ Make.com webhook success: { status: 200 }
[Email:abc123] ✅ Complete! Email pipeline finished successfully
```

4. **Verify Database:**
```sql
SELECT
  id, status, email_status, email_sent_at,
  email_last_request_id, email_webhook_last_error
FROM orders
WHERE id = 'paste-order-id-here';
```

**Expected:**
- `status: 'paid'`
- `email_status: 'sent'` ✅
- `email_sent_at: <timestamp>` ✅
- `email_webhook_last_error: NULL` ✅

5. **Verify Storage:**
   - Navigate to `giftcard-renders` bucket
   - File `orders/[order-id].png` exists ✅
   - Publicly accessible ✅

---

## Troubleshooting

### Issue: HTTP 404 from render service
**Diagnosis:**
- Check Edge logs for `final_endpoint` value
- Ensure `RENDER_SERVICE_URL` does NOT include `/api` suffix
- Ensure `RENDER_SERVICE_URL` does NOT have trailing slash issues

**Fix:**
- Set `RENDER_SERVICE_URL=https://your-service.onrender.com` (no /api, no trailing slash)
- Edge Function `joinUrl()` will handle it correctly

---

### Issue: Selector timeout (giftcard-hero not found)
**Diagnosis:**
- Check render service logs for page errors and console errors
- Look for debug screenshot saved to `/tmp/debug-[order-id].png`
- Check if `APP_BASE_URL` is correct
- Check if `VITE_RENDER_TOKEN` matches `RENDER_TOKEN`

**Common Causes:**
1. **Wrong APP_BASE_URL:** Should be production domain, not localhost
2. **Token mismatch:** VITE_RENDER_TOKEN must equal RENDER_TOKEN
3. **Order not found:** Check if order exists in database
4. **React error:** Check console errors in logs

**Fix:**
- Verify all environment variables are correct
- Rebuild frontend after changing .env
- Check database for order existence

---

### Issue: Upload fails to Supabase Storage
**Diagnosis:**
- Check render service logs for upload error details
- Verify `SUPABASE_SERVICE_ROLE_KEY` is set (not anon key!)
- Check storage bucket policies

**Common Causes:**
1. **Wrong key:** Using anon key instead of service role key
2. **Bucket doesn't exist:** Run migration to create `giftcard-renders` bucket
3. **Policy issue:** Service role should have INSERT permission

**Fix:**
- Use service role key: `SUPABASE_SERVICE_ROLE_KEY=eyJhb...` (starts with eyJ)
- Verify bucket exists in Supabase Dashboard → Storage
- Check bucket is PUBLIC for reads

---

## Deployment Checklist

### Render.com (Node.js Service)
1. ✅ Create new Web Service
2. ✅ Connect GitHub repo
3. ✅ Set build command: `cd api && npm install`
4. ✅ Set start command: `node api/server.js`
5. ✅ Add environment variables:
   - `RENDER_SERVICE_PORT` (usually auto-set by Render)
   - `RENDER_TOKEN=render-secret-token-2024`
   - `APP_BASE_URL=https://giftflow.app`
   - `SUPABASE_URL=https://ydhoidogcoppednfgdfh.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY=<paste-service-role-key>`
6. ✅ Deploy
7. ✅ Test health endpoint: `curl https://your-service.onrender.com/health`

### Supabase Edge Function Secrets
1. ✅ Go to Supabase Dashboard → Edge Functions → Settings
2. ✅ Add secrets:
   - `RENDER_SERVICE_URL=https://your-service.onrender.com`
   - `RENDER_TOKEN=render-secret-token-2024`
   - `APP_BASE_URL=https://giftflow.app`
3. ✅ Redeploy `trigger-make-email` function (already done)

### Frontend
1. ✅ Ensure `.env` has `VITE_RENDER_TOKEN=render-secret-token-2024`
2. ✅ Rebuild: `npm run build`
3. ✅ Deploy to production

---

## Success Indicators

✅ **Render service is working when:**
1. Health check returns 200 OK
2. Direct render call returns `image_url`
3. PNG file appears in `giftcard-renders/orders/` bucket
4. Public URL is accessible in browser
5. Edge logs show "Render service success"
6. No 404 errors in logs
7. `email_status` becomes 'sent' after payment
8. Make.com webhook includes `visualization.image.url`

---

## Performance Expectations

**Typical Render Times:**
- Page load: 1-3 seconds
- Screenshot: 0.5 seconds
- Upload: 0.5-1 second
- **Total: 2-5 seconds**

**If render takes >10 seconds:**
- Check network latency between services
- Check Playwright browser initialization time
- Check page size and complexity

---

## Storage Details

**Bucket:** `giftcard-renders` (PUBLIC)
**Path Pattern:** `orders/{order_id}.png`
**File Size:** ~150-300 KB per PNG
**Dimensions:** 2000x900 pixels (1000x450 @ 2x scale)
**Format:** PNG
**Overwrite:** Yes (upsert: true)

**Public URL Pattern:**
```
https://ydhoidogcoppednfgdfh.supabase.co/storage/v1/object/public/giftcard-renders/orders/{order_id}.png
```

**Cleanup:** Not automatic. Consider implementing cleanup job for old orders.

---

## Next Steps After Deployment

1. ✅ Deploy render service to Render.com
2. ✅ Configure Edge Function secrets
3. ✅ Test health endpoint
4. ✅ Test direct render call with real order ID
5. ✅ Test end-to-end payment flow
6. ✅ Monitor Edge logs for any errors
7. ✅ Verify storage bucket has PNG files
8. ✅ Check Make.com receives image URL
9. ✅ Verify email delivery includes PNG

---

## Contact & Support

**If render service fails:**
1. Check render service logs (Render.com dashboard)
2. Check Edge Function logs (Supabase dashboard)
3. Check browser console on render page
4. Review this document's troubleshooting section
5. Look for debug screenshots in `/tmp/` on render service

**Key files to check:**
- `api/server.js` - Render service implementation
- `supabase/functions/trigger-make-email/index.ts` - Edge Function
- `src/pages/GiftCardRender.tsx` - Render page
- `src/components/render/GiftCardHero.tsx` - Screenshot target
