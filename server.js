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




// ✅ Canada Hair single product scraper (with debug & bot evasion)
app.post("/scrape-canadahair-test", async (req, res) => {
  const productUrl =
    req.body.url ||
    "https://canadahair.ca/4t12-613-clip-in-hair-extensions-remy-hair.html?ci=21&qi=synth&li=16inches&ti=thick&hi=white&wi=no";

  const { chromium } = require("playwright");
  const fs = require("fs");

  const results = [];

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 768 },
    locale: "en-US",
  });

  const page = await context.newPage();

  try {
    console.log(`🔎 Visiting ${productUrl}`);
    const response = await page.goto(productUrl, {
      waitUntil: "networkidle",
      timeout: 90000,
    });

    console.log("✅ Page loaded. Status:", response.status());
    console.log("Final URL:", page.url());

    // Wait small delay for AJAX content
    await page.waitForTimeout(5000);

    // Check for bot-block messages
    const bodyText = await page.textContent("body");
    if (/Access denied|Cloudflare|Checking your browser|blocked/i.test(bodyText)) {
      throw new Error("⚠️ Site returned bot-protection or redirect content");
    }

    // Save HTML + screenshot for debug
    const htmlSnapshot = await page.content();
    fs.writeFileSync("canadahair-debug.html", htmlSnapshot);
    await page.screenshot({ path: "canadahair-debug.png", fullPage: true });
    console.log("🧾 Debug snapshot saved");

    // --- Try to extract product name ---
    let productName = "Unknown";
    try {
      await page.waitForSelector(
        "h1.page-title span.base, h1.product-title, h1.page-title",
        { timeout: 30000 }
      );
      const fullName = await page.textContent(
        "h1.page-title span.base, h1.product-title, h1.page-title"
      );
      const match = fullName.match(/·\s*(.*?)\s*-/);
      productName = match ? match[1].trim() : fullName.trim();
    } catch {
      console.warn("⚠️ Could not find product title element");
    }

    // --- Extract attributes ---
    const safeText = async (selector) => {
      try {
        return (await page.textContent(selector)).trim();
      } catch {
        return null;
      }
    };

    const material = await safeText("#price-of span:nth-of-type(1)");
    const size = await safeText("#price-of span:nth-of-type(2)");
    const weight = await safeText("#price-of span:nth-of-type(3)");

    // --- Prices ---
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
    } catch {
      console.warn("⚠️ Failed to extract price data");
    }

    // --- Shades ---
    const shades = await page.$$eval("#shades > div", (els) =>
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

    // --- Colors ---
    const colors = await page.$$eval("#color .actionProduct", (els) =>
      els.map((el) => ({
        colorName: el.getAttribute("data-name"),
        colorCode: el.getAttribute("color-code"),
        image: el.querySelector("img")?.src,
      }))
    );

    // --- Qualities ---
    const qualityOptions = await page.$$eval("#quality .actionProduct", (els) =>
      els.map((el) => {
        const spans = el.querySelectorAll("span");
        return `${spans[0]?.innerText.trim()} (${spans[1]?.innerText.trim()})`;
      })
    );

    // --- Lengths ---
    const lengthOptions = await page.$$eval("#length .actionProduct", (els) =>
      els.map((el) => {
        const spans = el.querySelectorAll("span");
        return `${spans[0]?.innerText.trim()} (${spans[1]?.innerText.trim()})`;
      })
    );

    // --- Thickness ---
    const thicknessOptions = await page.$$eval("#thickness .actionProduct", (els) =>
      els.map((el) => {
        const spans = el.querySelectorAll("span");
        return `${spans[0]?.innerText.trim()} (${spans[1]?.innerText.trim()})`;
      })
    );

    // --- Hair Styles ---
    const hairStyles = await page.$$eval("#wavy .actionProduct", (els) =>
      els.map((el) => el.innerText.trim().replace(/\s+/g, " "))
    );

    results.push({
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
    });

    await browser.close();
    res.json({ success: true, results });
  } catch (err) {
    console.error("❌ Scrape failed:", err);
    await browser.close();
    res
      .status(500)
      .json({ success: false, error: err.message || "Scrape failed" });
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
