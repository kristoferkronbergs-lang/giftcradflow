# Stripe Connect & Redeem Fixes - Applied

## ✅ COMPLETED FIXES

### A) Fixed Stripe Connect Onboarding Flow

**Problem:** Clicking "Connect to Stripe" or "Get Started" resulted in "Failed to start Stripe onboarding" error.

**Root Causes:**
1. Edge function was using `req.headers.get("origin")` which could be null/undefined
2. No proper error validation for missing environment variables
3. Frontend not passing explicit return URL
4. No inline error display on frontend

**Solutions Applied:**

#### 1. Updated Edge Function (`stripe-connect-onboarding`)
- Added explicit validation for `STRIPE_SECRET_KEY` environment variable
- Changed to accept `return_url` in request body instead of deriving from headers
- Improved error messages for debugging
- Properly construct return URL with query parameters

**File:** `supabase/functions/stripe-connect-onboarding/index.ts`
```typescript
// Now validates environment
const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
if (!stripeSecretKey) {
  throw new Error("STRIPE_SECRET_KEY not configured");
}

// Now accepts return_url from request
const body = await req.json();
const { return_url } = body;

// Creates proper account links
const accountLink = await stripe.accountLinks.create({
  account: accountId,
  refresh_url: return_url,
  return_url: `${return_url}${return_url.includes('?') ? '&' : '?'}success=true`,
  type: "account_onboarding",
});
```

#### 2. Updated Payments Page
- Added explicit return URL construction using `window.location.origin`
- Added inline error state and display
- Improved error handling with try-catch
- Shows errors in red alert box instead of browser alert

**File:** `src/pages/Payments.tsx`
```typescript
const handleConnectStripe = async () => {
  try {
    setConnecting(true);
    setError('');

    const returnUrl = `${window.location.origin}/app/settings/payments`;

    const response = await fetch(apiUrl, {
      method: 'POST',
      body: JSON.stringify({ return_url: returnUrl }),
      // ...
    });

    const { url } = await response.json();
    window.location.href = url; // Navigates to Stripe in same tab
  } catch (error) {
    setError(error.message); // Shows inline error
  }
}
```

**UX Improvements:**
- No browser alerts - errors shown inline in red card
- Loading state with spinner during connection
- Automatic redirect to Stripe hosted onboarding
- Returns to app automatically after completion

---

### B) Fixed Gift Card Redemption - Code Not Found

**Problem:** Existing paid gift cards entered on Redeem page returned "Gift card not found" error.

**Root Causes:**
1. No code normalization - variations in spacing/casing/hyphens caused mismatches
2. Users could enter: "GC ABC123XYZ", "gc-abc123xyz", "GCABC123XYZ", etc.
3. Database stores: "GC-ABC123XYZ" (standard format)
4. Direct string comparison failed on variations

**Solutions Applied:**

#### 1. Added Code Normalization to Validation Endpoint

**File:** `supabase/functions/validate-gift-card/index.ts`
```typescript
// Normalizes code before lookup
const normalizedCode = code
  .toString()
  .trim()                      // Remove whitespace
  .toUpperCase()               // Convert to uppercase
  .replace(/[\s-]/g, "")       // Remove all spaces and hyphens
  .replace(/^GC/, "GC-");      // Re-add standard GC- prefix

// Query using normalized code
const { data: giftCard } = await supabaseClient
  .from("gift_cards")
  .select("...")
  .eq("code", normalizedCode)  // Now matches regardless of input format
  .eq("user_id", user.id)
  .maybeSingle();
```

#### 2. Updated Redeem RPC Function with Same Normalization

**Migration:** `update_redeem_gift_card_normalize_codes`

Added code normalization logic to the atomic `redeem_gift_card()` function:

```sql
-- Normalize the gift card code
v_normalized_code := regexp_replace(upper(trim(p_code)), '[\s-]', '', 'g');
v_normalized_code := regexp_replace(v_normalized_code, '^GC', 'GC-');

-- Lock the gift card row for update
SELECT * INTO v_gift_card
FROM gift_cards
WHERE code = v_normalized_code AND user_id = p_user_id
FOR UPDATE;
```

**Normalization Rules:**
1. Trim whitespace from both ends
2. Convert entire string to uppercase
3. Remove ALL spaces and hyphens
4. Re-add "GC-" prefix in standard position

**Examples of Handled Variations:**
- Input: `"gc abc123xyz"` → Normalized: `"GC-ABC123XYZ"` ✅
- Input: `"GC - ABC123XYZ"` → Normalized: `"GC-ABC123XYZ"` ✅
- Input: `"GCABC123XYZ"` → Normalized: `"GC-ABC123XYZ"` ✅
- Input: `" GC-ABC123XYZ "` → Normalized: `"GC-ABC123XYZ"` ✅

