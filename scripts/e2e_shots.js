/**
 * 重拍 docs/ 下的界面截图
 * ---------------------------------------------------------------------------
 *   NODE_PATH=<node workspace>/node_modules node scripts/e2e_shots.js
 *
 * 服务器要先跑起来（server.py）。截图直接写进 docs/。
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];
const DOC = path.join(__dirname, '..', 'docs');
const URL = process.argv[2] || 'http://127.0.0.1:8770/';

const chromePath = () => CHROME.find((p) => fs.existsSync(p)) || (() => { throw new Error('找不到 Chrome'); })();

(async () => {
  const browser = await chromium.launch({
    executablePath: chromePath(),
    args: ['--no-proxy-server', '--no-first-run', '--disable-gpu'],
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1760, height: 1080 }, deviceScaleFactor: 1.4 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  const shoot = (f) => page.screenshot({ path: path.join(DOC, f) });
  const pick = (sel, txt) => page.evaluate(([s, t]) => {
    [...document.querySelectorAll(s)].find((x) => x.textContent.includes(t))?.click();
  }, [sel, txt]);

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(3000);
  await page.evaluate(() => document.getElementById('vfHist').classList.add('on'));
  await page.waitForTimeout(400);
  await shoot('01-主界面.png');

  // 黑白胶片 + 黄金时刻
  await pick('#bodyChips .chip', '徕卡 M6');
  await page.waitForTimeout(450);
  await pick('#filmGroups .chip', 'Tri-X');
  await page.waitForTimeout(350);
  await pick('#techChips .chip', '黄金时刻');
  await page.waitForTimeout(500);
  await pick('.scene-tile', '古镇巷弄');
  await page.waitForTimeout(2000);
  await shoot('02-胶片黑白.png');

  await page.click('#btnImmerse');
  await page.waitForTimeout(1100);
  await shoot('03-沉浸取景.png');
  await page.click('#btnImmerse');
  await page.waitForTimeout(700);

  await page.click('#modeSeg button[data-mode="lesson"]');
  await page.waitForTimeout(1000);
  await shoot('04-教材课程.png');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  await page.evaluate(() => document.querySelector('#filmstrip .frame').click());
  await page.waitForTimeout(1000);
  await shoot('06-灯箱EXIF.png');
  await page.evaluate(() => document.getElementById('lbClose').click());
  await page.waitForTimeout(500);

  console.log(`截图完成，报错 ${errors.length}`);
  errors.slice(0, 5).forEach((e) => console.log(' ! ' + e));
  await browser.close();
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
