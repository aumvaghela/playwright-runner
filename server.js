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




// ✅ CanadaHair scraper with optional proxy rotation and stealth (drop-in)
app.post("/scrape-canadahair-test-proxy", async (req, res) => {
  const { chromium } = require("playwright");
  const fs = require("fs");

  const productUrl =
    (req.body && req.body.url) ||
    "https://canadahair.ca/4t12-613-clip-in-hair-extensions-remy-hair.html?ci=21&qi=synth&li=16inches&ti=thick&hi=white&wi=no";

  // Proxies: accept from request body (array) or PROXIES env var (comma-separated)
  let proxies = Array.isArray(req.body?.proxies)
    ? req.body.proxies
    : (process.env.PROXIES || "")
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);

  // Prepend null (no-proxy) to try direct first
  proxies = [null, ...proxies];

  // Helper: parse proxy string into { server, username, password } or null
  const parseProxy = (p) => {
    if (!p) return null;
    // Accept formats: http://user:pass@host:port  or http://host:port
    try {
      const url = new URL(p);
      const server = `${url.protocol}//${url.hostname}:${url.port}`;
      const username = url.username || undefined;
      const password = url.password || undefined;
      return { server, username, password };
    } catch (err) {
      return null;
    }
  };

  // Stealth script to reduce automation fingerprint
  const stealthScript = `
    (() => {
      try {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        window.chrome = window.chrome || { runtime: {} };
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US','en'] });
        Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });
      } catch(e) {}
    })();
  `;

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
      ],
    });
  } catch (err) {
    console.error("❌ Failed to launch browser:", err);
    return res.status(500).json({ success: false, error: "Failed to launch browser" });
  }

  let finalResult = null;
  let attemptInfo = [];

  for (const proxyRaw of proxies) {
    const proxy = parseProxy(proxyRaw);
    const proxyLabel = proxy ? proxy.server + (proxy.username ? ` (auth)` : "") : "no-proxy";

    console.log(`➡️ Attempting with: ${proxyLabel}`);

    // Create new context per attempt so proxy settings apply
    let context;
    try {
      context = await browser.newContext({
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        viewport: { width: 1366, height: 768 },
        locale: "en-US",
        extraHTTPHeaders: {
          "Accept-Language": "en-US,en;q=0.9",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        },
        proxy: proxy
          ? {
              server: proxy.server,
              username: proxy.username,
              password: proxy.password,
            }
          : undefined,
      });
    } catch (err) {
      console.warn(`⚠️ Could not create context for ${proxyLabel}:`, err.message);
      attemptInfo.push({ proxy: proxyLabel, ok: false, reason: "context-failed", error: err.message });
      continue; // try next proxy
    }

    const page = await context.newPage();

    // inject stealth script
    try {
      await page.addInitScript(stealthScript);
    } catch (e) {
      console.warn("⚠️ addInitScript failed:", e.message);
    }

    let attempt = { proxy: proxyLabel, ok: false, statusCode: null, note: null };

    try {
      const response = await page.goto(productUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
      const status = response ? response.status() : null;
      attempt.statusCode = status;
      console.log(`🔁 ${proxyLabel} - HTTP ${status}`);

      // Save small HTML preview + screenshot for debugging (named by timestamp + proxy label)
      const ts = Date.now();
      const safeLabel = proxyLabel.replace(/[:\/@]/g, "_").slice(0, 40);
      const html = await page.content();
      try {
        fs.writeFileSync(`canadahair-debug-${safeLabel}-${ts}.html`, html);
      } catch (e) {
        console.warn("⚠️ Could not write debug html:", e.message);
      }
      try {
        await page.screenshot({ path: `canadahair-debug-${safeLabel}-${ts}.png`, fullPage: true });
      } catch (e) {
        console.warn("⚠️ Could not write screenshot:", e.message);
      }
      console.log(`🧾 Debug saved for ${proxyLabel}`);

      // If server explicitly returned 403 or similar, mark and try next proxy
      if (status === 403 || status === 401 || status === 451) {
        attempt.note = `Blocked HTTP ${status}`;
        attemptInfo.push(attempt);
        await page.close();
        await context.close();
        continue; // try next proxy
      }

      // Wait for JS-rendered product containers (longer timeout)
      try {
        await page.waitForFunction(
          () => document.querySelectorAll("h1, #color, #shades, #quality, #length").length > 0,
          { timeout: 25000 }
        );
        await page.waitForTimeout(2500); // small extra wait for content to settle
      } catch (e) {
        // Not necessarily fatal; we'll attempt to read anyway
        console.warn(`⚠️ waitForFunction timed out for ${proxyLabel}:`, e.message);
      }

      // Check body text for bot pages
      let bodyText = "";
      try {
        bodyText = await page.textContent("body");
        if (/Access denied|Cloudflare|Checking your browser|blocked|403 Forbidden/i.test(bodyText)) {
          attempt.note = "Blocked by bot-protection text";
          attemptInfo.push(attempt);
          await page.close();
          await context.close();
          continue; // next proxy
        }
      } catch (e) {
        console.warn("⚠️ Could not read body text:", e.message);
      }

      // --- Extraction (safe wrappers) ---
      const safeText = async (sel) => {
        try {
          const t = await page.textContent(sel);
          return t ? t.trim() : null;
        } catch {
          return null;
        }
      };

      // Title
      let productName = "Unknown";
      try {
        const titleSel = await page.$("h1, .page-title, [data-ui-id='page-title-wrapper']");
        if (titleSel) {
          const fullName = (await titleSel.textContent()).trim();
          const match = fullName.match(/·\s*(.*?)\s*-/);
          productName = match ? match[1].trim() : fullName;
        }
      } catch (e) {
        console.warn("⚠️ Title extraction failed:", e.message);
      }

      // Attributes: material/size/weight
      const material = await safeText("#price-of span:nth-of-type(1)");
      const size = await safeText("#price-of span:nth-of-type(2)");
      const weight = await safeText("#price-of span:nth-of-type(3)");

      // Prices
      let regularPrice = null,
        salePrice = null,
        couponPrice = null;
      try {
        const priceTag = await page.$("#price");
        if (priceTag) {
          salePrice = await priceTag.getAttribute("price");
          regularPrice = await priceTag.getAttribute("oldprice");
          couponPrice = await priceTag.getAttribute("cprice");
        }
      } catch (e) {
        console.warn("⚠️ Price extraction failed:", e.message);
      }

      // Shades
      let shades = [];
      try {
        shades = await page.$$eval("#shades > div", (els) =>
          els
            .map((el) =>
              el.textContent
                .replace(/\s+/g, " ")
                .trim()
                .split("(")[0]
                .trim()
            )
            .filter(Boolean)
        );
      } catch (e) {}

      // Colors
      let colors = [];
      try {
        colors = await page.$$eval("#color .actionProduct", (els) =>
          els.map((el) => ({
            colorName: el.getAttribute("data-name"),
            colorCode: el.getAttribute("color-code"),
            image: el.querySelector("img")?.src,
          }))
        );
      } catch (e) {}

      // Quality / Length / Thickness / Hair styles
      let qualityOptions = [], lengthOptions = [], thicknessOptions = [], hairStyles = [];
      try {
        qualityOptions = await page.$$eval("#quality .actionProduct", (els) =>
          els.map((el) => {
            const spans = el.querySelectorAll("span");
            return `${spans[0]?.innerText.trim()} (${spans[1]?.innerText.trim()})`;
          })
        );
      } catch (e) {}
      try {
        lengthOptions = await page.$$eval("#length .actionProduct", (els) =>
          els.map((el) => {
            const spans = el.querySelectorAll("span");
            return `${spans[0]?.innerText.trim()} (${spans[1]?.innerText.trim()})`;
          })
        );
      } catch (e) {}
      try {
        thicknessOptions = await page.$$eval("#thickness .actionProduct", (els) =>
          els.map((el) => {
            const spans = el.querySelectorAll("span");
            return `${spans[0]?.innerText.trim()} (${spans[1]?.innerText.trim()})`;
          })
        );
      } catch (e) {}
      try {
        hairStyles = await page.$$eval("#wavy .actionProduct", (els) =>
          els.map((el) => el.innerText.trim().replace(/\s+/g, " "))
        );
      } catch (e) {}

      // Determine if we got meaningful data
      const meaningful = productName !== "Unknown" || shades.length > 0 || colors.length > 0 || qualityOptions.length > 0;
      if (!meaningful) {
        attempt.note = "No meaningful product data found - maybe blocked or different selectors";
        attemptInfo.push(attempt);
        await page.close();
        await context.close();
        continue; // next proxy
      }

      // Success: prepare result and break loop
      finalResult = {
        proxyUsed: proxyLabel,
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

      attempt.ok = true;
      attempt.note = "success";
      attemptInfo.push(attempt);

      await page.close();
      await context.close();
      break; // we have success -> exit proxy loop
    } catch (err) {
      console.warn(`❌ Attempt error for ${proxyLabel}:`, err.message);
      attempt.note = `error: ${err.message}`;
      attemptInfo.push(attempt);
      try {
        await page.close();
      } catch {}
      try {
        await context.close();
      } catch {}
      // continue to next proxy
    }
  } // end proxy loop

  // Close browser
  try {
    await browser.close();
  } catch (e) {}

  if (finalResult) {
    return res.json({ success: true, attemptInfo, result: finalResult });
  } else {
    return res.status(500).json({
      success: false,
      attemptInfo,
      error: "All attempts failed. Check debug HTML files produced in the instance for more info.",
    });
  }
});






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
