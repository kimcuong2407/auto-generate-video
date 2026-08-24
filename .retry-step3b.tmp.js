const { chromium } = require('playwright');
const fs = require('fs');
const LOG = '/tmp/retry-step3.log';
const log = (m) => fs.appendFileSync(LOG, `${new Date().toISOString()} ${m}\n`);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:3000/projects/ke-dung-do-hinh-gau-treo-tuong-jyoohome--657d09', { waitUntil: 'networkidle' });
  log('OPENED');

  await page.click('text=Storyboard ảnh');
  await page.waitForTimeout(1000);

  const btn = page.getByRole('button', { name: /Gen tất cả/ }).first();
  await btn.waitFor({ state: 'visible', timeout: 15000 });
  await btn.click();
  log('CLICKED_GEN_TAT_CA');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/run-shots6/step3-after-click.png' });

  await browser.close();
  log('SCRIPT_DONE');
})().catch(e => {
  log('FATAL_ERROR ' + (e && e.message));
  process.exit(1);
});
