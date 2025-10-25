const express = require("express");
const { chromium } = require("playwright");
const fs = require("fs");

const app = express();
app.use(express.json());

// ✅ Health check route
app.get("/", (req, res) => {
  res.send("✅ Playwright Runner for playwright.dev.brainbean.us is live!");
});

// ✅ Full test flow for https://playwright.dev.brainbean.us/
app.post("/run-brainbean-test", async (req, res) => {
  const baseUrl = "https://playwright.dev.brainbean.us";
  const pages = ["/", "/shop/", "/about/", "/contact/"];
  const results = [];

  try {
    const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const context = await browser.newContext();

    for (const path of pages) {
      const page = await context.newPage();
      const fullUrl = `${baseUrl}${path}`;
      const start = Date.now();

      let success = true;
      let error = null;
      let screenshot = null;
      let loadTime = 0;
      let status = 0;

      console.log(`🔎 Visiting ${fullUrl}`);

      try {
        let response = await page.goto(fullUrl, {
          waitUntil: "domcontentloaded",
          timeout: 60000
        });

        loadTime = Date.now() - start;
        status = response ? response.status() : 0;

        // Check for HTTP error codes
        if (status >= 400) {
          success = false;
          error = `HTTP ${status}`;
        } else {
          // Check for "soft 404" (content says 404 but HTTP = 200)
          const pageTitle = (await page.title()) || "";
          const bodyText = await page.textContent("body");

          if (
            pageTitle.match(/404|not found/i) ||
            bodyText.match(/404|page not found/i)
          ) {
            success = false;
            error = "Soft 404 detected in page content";
          }
        }

        // Take screenshot only if failed
        if (!success) {
          screenshot = await page.screenshot({ encoding: "base64" });
          console.warn(`⚠️ ${fullUrl} flagged as failure: ${error}`);
        } else {
          console.log(`✅ ${fullUrl} OK in ${loadTime}ms (status ${status})`);
        }

        results.push({ url: fullUrl, success, status, error, loadTime, screenshot });
      } catch (err) {
        console.error(`❌ Navigation failed for ${fullUrl}:`, err.message);
        success = false;
        error = err.message;
        screenshot = await page.screenshot({ encoding: "base64" });
        loadTime = Date.now() - start;
        results.push({ url: fullUrl, success, error, loadTime, screenshot });
      }

      await page.close();
    }

    await browser.close();

    res.json({
      success: true,
      site: baseUrl,
      testedPages: pages.length,
      timestamp: new Date().toISOString(),
      results
    });
  } catch (err) {
    console.error("Runner error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});




// server.js
const express = require("express");
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

// ----------------------
// Health check
// ----------------------
app.get("/", (req, res) => {
  res.send("✅ Playwright Runner for playwright.dev.brainbean.us is live!");
});

// ----------------------
// Simple site audit route (lightweight, generic)
// ----------------------
app.post("/run-site-audit", async (req, res) => {
  const baseUrl = req.body.url || "https://example.com";
  const pagesToTest = req.body.pages || ["/", "/"];
  const results = [];
  let browser;

  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const context = await browser.newContext();
    for (const p of pagesToTest) {
      const page = await context.newPage();
      const fullUrl = `${baseUrl.replace(/\/$/, "")}${p}`;
      const start = Date.now();
      try {
        await page.goto(fullUrl, { waitUntil: "networkidle", timeout: 60000 });
        const loadTime = Date.now() - start;
        results.push({ page: fullUrl, success: true, loadTime });
      } catch (err) {
        const loadTime = Date.now() - start;
        const screenshot = await page.screenshot({ encoding: "base64", fullPage: true }).catch(()=>null);
        results.push({ page: fullUrl, success: false, error: err.message, loadTime, screenshot });
      } finally {
        await page.close().catch(()=>{});
      }
    }

    await context.close();
    await browser.close();

    res.json({ success: true, baseUrl, timestamp: new Date().toISOString(), results });
  } catch (err) {
    console.error("Site audit error:", err);
    try { await browser?.close?.(); } catch {}
    res.status(500).json({ success: false, error: err.message });
  }
});

// ----------------------
// Scrape route using ScraperAPI + Playwright
// ----------------------
// POST body example:
// {
//   "url": "https://canadahair.ca/4t12-613-clip-in-hair-extensions-remy-hair.html?...",
//   "scraperApiKey": "YOUR_KEY_HERE"   // optional if set in env SCRAPER_API_KEY
// }
app.post("/scrape-canadahair-test", async (req, res) => {
  const productUrl =
    (req.body && req.body.url) ||
    req.query.url ||
    "https://canadahair.ca/4t12-613-clip-in-hair-extensions-remy-hair.html?ci=21&qi=synth&li=16inches&ti=thick&hi=white&wi=no";

  // Prefer env var, fallback to request body
  const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY || (req.body && req.body.scraperApiKey);

  if (!SCRAPER_API_KEY) {
    return res.status(400).json({
      success: false,
      error:
        "Missing ScraperAPI key. Set SCRAPER_API_KEY env var or pass { scraperApiKey: 'KEY' } in POST body.",
    });
  }

  const screenshotPrefix = `canadahair-debug-${Date.now()}`;

  // Proxy config for Playwright context
  const proxyServer = "http://proxy-server.scraperapi.com:8001";
  // Playwright wants username/password separately
  // ScraperAPI proxy uses username "scraperapi" and password is the API key
  const proxyCredentials = {
    server: proxyServer,
    username: "scraperapi",
    password: SCRAPER_API_KEY,
  };

  let browser;
  let context;
  let page;

  try {
    // Launch browser (headless)
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
      ],
    });

    // Create context using ScraperAPI proxy
    context = await browser.newContext({
      proxy: {
        server: proxyCredentials.server,
        username: proxyCredentials.username,
        password: proxyCredentials.password,
      },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
      viewport: { width: 1366, height: 768 },
      locale: "en-US",
      extraHTTPHeaders: {
        "Accept-Language": "en-US,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
      }
    });

    page = await context.newPage();

    // Stealth init script to reduce automation footprint
    await page.addInitScript(() => {
      try {
        Object.defineProperty(navigator, "webdriver", { get: () => false });
        window.chrome = { runtime: {} };
        Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
        Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
      } catch (e) { /* ignore */ }
    });

    console.log("🌐 Visiting:", productUrl, "via ScraperAPI proxy");

    // Navigate
    const response = await page.goto(productUrl, {
      waitUntil: "networkidle",
      timeout: 90000,
    });

    const status = response ? response.status() : null;
    console.log("✅ Response status:", status);

    // Wait for JS-rendered elements (Magento often hydrates after load)
    try {
      await page.waitForFunction(
        () =>
          document.querySelectorAll("h1, #color, #shades, #quality, #length").length > 0,
        { timeout: 25000 }
      );
    } catch (e) {
      // swallow: we will still attempt to extract
      console.warn("⚠️ Wait-for-function timed out, attempting extraction anyway.");
    }

    // Save debug snapshots
    const htmlSnapshot = await page.content();
    const htmlFile = path.join(".", `${screenshotPrefix}.html`);
    const pngFile = path.join(".", `${screenshotPrefix}.png`);
    try {
      fs.writeFileSync(htmlFile, htmlSnapshot);
      await page.screenshot({ path: pngFile, fullPage: true });
      console.log("🧾 Debug files saved:", htmlFile, pngFile);
    } catch (e) {
      console.warn("⚠️ Could not save debug files:", e.message);
    }

    // If site returned a forbidden/block page, detect it quickly
    const bodyText = (await page.textContent("body")).slice(0, 2000);
    if (/403 Forbidden|Access denied|Cloudflare|Checking your browser|blocked/i.test(bodyText)) {
      return res.status(403).json({
        success: false,
        error: "Target returned block/forbidden content even via ScraperAPI proxy.",
        proxyUsed: proxyServer,
        debugFiles: { html: htmlFile, screenshot: pngFile },
        bodyPreview: bodyText.substring(0, 500)
      });
    }

    // --- Extraction helpers ---
    const safeText = async (selector) => {
      try {
        const t = await page.textContent(selector);
        return t ? t.trim() : null;
      } catch {
        return null;
      }
    };

    // Product title (custom parsing per your rule)
    let productName = "Unknown";
    try {
      const titleSelector = "h1.page-title span.base, h1.product-title, h1.page-title, [data-ui-id='page-title-wrapper']";
      await page.waitForSelector(titleSelector, { timeout: 20000 }).catch(()=>{});
      const full = await page.textContent(titleSelector).catch(()=>null);
      if (full) {
        const match = full.match(/·\s*(.*?)\s*-/);
        productName = match ? match[1].trim() : full.trim();
      }
    } catch (e) {
      console.warn("⚠️ Title extraction failed:", e.message || e);
    }

    // Material, size, weight
    const material = await safeText("#price-of span:nth-of-type(1)");
    const size = await safeText("#price-of span:nth-of-type(2)");
    const weight = await safeText("#price-of span:nth-of-type(3)");

    // Prices: attributes on #price element
    let regularPrice = null, salePrice = null, couponPrice = null;
    try {
      const priceEl = await page.$("#price");
      if (priceEl) {
        salePrice = await priceEl.getAttribute("price");
        regularPrice = await priceEl.getAttribute("oldprice");
        couponPrice = await priceEl.getAttribute("cprice");
      }
    } catch (e) {
      console.warn("⚠️ Price extraction had an error:", e.message || e);
    }

    // Shades
    const shades = await page.$$eval("#shades > div", (els) =>
      els.map(el => el.textContent.replace(/\s+/g, " ").trim().split("(")[0].trim()).filter(Boolean)
    ).catch(()=>[]);

    // Colors
    const colors = await page.$$eval("#color .actionProduct", (els) =>
      els.map(el => ({
        colorName: el.getAttribute("data-name"),
        colorCode: el.getAttribute("color-code"),
        image: el.querySelector("img") ? el.querySelector("img").src : null,
      }))
    ).catch(()=>[]);

    // Qualities
    const qualityOptions = await page.$$eval("#quality .actionProduct", (els) =>
      els.map(el => {
        const spans = el.querySelectorAll("span");
        return `${spans[0]?.innerText.trim() || ""}${spans[1] ? " (" + spans[1].innerText.trim() + ")" : ""}`.trim();
      })
    ).catch(()=>[]);

    // Lengths
    const lengthOptions = await page.$$eval("#length .actionProduct", (els) =>
      els.map(el => {
        const spans = el.querySelectorAll("span");
        return `${spans[0]?.innerText.trim() || ""}${spans[1] ? " (" + spans[1].innerText.trim() + ")" : ""}`.trim();
      })
    ).catch(()=>[]);

    // Thickness
    const thicknessOptions = await page.$$eval("#thickness .actionProduct", (els) =>
      els.map(el => {
        const spans = el.querySelectorAll("span");
        return `${spans[0]?.innerText.trim() || ""}${spans[1] ? " (" + spans[1].innerText.trim() + ")" : ""}`.trim();
      })
    ).catch(()=>[]);

    // Hair styles
    const hairStyles = await page.$$eval("#wavy .actionProduct", (els) =>
      els.map(el => el.innerText.trim().replace(/\s+/g, " "))
    ).catch(()=>[]);

    // Prepare result
    const result = {
      productUrl,
      productName,
      material,
      size,
      weight,
      regularPrice,
      salePrice,
      couponPrice,
      shades,
      colors,
      qualityOptions,
      lengthOptions,
      thicknessOptions,
      hairStyles,
    };

    // Close browser/context gracefully
    try { await context.close(); } catch {}
    try { await browser.close(); } catch {}

    // Return result + debug paths
    res.json({
      success: true,
      proxyUsed: proxyServer,
      debugFiles: { html: htmlFile, screenshot: pngFile },
      result,
    });
  } catch (err) {
    console.error("❌ Scrape failed:", err);
    try { await context?.close?.(); } catch {}
    try { await browser?.close?.(); } catch {}

    res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

// ----------------------
// Start server
// ----------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Server running on port ${PORT}`));







// ✅ Generic site audit route (optional for any site)
app.post("/run-site-audit", async (req, res) => {
  const baseUrl = req.body.url || "https://playwright.dev.brainbean.us";
  const pagesToTest = req.body.pages || ["/", "/shop/", "/about/", "/contact/"];
  const results = [];

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const context = await browser.newContext();

  for (const pagePath of pagesToTest) {
    const page = await context.newPage();
    const fullUrl = `${baseUrl.replace(/\/$/, "")}${pagePath}`;
    const start = Date.now();
    let loadTime = 0;
    let screenshot = null;
    let success = true;
    let error = null;

    console.log(`🔎 Auditing ${fullUrl}`);

    try {
      page.on("console", msg => {
        if (msg.type() === "error") console.log(`JS Error on ${fullUrl}:`, msg.text());
      });

      await page.goto(fullUrl, { waitUntil: "networkidle", timeout: 60000 });
      loadTime = Date.now() - start;
      console.log(`✅ Loaded ${fullUrl} in ${loadTime}ms`);
      results.push({ page: fullUrl, success, loadTime });
    } catch (err) {
      console.error(`❌ Error on ${fullUrl}: ${err.message}`);
      loadTime = Date.now() - start;
      screenshot = await page.screenshot({ encoding: "base64" });
      success = false;
      error = err.message;
      results.push({ page: fullUrl, success, error, loadTime, screenshot });
    }

    await page.close();
  }

  await browser.close();

  const report = {
    baseUrl,
    timestamp: new Date().toISOString(),
    pagesTested: pagesToTest.length,
    results
  };

  try {
    fs.writeFileSync(`report-${Date.now()}.json`, JSON.stringify(report, null, 2));
  } catch (err) {
    console.warn("⚠️ Could not save report:", err.message);
  }

  res.json(report);
});

// ✅ Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () =>
  console.log(`🚀 Server running on port ${PORT}`)
);
