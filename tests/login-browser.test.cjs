const assert = require('node:assert/strict');
const { test } = require('node:test');

// Run against a configured preview or production origin. No Google consent is
// submitted: the external page is intercepted after the real form redirect.
const origin = process.env.PLANNER_TEST_ORIGIN;
for (const engine of ['chromium', 'webkit']) {
  test(`${engine}: the real Google sign-in button navigates instead of downloading`, { skip: !origin }, async () => {
    const playwright = require(process.env.PLANNER_PLAYWRIGHT_MODULE || 'playwright');
    const browser = await playwright[engine].launch({ headless: true });
    try {
      const context = await browser.newContext();
      await context.route('https://accounts.google.com/**', route => route.fulfill({
        contentType: 'text/html', body: '<html><body>Google sign-in reached</body></html>',
      }));
      const page = await context.newPage();
      const downloads = [];
      page.on('download', download => downloads.push(download.suggestedFilename()));
      await page.goto(`${origin}/login`);
      const requestPromise = page.waitForRequest(request => new URL(request.url()).pathname === '/api/auth/start');
      await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
      const request = await requestPromise;
      assert.equal(await request.headerValue('origin'), new URL(origin).origin);
      await page.waitForURL(url => url.hostname === 'accounts.google.com');
      assert.deepEqual(downloads, []);
      const cookie = (await context.cookies(origin)).find(cookie => cookie.name.endsWith('planner-login'));
      assert.ok(cookie?.httpOnly);
      if (origin.startsWith('https:')) assert.ok(cookie.secure);
      for (const invalidOrigin of ['null', 'https://attacker.test']) {
        const rejection = await context.request.post(`${origin}/api/auth/start`, {
          headers: { origin: invalidOrigin }, maxRedirects: 0,
        });
        assert.equal(rejection.status(), 403);
        assert.match(rejection.headers()['content-type'], /application\/json/);
      }
      assert.equal((await context.request.get(`${origin}/api/backend/tasks`)).status(), 401);
    } finally {
      await browser.close();
    }
  });
}