#### 3. Maintained Atomic Transaction Safety

The redeem function still:
- Uses row-level locking (`FOR UPDATE`)
- Prevents double redemption
- Validates status, expiration, balance
- Creates audit trail (redemptions + ledger)
- Returns detailed success/error responses

---

## 🧪 TESTING GUIDE

### Test Stripe Connect Onboarding

1. **Start Onboarding:**
   - Navigate to `/app/settings/payments`
   - Click "Connect to Stripe" or "Get Started"
   - Should redirect to Stripe hosted onboarding (no error alert)

2. **Complete Onboarding:**
   - Fill out Stripe Express onboarding form
   - Submit and wait for redirect
   - Should return to Payments page with `?success=true` in URL
   - Status should update to "Connected" after page refresh

3. **Error Handling:**
   - If error occurs, check red error box appears inline
   - Console logs show detailed error for debugging
   - No browser alert popup

### Test Gift Card Redemption

1. **Validate Various Code Formats:**
   Enter a test gift card code in different formats:
   - `GC-ABC123XYZ` (standard)
   - `gc-abc123xyz` (lowercase)
   - `GC ABC123XYZ` (spaces instead of hyphen)
   - `GC - ABC123XYZ` (spaces with hyphen)
   - `GCABC123XYZ` (no separators)
   - ` GC-ABC123XYZ ` (with whitespace)

   All should successfully find the same gift card ✅

2. **Redeem Partial Amount:**
   - Validate card
   - Enter amount less than balance
   - Click "Redeem"
   - Verify balance decreases correctly

3. **Redeem Full Balance:**
   - Click "Redeem Full Balance" button
   - Amount input fills with current balance
   - Click "Redeem"
   - Verify status changes to "depleted"
   - Verify card cannot be validated again as active

4. **Edge Cases:**
   - Try expired card → Shows "expired" error
   - Try non-existent code → Shows "not found" error
   - Try amount > balance → Shows "insufficient balance" error

---

## 🔍 TROUBLESHOOTING

### Stripe Connect Still Fails

**Check:**
1. Environment variable `STRIPE_SECRET_KEY` is set in Supabase edge functions
2. Using correct Stripe account (test vs live mode)
3. Browser console for detailed error messages
4. Edge function logs in Supabase dashboard

**Common Fixes:**
- Ensure Stripe API key is test key starting with `sk_test_`
- Verify edge function deployed successfully
- Check CORS headers if using custom domain

### Gift Card Still Not Found

**Check:**
1. Gift card actually exists in database
2. Gift card status is "active" (not "depleted" or "expired")
3. Gift card belongs to current user's account (user_id matches)
4. Code stored in database matches standard format "GC-XXXXXXXXXX"

**Debug Query:**
```sql
SELECT code, status, balance, user_id
FROM gift_cards
WHERE code LIKE 'GC-%'
ORDER BY created_at DESC
LIMIT 10;
```

**Common Issues:**
- Card belongs to different user/account
- Card status is not "active"
- Balance is 0 (shows as "depleted")
- Expires_at is in the past

---

## 📋 SUMMARY OF CHANGES

### Files Modified:
1. `supabase/functions/stripe-connect-onboarding/index.ts` - Fixed onboarding flow
2. `src/pages/Payments.tsx` - Added error handling and return URL
3. `supabase/functions/validate-gift-card/index.ts` - Added code normalization
4. Database migration: `update_redeem_gift_card_normalize_codes` - Updated RPC function

### Edge Functions Deployed:
- ✅ `stripe-connect-onboarding` (re-deployed)
- ✅ `validate-gift-card` (re-deployed)

### Database Changes:
- ✅ Updated `redeem_gift_card()` function with normalization

### Build Status:
- ✅ Production build successful
- ✅ No TypeScript errors
- ✅ All dependencies installed

---

## ✨ IMPROVEMENTS MADE

**UX Enhancements:**
- Inline error messages (no browser alerts)
- Loading states during async operations
- Clear visual feedback for all states
- Automatic redirects for smooth flow

**Code Quality:**
- Comprehensive error handling
- Detailed error messages for debugging
- Consistent code normalization across all endpoints
- Maintained atomic transaction safety

**Reliability:**
- Environment variable validation
- Proper CORS headers
- Row-level locking for concurrency
- Idempotent webhook processing

**Developer Experience:**
- Clear console error logging
- Detailed migration comments
- Comprehensive documentation
- Easy-to-debug error messages
