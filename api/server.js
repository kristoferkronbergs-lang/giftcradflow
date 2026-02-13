import express from 'express';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.RENDER_SERVICE_PORT || 3001;
const RENDER_TOKEN = process.env.RENDER_TOKEN || 'render-secret-token-2024';
const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:5173';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing required environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Startup configuration validation
console.log('========================================');
console.log('🚀 Gift Card Render Service Configuration');
console.log('========================================');
console.log(`PORT: ${PORT}`);
console.log(`APP_BASE_URL: ${APP_BASE_URL}`);
console.log(`RENDER_TOKEN: ${RENDER_TOKEN ? '✅ SET' : '❌ NOT SET'}`);
console.log(`SUPABASE_URL: ${SUPABASE_URL ? '✅ SET' : '❌ NOT SET'}`);
console.log(`SUPABASE_SERVICE_ROLE_KEY: ${SUPABASE_SERVICE_KEY ? '✅ SET' : '❌ NOT SET'}`);
console.log('========================================\n');

let browser = null;

async function initBrowser() {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }
  return browser;
}

async function cleanupBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

process.on('SIGTERM', async () => {
  await cleanupBrowser();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await cleanupBrowser();
  process.exit(0);
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'giftcard-render' });
});

app.get('/api/render-data/:orderId', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace('Bearer ', '');

    if (token !== RENDER_TOKEN) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { orderId } = req.params;

    // 1) order (NEKĀDU gift_cards tabulu)
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // 2) product
    const { data: product, error: productError } = await supabase
      .from('gift_card_products')
      .select('*')
      .eq('id', order.gift_card_product_id)
      .single();

    if (productError || !product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // 3) branding (collection override → global)
    let collectionTheme = null;
    if (order.collection_id) {
      const { data } = await supabase
        .from('branding_themes')
        .select('*')
        .eq('user_id', product.user_id)
        .eq('collection_id', order.collection_id)
        .is('product_id', null)
        .maybeSingle();
      collectionTheme = data || null;
    }

    const { data: globalTheme } = await supabase
      .from('branding_themes')
      .select('*')
      .eq('user_id', product.user_id)
      .is('collection_id', null)
      .is('product_id', null)
      .maybeSingle();

    const effectiveTheme = collectionTheme || globalTheme || null;

    res.json({
      ok: true,
      order,
      product,
      branding: {
        theme: effectiveTheme?.config || null,
        fontFamily: effectiveTheme?.font_family || 'Inter',
        backgroundColor: effectiveTheme?.background_color || null,
        brandLogoUrl: effectiveTheme?.logo_url || null,
        source: collectionTheme ? 'collection_override' : 'global',
      },
    });
  } catch (e) {
    console.error('[RenderData] Error:', e);
    res.status(500).json({ error: e.message || 'Failed to load render data' });
  }
});


