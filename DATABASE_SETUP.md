# GiftFlow - Database & Auth Integration

## Overview
Complete Supabase Auth + PostgreSQL integration for the GiftFlow SaaS application.

## Database Schema

### Tables Created

1. **user_profiles** - User/business profile information
   - `user_id` (PK) - References auth.users
   - `business_name` - Business name
   - `full_name` - User full name
   - `email` - Contact email
   - `currency` - Default currency (USD, EUR, GBP, CAD)

2. **gift_card_product_config** - Gift card settings (one per user)
   - `user_id` (PK) - References auth.users
   - `gift_card_name` - Display name for gift cards
   - `currency` - Currency code
   - `preset_amounts` - Array of preset amounts [25, 50, 100]
   - `allow_custom_amount` - Boolean flag
   - `min_amount` / `max_amount` - Custom amount limits
   - `expiry_months` - Expiration policy (null = no expiry)

3. **orders** - Gift card purchase orders
   - `id` (PK) - UUID
   - `user_id` (FK) - References auth.users
   - `order_number` - Unique order identifier (GF-XXXX)
   - `buyer_email` - Purchaser email
   - `recipient_email` - Gift card recipient
   - `amount` - Purchase amount
   - `currency` - Currency code
   - `status` - Order status (pending, delivered, refunded)

4. **gift_cards** - Individual gift card instances
   - `id` (PK) - UUID
   - `user_id` (FK) - References auth.users
   - `order_id` (FK) - References orders (nullable)
   - `code` - Unique gift card code (GC-XXXXXXXXX)
   - `initial_amount` - Original value
   - `balance` - Current balance
   - `currency` - Currency code
   - `status` - Card status (active, disabled, expired, depleted)
   - `expires_at` - Expiration date (nullable)
   - `issued_to_email` - Recipient email

5. **gift_card_ledger** - Transaction audit trail
   - `id` (PK) - UUID
   - `user_id` (FK) - References auth.users
   - `gift_card_id` (FK) - References gift_cards
   - `type` - Transaction type (issue, redeem, adjust, refund)
   - `amount` - Transaction amount (negative for redemptions)
   - `note` - Optional notes

6. **team_members** - Team invitations and roles
   - `id` (PK) - UUID
   - `user_id` (FK) - Owner user ID
   - `member_email` - Team member email
   - `role` - Role (Admin, Staff)
   - `status` - Invitation status (invited, active, inactive)

7. **customers** (VIEW) - Aggregated customer statistics
   - `user_id` - Business owner
   - `email` - Customer email
   - `total_orders` - Number of orders
   - `total_spent` - Total purchase amount
   - `first_order_date` - First purchase date

## Security

### Row Level Security (RLS)
All tables have RLS enabled with policies that restrict access to:
- `user_id = auth.uid()`

### Policies
- SELECT: Users can view their own data
- INSERT: Users can insert their own data
- UPDATE: Users can update their own data
- DELETE: Users can delete their own data

## Authentication

### Supabase Auth Integration
- Email/password signup
- Email/password login
- Session management with automatic refresh
- Profile creation on signup
- Default gift card config creation on signup

### Protected Routes
All `/app/*` routes require authentication and redirect to `/signin` if not authenticated.

## Features Implemented

### Dashboard (`/app/dashboard`)
- Real-time KPI cards (sales, active cards, redeemed amount, balance)
- Sales over time line chart
- Recent orders table
- **Create Test Order** button for development/testing

### Gift Cards (`/app/gift-cards`)
- Load gift card settings from database
- Edit gift card name, currency, preset amounts
- Toggle custom amount with min/max limits
- Set expiration policies
- Live preview of gift card widget
- Save to database with upsert

### Redeem (`/app/redeem`)
- Validate gift card by code
- Display current balance
- Redeem partial amounts
- Update balance and create ledger entries
- Transaction safety with atomic updates

### Orders (`/app/orders`)
- View all orders from database
- Order details drawer with gift card information
- Status indicators

### Customers (`/app/customers`)
- Aggregate customer data from orders view
- Display total orders and spending

### Analytics (`/app/analytics`)
- Computed from real order and gift card data
- Charts and insights

### Settings (`/app/settings`)
- Update business profile
- Team member management (UI connected to database)

## Helper Functions

### `createTestOrder(userId: string)`
Creates a complete test order including:
1. Order record with random amount and email
2. Gift card with unique code
3. Ledger entry for issuance

### `redeemGiftCard(userId: string, giftCardId: string, amount: number)`
Safely redeems a gift card:
1. Validates balance
2. Updates gift card balance
3. Creates ledger entry
4. Updates status if depleted

## Database Functions

### `generate_gift_card_code()`
Generates unique gift card codes in format: `GC-XXXXXXXXX`

### `generate_order_number()`
Generates unique order numbers in format: `GF-XXXX`

### `update_updated_at_column()`
Trigger function to automatically update `updated_at` timestamps

## Testing the Application

### 1. Sign Up
- Navigate to `/signup`
- Create account with business name, name, email, password
- Auto-creates profile and default gift card config

### 2. Create Test Orders
- Go to Dashboard
- Click "Create Test Order"
- Creates order with gift card

### 3. Configure Gift Cards
- Go to Gift Cards page
- Modify settings
- Click Save Changes

### 4. Redeem Gift Cards
- Go to Redeem page
- Enter gift card code (from orders)
- Validate and redeem amount

### 5. View Analytics
- Dashboard shows real-time stats
- Analytics page shows trends
- Customers page shows aggregated data

## Environment Variables Required

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

## Data Flow

1. **User signs up** → Creates user_profiles + gift_card_product_config
2. **Test order created** → Creates order + gift_card + ledger entry
3. **Gift card redeemed** → Updates gift_card balance + creates ledger entry
4. **Settings saved** → Upserts to respective tables
5. **Dashboard loads** → Queries orders, gift_cards, ledger for stats

## Migration Applied

Migration file: `create_giftflow_schema`
- Creates all tables with proper types and constraints
- Sets up RLS policies
- Creates helper functions
- Creates triggers for updated_at
- Creates customers view

## Notes

- All monetary amounts stored as `numeric(10, 2)`
- All timestamps use `timestamptz` for timezone support
- Array fields (preset_amounts) use PostgreSQL array type
- Unique constraints on gift card codes per user
- Foreign key cascades properly configured
- Indexes added for common queries
