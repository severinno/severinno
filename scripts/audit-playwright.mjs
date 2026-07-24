// Playwright-based Performance + Accessibility Audit
// Run: node scripts/audit-playwright.mjs

import { chromium } from '@playwright/test';

const PAGES = [
  { path: '/',                label: 'Home'          },
  { path: '/termos',          label: 'Termos'        },
  { path: '/como-funciona',   label: 'ComoFunciona'  },
  { path: '/this-page-does-not-exist', label: '404'  },
];

const TARGET_URL = process.env.TARGET_URL || 'http://localhost:3000';

async function audit(page, { path, label }) {
  const url = `${TARGET_URL}${path}`;
  const start = Date.now();

  // Track console errors from the start
  const consoleErrors = [];
  const onConsole = (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  };
  page.on('console', onConsole);

  // Navigate and wait for network idle, capture response status
  let statusCode = 0;
  try {
    const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    statusCode = response?.status() || 0;
  } catch (err) {
    consoleErrors.push(`Navigation error: ${err.message}`);
  }

  page.removeListener('console', onConsole);

  // Collect Web Vitals via performance API
  const metrics = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const paint = performance.getEntriesByType('paint');
    const lcpCandidates = performance.getEntriesByType('largest-contentful-paint');
    const layoutShift = performance.getEntriesByType('layout-shift');

    return {
      ttfb:         nav ? nav.responseStart - nav.requestStart : null,
      domContentLoaded: nav ? nav.domContentLoadedEventEnd - nav.requestStart : null,
      loadComplete: nav ? nav.loadEventEnd - nav.requestStart : null,
      fcp:          paint.find(p => p.name === 'first-contentful-paint')?.startTime || null,
      lcp:          lcpCandidates.length > 0 ? lcpCandidates[lcpCandidates.length - 1].startTime : null,
      cls:          layoutShift.reduce((sum, entry) => sum + (entry.value || 0), 0),
      domSize:      document.querySelectorAll('*').length,
      imgCount:     document.querySelectorAll('img').length,
      scriptCount:  document.querySelectorAll('script').length,
    };
  });

  // Accessibility check
  const a11yViolations = [];
  try {
    const images = await page.locator('img:not([alt])').count();
    if (images > 0) a11yViolations.push(`${images} image(s) without alt text`);

    const emptyAnchors = await page.locator('a[href]:not([aria-label]):not(:has-text(""))').count();
    if (emptyAnchors > 0) a11yViolations.push(`${emptyAnchors} anchor(s) with href but no text content`);

    const headings = await page.locator('h1').count();
    if (headings === 0) a11yViolations.push('No h1 heading found on page');
    if (headings > 1) a11yViolations.push(`Multiple h1 headings (${headings})`);
  } catch(e) {
    a11yViolations.push(`Accessibility check error: ${e.message}`);
  }

  const duration = Date.now() - start;

  return {
    page: label,
    url,
    statusCode,
    duration,
    metrics,
    a11yViolations,
    consoleErrors,
  };
}

async function main() {
  console.log('🚀 Starting Playwright audit...\n');
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  const results = [];
  for (const p of PAGES) {
    process.stdout.write(`  📄 ${p.label} (${p.path})... `);
    try {
      const result = await audit(page, p);
      results.push(result);
      console.log(`✅ ${result.duration}ms`);
    } catch (err) {
      console.log(`❌ ${err.message.slice(0, 60)}`);
      results.push({ page: p.label, url: `${TARGET_URL}${p.path}`, error: err.message });
    }
  }

  await browser.close();

  // Print results
  console.log('\n' + '='.repeat(70));
  console.log('📊 AUDIT RESULTS\n');

  for (const r of results) {
    console.log(`── ${r.page} ─${'─'.repeat(60)}`);
    if (r.error) {
      console.log(`  ❌ Error: ${r.error}`);
      continue;
    }
    console.log(`  URL:        ${r.url}`);
    console.log(`  Load time:  ${r.duration}ms`);
    console.log(`  ──── Web Vitals ────`);
    console.log(`  TTFB:       ${r.metrics.ttfb?.toFixed(1) || 'N/A'}ms`);
    console.log(`  FCP:        ${r.metrics.fcp?.toFixed(1) || 'N/A'}ms`);
    console.log(`  LCP:        ${r.metrics.lcp?.toFixed(1) || 'N/A'}ms`);
    console.log(`  CLS:        ${r.metrics.cls?.toFixed(3) || 'N/A'}`);
    console.log(`  DOM Content Loaded: ${r.metrics.domContentLoaded?.toFixed(1) || 'N/A'}ms`);
    console.log(`  ──── Page Composition ────`);
    console.log(`  DOM nodes:  ${r.metrics.domSize}`);
    console.log(`  Images:     ${r.metrics.imgCount}`);
    console.log(`  Scripts:    ${r.metrics.scriptCount}`);
    console.log(`  ──── Accessibility ────`);
    if (r.a11yViolations.length > 0) {
      r.a11yViolations.forEach(v => console.log(`  ⚠️  ${v}`));
    } else {
      console.log(`  ✅ No violations found`);
    }
    if (r.consoleErrors.length > 0) {
      console.log(`  ──── Console Errors ────`);
      r.consoleErrors.forEach(e => console.log(`  ❌ ${e}`));
    }
    console.log('');
  }

  // Score estimation
  console.log('='.repeat(70));
  console.log('📈 PERFORMANCE SCORE ESTIMATION (Lighthouse-like)\n');
  
  for (const r of results) {
    if (r.error) continue;
    const { lcp, cls, ttfb, fcp } = r.metrics;
    let score = 100;
    
    // LCP: < 2.5s good, < 4s needs improvement
    if (lcp > 4000) score -= 25;
    else if (lcp > 2500) score -= 10;
    
    // FCP: < 1.8s good
    if (fcp > 3000) score -= 15;
    else if (fcp > 1800) score -= 5;
    
    // TTFB: < 800ms good
    if (ttfb > 2000) score -= 15;
    else if (ttfb > 800) score -= 5;
    
    // CLS: < 0.1 good
    if (cls > 0.25) score -= 15;
    else if (cls > 0.1) score -= 5;
    
    // DOM size
    if (r.metrics.domSize > 2000) score -= 10;
    if (r.metrics.domSize > 5000) score -= 15;
    
    console.log(`  ${r.page.padEnd(15)} ~${Math.max(0, score)}% (est.)  |  LCP:${lcp?.toFixed(0) || 'N/A'}ms  FCP:${fcp?.toFixed(0) || 'N/A'}ms  CLS:${cls?.toFixed(3)}`);
  }

  console.log('\n✅ Audit complete.');
}

main().catch(console.error);
