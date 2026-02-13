# Stripe Connect Express Implementation - GiftcardFlow

## ✅ COMPLETED IMPLEMENTATION

### 1. Database Schema (Supabase)

**Migration: `add_stripe_connect_and_payment_fields`**
- Added Stripe Connect fields to `user_profiles`:
  - `stripe_connect_account_id` - Stores Connect Express account ID
  - `stripe_onboarding_status` - Tracks onboarding ('not_connected', 'pending', 'complete')
  - `platform_fee_bps` - Platform fee in basis points (default 500 = 5%)
- Enhanced `orders` table:
  - `stripe_payment_intent_id` - Unique payment intent ID
  - `stripe_charge_id` - Charge ID from Stripe
  - `recipient_phone` - Phone in E.164 format
  - `amount_cents` - Amount in minor currency units
  - `gift_card_product_id` - Reference to gift card product
  - Updated status constraint to include 'paid' and 'failed'

**Migration: `create_redemptions_and_redeem_function`**
- Created `redemptions` table:
  - Tracks all redemption transactions
  - Links to gift_cards with foreign keys
  - Stores amount in cents for precision
  - Includes RLS policies for security

- Created `redeem_gift_card()` RPC function:
  - Atomic, transaction-safe redemption
  - Validates card status, expiration, and balance
  - Prevents double redemption with row locking
  - Updates balance and creates audit trail
  - Returns detailed success/error responses

### 2. Edge Functions (Supabase)

**stripe-connect-onboarding** (`verify_jwt: true`)
- Creates or retrieves Stripe Connect Express account
- Generates account onboarding link
- Stores account ID in user_profiles
- Returns URL for Stripe hosted onboarding

**create-payment-intent** (`verify_jwt: false` - public)
- Validates gift card product and amount
- Checks merchant onboarding status
- Calculates platform fee
- Creates PaymentIntent with Connect destination
- Uses `transfer_data` for direct merchant payout
- Stores metadata for webhook processing

**stripe-webhook** (`verify_jwt: false` - webhook)
- Verifies Stripe webhook signature
- Handles `payment_intent.succeeded`:
  - Creates order record (idempotent)
  - Generates unique gift card code (GC-XXXXXXXXXX format)
  - Creates gift_cards record with balance
  - Creates ledger entry for audit trail
- Handles `account.updated`:
  - Syncs merchant onboarding status

**validate-gift-card** (`verify_jwt: true`)
- Validates gift card code
- Returns balance, status, expiration
- Used by admin Redeem page

### 3. Admin Pages

**Payments Settings Page** (`/app/settings/payments`)
- Shows Stripe Connect status with visual indicators
- "Connect Stripe" / "Complete Setup" / "Manage Account" buttons
- Displays platform fee information
- Shows calculated merchant payout examples
- Automatic status refresh after onboarding return

**Updated Redeem Page** (`/app/redeem`)
- Uses real validation endpoint
- Calls atomic `redeem_gift_card()` RPC function
- Shows balance in cents (converted to dollars for display)
- "Redeem Full Balance" quick action
- Real-time balance updates
- Handles depleted cards gracefully

**Updated Analytics & Customers Pages**
- All demo data removed
- Real data computed from orders table
- Properly scoped by user_id
- Zero states for empty data

### 4. Navigation & Routing

- Added "Payments" to sidebar navigation
- Route: `/app/settings/payments`
- Icon: CreditCard from lucide-react

### 5. Environment & Dependencies

- Added `@stripe/stripe-js` and `@stripe/react-stripe-js` packages
- Added `VITE_STRIPE_PUBLISHABLE_KEY` to environment variables
- All Stripe secrets auto-configured in edge functions

## 🚧 REMAINING WORK

### Public Checkout with Stripe Elements

The public checkout pages (`PublicGiftCard.tsx` and `PublicCollection.tsx`) need to be updated to:

1. **Check Merchant Status**
   - Query merchant's `stripe_onboarding_status`
   - Show friendly "Coming Soon" message if not connected
   - Only enable checkout if status is 'complete'

