# Gift Card Image Rendering Setup

This document explains how to set up the gift card image rendering pipeline for email delivery.

## Overview

The system generates pixel-perfect PNG images (1000x450) of gift card visualizations that match the in-app design exactly. These images are:
- Used in email delivery via Make.com
- Stored in Supabase Storage for long-term access
- Generated server-side using Playwright (headless Chromium)

## Architecture

1. **Render Page** (`/render/giftcard/:orderId`) - React page that displays the gift card hero at fixed 1000x450 size
2. **Render Service** (`/api`) - Node.js service that uses Playwright to screenshot the render page
3. **Edge Function** (`trigger-make-email`) - Calls the render service and includes image URL in Make.com webhook
4. **Storage** - Supabase Storage bucket `giftcard-renders` stores the PNG files

## Required Environment Variables

### Main React App (.env)

```bash
# Render authentication token (must match render service)
VITE_RENDER_TOKEN=render-secret-token-2024

# Existing Supabase variables
VITE_SUPABASE_URL=your-supabase-url
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### Render Service (api/.env)

```bash
# Service configuration
RENDER_SERVICE_PORT=3001
RENDER_TOKEN=render-secret-token-2024

# Application URL (where React app is running)
APP_BASE_URL=http://localhost:5173

# Supabase configuration (for storage uploads)
SUPABASE_URL=your-supabase-url
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### Edge Function Environment (Supabase Dashboard)

Set these in Supabase Dashboard → Edge Functions → Environment Variables:

```bash
# Render service endpoint
RENDER_SERVICE_URL=http://your-render-service-url:3001
RENDER_TOKEN=render-secret-token-2024
```

**Note:** If `RENDER_SERVICE_URL` or `RENDER_TOKEN` are not configured, the edge function will skip image generation and only send HTML email content (fallback mode).

## Setup Instructions

### 1. Install Render Service Dependencies

```bash
cd api
npm install
npx playwright install chromium
```

### 2. Configure Environment Variables

Create `api/.env` from the example:
```bash
cp api/.env.example api/.env
# Edit api/.env with your values
```

Add `VITE_RENDER_TOKEN` to main app `.env`:
```bash
echo "VITE_RENDER_TOKEN=render-secret-token-2024" >> .env
```

### 3. Start the Render Service

**Development:**
```bash
cd api
npm run dev
```

**Production:**
```bash
cd api
npm start
```

The service will run on `http://localhost:3001` (or `RENDER_SERVICE_PORT`).

### 4. Configure Edge Function Environment Variables

In Supabase Dashboard:
1. Go to Edge Functions
2. Click on `trigger-make-email`
3. Add environment variables:
   - `RENDER_SERVICE_URL`: Your render service URL (e.g., `http://localhost:3001` for local dev)
   - `RENDER_TOKEN`: Same token as in `api/.env`

### 5. Verify Setup

1. Start the main app:
   ```bash
   npm run dev
   ```

2. Start the render service:
   ```bash
   cd api && npm run dev
   ```

3. Test the render page directly:
   ```
   http://localhost:5173/render/giftcard/YOUR_ORDER_ID?token=render-secret-token-2024
   ```

4. Test the render service:
   ```bash
   curl -X POST http://localhost:3001/api/render-giftcard \
     -H "Authorization: Bearer render-secret-token-2024" \
     -H "Content-Type: application/json" \
     -d '{"order_id":"YOUR_ORDER_ID"}'
   ```

## Deployment

### Deploy Main App
Deploy as usual (Vercel, Netlify, etc.). Ensure `VITE_RENDER_TOKEN` is set in environment variables.

### Deploy Render Service

The render service needs to run separately from the main app. Options:

#### Option 1: Docker (Recommended)
Create `api/Dockerfile`:
```dockerfile
FROM node:20-slim

# Install Playwright dependencies
RUN apt-get update && apt-get install -y \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libxcomposite1 \
    libxdamage1 libxfixes3 libxrandr2 libgbm1 \
    libasound2 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci
RUN npx playwright install chromium

COPY . .
EXPOSE 3001
CMD ["npm", "start"]
```

Deploy to Railway, Render.com, Fly.io, etc.

#### Option 2: Serverless with Browserless.io
Use a browser automation service instead of running Chromium. Update `api/server.js` to connect to Browserless.io instead of launching local browser.

#### Option 3: Platform-Specific
- **Heroku**: Add buildpack for Playwright dependencies
- **Railway**: Deploy from `/api` directory
- **Render.com**: Deploy as Web Service with Playwright build command

### Update Edge Function URLs

After deploying the render service, update the Edge Function environment variable:
```
RENDER_SERVICE_URL=https://your-deployed-render-service.com
```

## Security Notes

1. **Token Protection**: The `RENDER_TOKEN` prevents unauthorized access to render endpoints
2. **Storage Policies**: Only service role can upload; public can read (safe for emails)
3. **Rate Limiting**: Consider adding rate limiting to the render service in production
4. **CORS**: The render service has unrestricted CORS (needed for Edge Function calls)

## Troubleshooting

### "Unauthorized" error on render page
- Check that `VITE_RENDER_TOKEN` matches the token in the URL query parameter
- Verify the token is set in both app `.env` and render service `.env`

### Playwright installation issues
```bash
cd api
npx playwright install-deps
npx playwright install chromium
```

### Fonts not rendering correctly
The app uses Inter font. Ensure it's loaded via CSS in the render page. The service uses `deviceScaleFactor: 2` for high-quality screenshots.

### Browser launch fails on Linux
Install system dependencies:
```bash
apt-get install -y libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
  libxfixes3 libxrandr2 libgbm1 libasound2
```

### Edge Function can't reach render service
- For local development, ensure render service is running on accessible host
- For production, verify `RENDER_SERVICE_URL` is correct and service is publicly accessible
- Check firewall/security group settings

### Image not appearing in email
- Verify the image uploaded to Supabase Storage successfully
- Check that the bucket `giftcard-renders` is public
- Verify the image URL is included in Make.com webhook payload
- Test the image URL directly in a browser

## Make.com Payload Structure

When image rendering is successful, the webhook payload includes:

```json
{
  "event": "giftcard.generated",
  "visualization": {
    "type": "image",
    "image": {
      "url": "https://your-supabase-storage.com/giftcard-renders/orders/uuid.png",
      "width": 1000,
      "height": 450,
      "format": "png"
    },
    "html": {
      "subject": "Your Gift Card",
      "html_snippet": "...",
      "css_vars": {...}
    }
  }
}
```

If image rendering fails or is not configured:
```json
{
  "visualization": {
    "type": "html",
    "html": {
      "subject": "Your Gift Card",
      "html_snippet": "...",
      "css_vars": {...}
    }
  }
}
```

## Cost Considerations

- **Storage**: ~50-100 KB per PNG image
- **Compute**: Playwright/Chromium uses ~200-300 MB RAM per render
- **Bandwidth**: Public bucket access is free for reasonable usage

For high volume, consider:
- Caching renders (same product/branding can reuse image)
- Using serverless functions with browser automation services
- Implementing cleanup jobs to remove old renders
