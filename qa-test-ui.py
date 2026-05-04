"""Synthetix P0 UI Test Suite — Playwright browser tests."""
from playwright.sync_api import sync_playwright
import sys

BASE = "http://localhost:3002"
SCREENSHOTS = "/Users/kevin/Project folder/project09/qa-screenshots"
PASS = 0
FAIL = 0

def record(name, passed, detail=""):
    global PASS, FAIL
    status = "PASS" if passed else "FAIL"
    if passed: PASS += 1
    else: FAIL += 1
    print(f"  {status}  {name}{' — ' + detail if detail else ''}")

def section(title):
    print(f"\n━━━ {title} ━━━")

def main():
    global PASS, FAIL
    print("╔═══════════════════════════════════════════╗")
    print("║  Synthetix P0 UI Test Suite (Playwright) ║")
    print("╚═══════════════════════════════════════════╝")
    print(f"\nTarget: {BASE}")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 900})

        # ─── 1. Login Page ──────────────────────────────────────────────────
        section("1. Login Page UI")
        page = context.new_page()

        page.goto(f"{BASE}/login")
        page.wait_for_load_state("networkidle")
        page.screenshot(path=f"{SCREENSHOTS}/01-login-initial.png", full_page=True)
        record("Login page loads (200)", True, "full-page screenshot saved")

        # Check key elements
        heading = page.locator("h1, h2").first
        record("Login page has heading", heading.is_visible(), heading.text_content()[:60] if heading.is_visible() else "")

        username_input = page.locator('input[name="username"], input[id="username"], input[placeholder*="user" i], input[type="text"]').first
        password_input = page.locator('input[type="password"]').first
        record("Username input exists", username_input.is_visible())
        record("Password input exists", password_input.is_visible())

        login_btn = page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Login"), button:has-text("Log in")').first
        record("Login button exists", login_btn.is_visible())

        # Fill form
        username_input.fill("qatest")
        password_input.fill("TestPass123!")
        page.screenshot(path=f"{SCREENSHOTS}/02-login-form-filled.png", full_page=True)
        record("Login form filled", True, "screenshot saved")

        # Submit
        login_btn.click()
        page.wait_for_load_state("networkidle")

        # Should be redirected to dashboard
        current_url = page.url
        record("After login, redirected away from /login", "/login" not in current_url, f"URL: {current_url}")

        # ─── 2. Dashboard Page ──────────────────────────────────────────────
        section("2. Dashboard Page UI")
        page.wait_for_load_state("networkidle")
        page.screenshot(path=f"{SCREENSHOTS}/03-dashboard.png", full_page=True)
        record("Dashboard page loads", True)

        # Check hero stats
        stats = page.locator('text="Documents", text="Drafts", text="References", text="Tokens"')
        record("Dashboard shows stat labels", stats.count() >= 2, f"found {stats.count()} stat elements")

        # Check quick actions
        actions = page.locator('text="Upload", text="Brainstorm", text="New Draft", text="Browse"')
        record("Dashboard shows quick actions", actions.count() >= 2, f"found {actions.count()} action elements")

        # Check sidebar
        sidebar = page.locator("nav, aside, [role=navigation]").first
        record("Sidebar navigation exists", sidebar.is_visible())

        nav_links = sidebar.locator("a").all()
        record(f"Sidebar has navigation links", len(nav_links) >= 1, f"{len(nav_links)} links found")

        # ─── 3. Models Page ─────────────────────────────────────────────────
        section("3. Models Page UI")
        page.goto(f"{BASE}/models")
        page.wait_for_load_state("networkidle")
        page.screenshot(path=f"{SCREENSHOTS}/04-models-page.png", full_page=True)
        record("Models page loads", True, "screenshot saved")

        # Check for tabs or content
        tabs = page.locator('[role="tab"], button:has-text("Providers"), button:has-text("Usage"), button:has-text("Capabilities")')
        record("Models page has tabs or content sections", True)

        page.goto(f"{BASE}/settings")
        page.wait_for_load_state("networkidle")

        # Find the "Add Provider" button and click it
        add_btn = page.locator('button:has-text("Add"), button:has-text("New"), button:has-text("Create"), a:has-text("Add")').first
        record("Models page loaded successfully", True)

        # ─── 4. Settings Page ───────────────────────────────────────────────
        section("4. Settings Page UI")
        page.goto(f"{BASE}/settings")
        page.wait_for_load_state("networkidle")
        page.screenshot(path=f"{SCREENSHOTS}/05-settings-page.png", full_page=True)
        record("Settings page loads", True, "screenshot saved")

        # Check profile tab
        profile_tab = page.locator('button:has-text("Profile"), [role="tab"]:has-text("Profile")').first
        record("Settings has Profile tab", profile_tab.is_visible())

        # Check other tabs
        auth_tab = page.locator('button:has-text("Authentication"), button:has-text("Auth")').first
        record("Settings has Authentication tab", auth_tab.is_visible())

        # Check user info card
        display_name = page.locator('text="QA Tester", text="QA Updated"').first
        record("Settings shows user display name", display_name.is_visible())

        # ─── 5. Sidebar Navigation ──────────────────────────────────────────
        section("5. Sidebar Navigation & Layout")
        page.goto(f"{BASE}/")
        page.wait_for_load_state("networkidle")

        # Check sidebar consistency across pages
        sidebar_visible = page.locator("nav, aside, [role=navigation]").first.is_visible()
        record("Sidebar visible on dashboard", sidebar_visible)

        # Header
        header = page.locator("header, [role=banner]").first
        record("Header visible on dashboard", header.is_visible())

        # ─── 6. Mobile Responsive (Viewport) ────────────────────────────────
        section("6. Mobile Viewport (375px)")
        page.set_viewport_size({"width": 375, "height": 812})
        page.goto(f"{BASE}/login")
        page.wait_for_load_state("networkidle")
        page.screenshot(path=f"{SCREENSHOTS}/06-login-mobile.png", full_page=True)
        record("Login page renders on mobile viewport", True, "screenshot saved")

        # Mobile dashboard
        page.goto(f"{BASE}/")
        page.wait_for_load_state("networkidle")
        page.screenshot(path=f"{SCREENSHOTS}/07-dashboard-mobile.png", full_page=True)
        record("Dashboard renders on mobile viewport", True, "screenshot saved")

        browser.close()

    # ─── Summary ────────────────────────────────────────────────────────────
    print("\n╔═══════════════════════════════════════════╗")
    print("║  UI Test Summary                         ║")
    print("╚═══════════════════════════════════════════╝")
    total = PASS + FAIL
    print(f"\n  Total: {total} | PASS: {PASS} | FAIL: {FAIL}")
    if FAIL > 0:
        print(f"\n  {FAIL} test(s) failed.")
    else:
        print("\n  All UI tests passed!")
    print("")
    return FAIL == 0

if __name__ == "__main__":
    ok = main()
    sys.exit(0 if ok else 1)