2. **Integrate Stripe Elements**
   - Wrap checkout form with `<Elements>` provider from `@stripe/react-stripe-js`
   - Use `<PaymentElement>` for card input
   - Call `create-payment-intent` edge function on amount selection
   - Pass `client_secret` to Elements

3. **Handle Payment Confirmation**
   - Use `stripe.confirmPayment()` from Stripe.js
   - Show loading states during processing
   - Handle errors with inline messages (card declined, etc.)
   - On success, redirect to result page with `payment_intent` ID

4. **Payment Result Page** (`/payment/result?payment_intent=pi_xxx`)
   - Poll backend for order creation (webhook may be delayed)
   - Query orders by `stripe_payment_intent_id`
   - Show "Processing..." then "Success!" with gift card details
   - Display generated gift card code
   - Option to email (future enhancement)

### Example Checkout Integration Snippet

```tsx
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

function CheckoutForm({ productId, amount }) {
  const stripe = useStripe();
  const elements = useElements();
  const [clientSecret, setClientSecret] = useState('');

  useEffect(() => {
    // Create payment intent
    fetch(`${SUPABASE_URL}/functions/v1/create-payment-intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gift_card_product_id: productId,
        amount_cents: amount * 100,
        currency: 'usd',
        // ... other fields
      }),
    })
      .then(res => res.json())
      .then(data => setClientSecret(data.client_secret));
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/payment/result`,
      },
    });

    if (error) {
      setError(error.message);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <PaymentElement />
      <button type="submit" disabled={!stripe}>Pay</button>
    </form>
  );
}

// In parent component:
<Elements stripe={stripePromise} options={{ clientSecret }}>
  <CheckoutForm />
</Elements>
```

## 🔐 SECURITY NOTES

- Webhook endpoint verifies Stripe signature
- All database operations scoped by `user_id`
- Service role key only used in edge functions (server-side)
- RLS policies enforce data isolation
- Atomic redemption prevents race conditions

## 💰 MONEY FLOW

1. Customer pays $100 for gift card
2. Platform fee: $5 (5% = 500 basis points)
3. Merchant receives: $95 directly to Connect account
4. Platform receives: $5 as application_fee_amount
5. Stripe's fee (~2.9% + $0.30) deducted from merchant's portion

## 🧪 TESTING CHECKLIST

### Merchant Onboarding
- [ ] Navigate to Payments page
- [ ] Click "Connect Stripe"
- [ ] Complete Stripe Express onboarding flow
- [ ] Verify status updates to "Connected"

### Payment Processing (requires Stripe test mode)
- [ ] Merchant must be connected
- [ ] Public checkout creates PaymentIntent
- [ ] Test card: 4242 4242 4242 4242 succeeds
- [ ] Webhook creates order + gift card
- [ ] Gift card code is unique and valid
- [ ] Balance matches payment amount

### Redemption
- [ ] Validate gift card code
- [ ] Redeem partial amount
- [ ] Verify balance updates
- [ ] Redeem full balance
- [ ] Verify status changes to 'depleted'
- [ ] Check ledger entries created

## 📝 WEBHOOK CONFIGURATION

In Stripe Dashboard, configure webhook endpoint:

```
URL: https://[PROJECT_ID].supabase.co/functions/v1/stripe-webhook
Events: payment_intent.succeeded, account.updated
Secret: [Generated by Stripe, configure as STRIPE_WEBHOOK_SECRET]
```

## ✨ KEY FEATURES

- ✅ Real Stripe Connect Express integration
- ✅ Direct merchant payouts (not platform balance)
- ✅ Configurable platform fees
- ✅ Idempotent webhook processing
- ✅ Atomic gift card redemption
- ✅ Unique code generation with collision handling
- ✅ Comprehensive audit trail (ledger + redemptions)
- ✅ Merchant onboarding status tracking
- ✅ All demo data removed from analytics
- ✅ Production-ready error handling
