# Gift Card Render Service

This is a Node.js service that uses Playwright to generate pixel-perfect screenshots of gift card visualizations for email delivery.

## Setup

1. Install dependencies:
```bash
cd api
npm install
```

2. Install Playwright browsers:
```bash
npx playwright install chromium
```

3. Create `.env` file from `.env.example`:
```bash
cp .env.example .env
```

4. Configure environment variables in `.env`:
- `RENDER_SERVICE_PORT`: Port for the render service (default: 3001)
- `RENDER_TOKEN`: Secret token for authentication (must match VITE_RENDER_TOKEN in main app)
- `APP_BASE_URL`: URL where the React app is running (e.g., http://localhost:5173 for dev)
- `SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase service role key (for storage uploads)

## Running the Service

### Development
```bash
npm run dev
```

### Production
```bash
npm start
```

## API Endpoints

### Health Check
```
GET /health
```

Returns service status.

### Render Gift Card
```
POST /api/render-giftcard
Headers:
  Authorization: Bearer YOUR_RENDER_TOKEN
  Content-Type: application/json
Body:
  {
    "order_id": "uuid-of-order"
  }
```

Returns:
```json
{
  "ok": true,
  "order_id": "uuid",
  "image_url": "https://supabase-storage-url/...",
  "storage_path": "orders/uuid.png",
  "width": 1000,
  "height": 450
}
```

## How It Works

1. Receives order_id in POST request
2. Opens the render page at `/render/giftcard/:orderId?token=RENDER_TOKEN`
3. Uses Playwright to load the page with viewport 1000x450
4. Waits for the gift card hero element to render
5. Takes a screenshot of the hero element
6. Uploads PNG to Supabase Storage bucket `giftcard-renders`
7. Returns public URL of the uploaded image

## Deployment

This service can be deployed separately from the main app:

### Option 1: Docker
Create a `Dockerfile` and deploy to any container platform.

### Option 2: Platform-specific
- **Heroku**: Add to `Procfile`
- **Railway**: Deploy from `/api` directory
- **Render.com**: Deploy as a web service
- **Fly.io**: Use `fly.toml` configuration

### Option 3: Serverless
The service maintains a browser instance for performance. For serverless:
- Use a browser automation service (e.g., Browserless.io)
- Or accept cold starts and close browser after each request

## Environment Variables for Main App

The React app needs this environment variable:
```
VITE_RENDER_TOKEN=render-secret-token-2024
```

This token is used to authenticate render page requests.

## Security

- The render endpoint requires Bearer token authentication
- The render page validates the token in query params
- Only service role can upload to Supabase Storage
- Renders are stored in a public bucket (safe for email delivery)

## Troubleshooting

### Playwright Installation Issues
If you encounter issues installing Playwright:
```bash
npx playwright install-deps
npx playwright install chromium
```

### Browser Launch Fails
On Linux servers, you may need additional dependencies:
```bash
# Ubuntu/Debian
apt-get install -y \
  libnss3 \
  libnspr4 \
  libatk1.0-0 \
  libatk-bridge2.0-0 \
  libcups2 \
  libdrm2 \
  libxkbcommon0 \
  libxcomposite1 \
  libxdamage1 \
  libxfixes3 \
  libxrandr2 \
  libgbm1 \
  libasound2
```

### Font Rendering
Ensure Inter font is loaded in the render page. The service uses deviceScaleFactor: 2 for high-quality screenshots.