app.post('/api/render-giftcard', async (req, res) => {
  const startTime = Date.now();
  let context = null;
  let page = null;

  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace('Bearer ', '');

    if (token !== RENDER_TOKEN) {
      console.error('[Render] ❌ Unauthorized access attempt');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { order_id, request_id, render_url } = req.body;
    const reqId = request_id || 'unknown';

    if (!order_id) {
      console.error(`[Render:${reqId}] ❌ Missing order_id in request body`);
      return res.status(400).json({ error: 'order_id is required' });
    }

    console.log(`[Render:${reqId}] 🎨 Starting render for order: ${order_id}`);
    console.log(`[Render:${reqId}] 📋 Environment:`, {
      APP_BASE_URL,
      SUPABASE_URL: SUPABASE_URL ? `${SUPABASE_URL.substring(0, 30)}...` : 'NOT SET',
      hasServiceKey: !!SUPABASE_SERVICE_KEY,
    });

    const renderUrl =
      (typeof render_url === 'string' && render_url.length > 0)
        ? render_url
        : `${APP_BASE_URL}/render/giftcard/${order_id}?token=${RENDER_TOKEN}`;

    console.log(`[Render:${reqId}] 📄 Final render URL:`, renderUrl);

    const browserInstance = await initBrowser();
    console.log(`[Render:${reqId}] ✅ Browser initialized`);

    context = await browserInstance.newContext({
      viewport: { width: 1000, height: 450 },
      deviceScaleFactor: 2,
    });
    console.log(`[Render:${reqId}] ✅ Browser context created (1000x450, 2x scale)`);

    page = await context.newPage();

    const pageErrors = [];
    const consoleMessages = [];

    page.on('pageerror', (error) => {
      const errorMsg = error.toString();
      pageErrors.push(errorMsg);
      console.error(`[Render:${reqId}] 🔴 Page error:`, errorMsg);
    });

    page.on('console', (msg) => {
      const text = msg.text();
      consoleMessages.push({ type: msg.type(), text });
      if (msg.type() === 'error') {
        console.error(`[Render:${reqId}] 🔴 Console error:`, text);
      }
    });

    page.on('requestfailed', (request) => {
      console.error(`[Render:${reqId}] 🔴 Request failed:`, {
        url: request.url(),
        failure: request.failure()?.errorText,
      });
    });

    console.log(`[Render:${reqId}] 🌐 Loading page...`);
    const response = await page.goto(renderUrl, {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    if (!response) {
      throw new Error('Page navigation failed: no response');
    }

    const status = response.status();
    console.log(`[Render:${reqId}] 📡 Page response: HTTP ${status}`);

    if (status !== 200) {
      const bodyText = await page.content();
      console.error(`[Render:${reqId}] ❌ Non-200 status. Page HTML:`, bodyText.substring(0, 500));
      throw new Error(`Page returned HTTP ${status}`);
    }

    console.log(`[Render:${reqId}] ✅ Page loaded successfully`);
    console.log(`[Render:${reqId}] 🔍 Waiting for [data-testid="giftcard-hero"]...`);

    try {
      await page.waitForSelector('[data-testid="giftcard-hero"]', { timeout: 10000 });
      console.log(`[Render:${reqId}] ✅ Found giftcard-hero element`);
    } catch (selectorError) {
      const pageContent = await page.content();
      const bodyText = await page.evaluate(() => document.body.innerText);

      console.error(`[Render:${reqId}] ❌ Selector not found. Page diagnostics:`);
      console.error(`[Render:${reqId}]    Body text:`, bodyText.substring(0, 300));
      console.error(`[Render:${reqId}]    Page errors:`, pageErrors);
      console.error(`[Render:${reqId}]    Console errors:`, consoleMessages.filter(m => m.type === 'error'));
      console.error(`[Render:${reqId}]    HTML sample:`, pageContent.substring(0, 1000));

      await page.screenshot({ path: `/tmp/debug-${order_id}.png`, fullPage: true });
      console.error(`[Render:${reqId}]    Debug screenshot saved to: /tmp/debug-${order_id}.png`);

      throw new Error(`Selector [data-testid="giftcard-hero"] not found after 10s. Page might have errors.`);
    }

    await page.waitForTimeout(500);
    console.log(`[Render:${reqId}] ⏳ Waited 500ms for render stabilization`);

    console.log(`[Render:${reqId}] 📸 Taking screenshot of hero element...`);
    const heroElement = await page.locator('[data-testid="giftcard-hero"]').first();
    const screenshot = await heroElement.screenshot({
      type: 'png',
      scale: 'device',
    });

    const screenshotSize = screenshot.length;
    console.log(`[Render:${reqId}] ✅ Screenshot captured (${(screenshotSize / 1024).toFixed(1)} KB)`);

    await context.close();
    context = null;
    page = null;

    const fileName = `orders/${order_id}.png`;

    console.log(`[Render:${reqId}] ☁️ Uploading to Supabase Storage...`);
    console.log(`[Render:${reqId}]    Bucket: giftcard-renders`);
    console.log(`[Render:${reqId}]    Path: ${fileName}`);
    console.log(`[Render:${reqId}]    Size: ${(screenshotSize / 1024).toFixed(1)} KB`);

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('giftcard-renders')
      .upload(fileName, screenshot, {
        contentType: 'image/png',
        upsert: true,
      });

    if (uploadError) {
      console.error(`[Render:${reqId}] ❌ Supabase upload error:`, {
        message: uploadError.message,
        statusCode: uploadError.statusCode,
        error: uploadError.error,
      });
      throw new Error(`Storage upload failed: ${uploadError.message}`);
    }

    console.log(`[Render:${reqId}] ✅ Upload successful:`, uploadData);

    const { data: publicUrlData } = supabase.storage
      .from('giftcard-renders')
      .getPublicUrl(fileName);

    const imageUrl = publicUrlData.publicUrl;
    const duration = Date.now() - startTime;

    console.log(`[Render:${reqId}] ✅ COMPLETE! Duration: ${duration}ms`);
    console.log(`[Render:${reqId}] 🎉 Image URL:`, imageUrl);

    res.json({
      ok: true,
      order_id,
      request_id: reqId,
      image_url: imageUrl,
      storage_path: fileName,
      width: 1000,
      height: 450,
      render_time_ms: duration,
    });
  } catch (error) {
    const { order_id, request_id } = req.body || {};
    const reqId = request_id || 'unknown';
    const duration = Date.now() - startTime;

    console.error(`[Render:${reqId}] ❌ FAILED after ${duration}ms`);
    console.error(`[Render:${reqId}] Error details:`, {
      message: error.message,
      name: error.name,
      order_id,
    });
    console.error(`[Render:${reqId}] Stack trace:`, error.stack);

    if (context) {
      try {
        await context.close();
      } catch (e) {
        console.error(`[Render:${reqId}] Failed to close context:`, e.message);
      }
    }

    // Determine which step failed
    let step = 'unknown';
    if (error.message?.includes('Selector')) step = 'selector_wait';
    else if (error.message?.includes('Page returned HTTP')) step = 'page_load';
    else if (error.message?.includes('Storage upload')) step = 'storage_upload';
    else if (error.message?.includes('Browser')) step = 'browser_init';
    else if (error.message?.includes('navigation')) step = 'page_navigation';

    res.status(500).json({
      error: error.message || 'Screenshot failed',
      step,
      details: error.toString(),
      order_id,
      request_id: reqId,
      render_time_ms: duration,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Gift card render service running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Render endpoint: POST http://localhost:${PORT}/api/render-giftcard`);
});
