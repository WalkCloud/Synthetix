import { chromium } from "playwright";

const SCREENSHOT_DIR = "./qa-screenshots";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  // 1. Login
  console.log("Navigating to login...");
  await page.goto("http://localhost:3002/login", { waitUntil: "networkidle" });

  // Fill login form
  await page.fill('input[id="email"], input[placeholder*="mail"], input[type="text"]', "admin");
  await page.fill('input[type="password"]', "admin123");
  await page.click('button:has-text("Login")');

  // Wait for dashboard to load
  await page.waitForURL("**/ /**", { timeout: 10000 });
  console.log("Logged in, on dashboard");

  // 2. Navigate to Models page
  await page.goto("http://localhost:3002/models", { waitUntil: "networkidle" });
  await page.waitForSelector('button:has-text("LLM Models")', { timeout: 10000 });
  console.log("On Models page");

  // Small wait for data to load
  await page.waitForTimeout(1000);

  // 3. Screenshot LLM Models tab (default)
  console.log("Screenshot LLM Models tab...");
  await page.screenshot({
    path: `${SCREENSHOT_DIR}/models-llm-tab.png`,
    fullPage: true,
  });

  // Gather LLM tab content details
  const llmTabData = await page.evaluate(() => {
    const content = document.querySelector("main");
    return {
      modelCards: Array.from(content.querySelectorAll(".text-base.font-bold, h4")).map((el) => el.textContent.trim()),
      allText: content?.innerText?.substring(0, 2000) || "",
      hasSearchBox: !!content.querySelector('input[placeholder*="Search"]'),
      hasHeaderButton: !!content.querySelector('button:has(svg)'),  // any button with icon
    };
  });
  console.log("LLM Tab data:", JSON.stringify(llmTabData, null, 2));

  // 4. Click Embedding Models tab
  console.log("Clicking Embedding Models tab...");
  await page.click('button:has-text("Embedding Models")');
  await page.waitForTimeout(500);

  await page.screenshot({
    path: `${SCREENSHOT_DIR}/models-embedding-tab.png`,
    fullPage: true,
  });

  const embeddingTabData = await page.evaluate(() => {
    const content = document.querySelector("main");
    return {
      modelCards: Array.from(content.querySelectorAll(".text-base.font-bold")).map((el) => el.textContent.trim()),
      hasEmbedSpecs: !!content.querySelector('text, .grid-cols-2'),
      allText: content?.innerText?.substring(0, 2000) || "",
    };
  });
  console.log("Embedding Tab data:", JSON.stringify(embeddingTabData, null, 2));

  // 5. Click Token Usage tab
  console.log("Clicking Token Usage tab...");
  await page.click('button:has-text("Token Usage")');
  await page.waitForTimeout(500);

  await page.screenshot({
    path: `${SCREENSHOT_DIR}/models-usage-tab.png`,
    fullPage: true,
  });

  const usageTabData = await page.evaluate(() => {
    const content = document.querySelector("main");
    return {
      hasTimeRangeBtns: Array.from(content.querySelectorAll("button")).filter((b) =>
        ["Today", "This Week", "This Month", "Custom"].includes(b.textContent.trim())
      ).length,
      hasStatsCards: content.querySelectorAll(".text-\\[28px\\]").length,
      hasUsageBars: !!content.querySelector('.h-7, [class*="usage-bar"]'),
      hasTables: content.querySelectorAll("table").length,
      hasTrendChart: !!content.querySelector(".flex.items-end"),
      allText: content?.innerText?.substring(0, 3000) || "",
    };
  });
  console.log("Usage Tab data:", JSON.stringify(usageTabData, null, 2));

  // 6. Test "Add LLM Model" button - go back to LLM tab
  console.log("Going back to LLM tab to test Add Model button...");
  await page.click('button:has-text("LLM Models")');
  await page.waitForTimeout(500);

  // Click "Add LLM Model" card
  console.log("Clicking Add LLM Model...");
  await page.click('button:has-text("Add LLM Model")');
  await page.waitForTimeout(500);

  await page.screenshot({
    path: `${SCREENSHOT_DIR}/models-add-form.png`,
    fullPage: true,
  });

  const addFormData = await page.evaluate(() => {
    const dialog = document.querySelector('.fixed.inset-0, [class*="fixed inset"]');
    if (!dialog) return { dialogFound: false };
    return {
      dialogFound: true,
      title: dialog.querySelector("h2")?.textContent?.trim() || "",
      fields: Array.from(dialog.querySelectorAll("label")).map((l) => l.textContent.trim()),
      hasSubmitButton: !!dialog.querySelector('button[type="submit"]'),
      allText: dialog?.innerText?.substring(0, 2000) || "",
    };
  });
  console.log("Add Form data:", JSON.stringify(addFormData, null, 2));

  // Close dialog by clicking backdrop
  const backdrop = await page.$('.fixed.inset-0');
  if (backdrop) {
    await backdrop.click({ position: { x: 5, y: 5 } }); // click top-left corner of backdrop
    await page.waitForTimeout(300);
  }

  // 7. Test "Test" button on model card
  console.log("Testing 'Test' button on model card...");
  await page.waitForTimeout(300);
  const testBtn = await page.$('button:has-text("Test")');
  if (testBtn) {
    await testBtn.click();
    await page.waitForTimeout(2000); // wait for test result

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/models-test-result.png`,
      fullPage: true,
    });

    const testResultData = await page.evaluate(() => {
      const content = document.querySelector("main");
      return {
        allText: content?.innerText?.substring(0, 2000) || "",
      };
    });
    console.log("Test result data:", JSON.stringify(testResultData, null, 2));
  }

  // 8. Test "Delete" button behavior
  console.log("Testing 'Delete' button on model card...");
  const deleteBtn = await page.$('button:has-text("Delete")');
  if (deleteBtn) {
    await deleteBtn.click();
    await page.waitForTimeout(500);

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/models-delete-confirm.png`,
      fullPage: true,
    });

    const deleteData = await page.evaluate(() => {
      const content = document.querySelector("main");
      return {
        hasConfirmBtn: !!content?.querySelector('button:has-text("Confirm")'),
        hasCancelBtn: !!content?.querySelector('button:has-text("Cancel")'),
        allText: content?.innerText?.substring(0, 2000) || "",
      };
    });
    console.log("Delete confirm data:", JSON.stringify(deleteData, null, 2));

    // Cancel the delete
    const cancelBtn = await page.$('button:has-text("Cancel")');
    if (cancelBtn) await cancelBtn.click();
  }

  // 9. Test header "Add Model" button (in the page header)
  console.log("Checking header for Add Model button...");
  const headerActions = await page.evaluate(() => {
    const header = document.querySelector("header, .main-header, section");
    // Check for any button in the header area
    const buttons = document.querySelectorAll("button");
    const headerButtons = [];
    buttons.forEach((btn) => {
      if (btn.textContent.includes("Add Model") || btn.textContent.includes("添加")) {
        headerButtons.push({
          text: btn.textContent.trim(),
          classes: btn.className.substring(0, 100),
        });
      }
    });
    return headerButtons;
  });
  console.log("Header buttons:", JSON.stringify(headerActions, null, 2));

  // 10. Check for missing prototype features
  const prototypeComparison = await page.evaluate(() => {
    const content = document.querySelector("main");
    return {
      // Header should have "Add Model" button
      hasHeaderAddButton: !!content?.querySelector('button:has-text("Add Model")') ||
        document.querySelector('header button, section button')?.textContent?.includes("Add"),
      // Capability tags on cards
      hasCapabilityTags: content?.querySelectorAll('.rounded-full.text-xs.font-medium').length > 0 || false,
      // Default badges (Default: Chat, Default: Writing etc)
      hasDefaultBadges: content?.querySelectorAll('[class*="FEF3C7"], [class*="D97706"]').length > 0 || false,
      // Pricing info
      hasPricingInfo: content?.innerText?.includes("Free (Local)") || content?.innerText?.includes("per 1M tokens") || false,
    };
  });
  console.log("Prototype comparison:", JSON.stringify(prototypeComparison, null, 2));

  await browser.close();
  console.log("DONE - all screenshots captured");
})();
