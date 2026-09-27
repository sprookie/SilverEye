/**
 * SilverEye 端到端检查（本机 Chrome + playwright-core，不下载浏览器内核）
 * ---------------------------------------------------------------------------
 *   cd photo-sim
 *   F:\.venv\Scripts\python.exe server.py &
 *   NODE_PATH=<node workspace>/node_modules node scripts/e2e_check.js [url] [shoot]
 *
 * 第二个参数给 shoot 才会真的按一次快门（多花约 17 秒）。
 *
 * 做四件事：
 *   1. 抓 pageerror / console.error / requestfailed
 *   2. 首屏截图
 *   3. 改光圈、换机身与胶片、选手法、切场景，把关键读数打出来
 *   4. 可选：真按快门 → 等出图 → 开灯箱 → 校验 EXIF
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];
const ROOT = path.join(__dirname, '..');
const OUT = process.env.E2E_OUT || path.join(ROOT, '..', '_tmp');
const URL = process.argv[2] || 'http://127.0.0.1:8770/';
const SHOT = process.argv[3] === 'shoot';

function chromePath() {
  for (const p of CHROME) if (fs.existsSync(p)) return p;
  throw new Error('找不到本机 Chrome / Edge，请改 CHROME 数组');
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({
    executablePath: chromePath(),
    args: ['--no-proxy-server', '--no-first-run', '--disable-gpu'],
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1720, height: 1080 } });

  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('requestfailed', (r) => {
    if (!r.url().includes('/assets/scenes/')) {
      errors.push(`REQFAIL ${r.failure() && r.failure().errorText} ${r.url()}`);
    }
  });

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, 'e2e_1_home.png') });

  const read = () => page.evaluate(() => ({
    focal: document.getElementById('ivFocal').textContent,
    ap: document.getElementById('ivAperture').textContent,
    sh: document.getElementById('ivShutter').textContent,
    iso: document.getElementById('ivIso').textContent,
    film: document.getElementById('ivFilm').textContent,
    meter: document.getElementById('vfMeterNum').textContent,
    dof: document.getElementById('opticsHint').innerText.replace(/\n/g, ' | '),
    segCount: document.querySelectorAll('#promptBox .frag').length,
    zoom: getComputedStyle(document.getElementById('vf')).getPropertyValue('--zoom'),
    dofBlurOp: getComputedStyle(document.getElementById('vfDofBlur')).opacity,
  }));

  console.log('--- 初始状态 ---');
  console.log(JSON.stringify(await read(), null, 1));

  await page.click('#apChips .chip:nth-child(11)');       // f/16
  await page.waitForTimeout(500);
  console.log('--- 切到 f/16（应当变成欠曝，meter 为负数）---');
  console.log(JSON.stringify(await read(), null, 1));

  await page.evaluate(() => {
    [...document.querySelectorAll('#bodyChips .chip')]
      .find((x) => x.textContent.includes('尼康 FM2'))?.click();
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    [...document.querySelectorAll('#filmGroups .chip')]
      .find((x) => x.textContent.includes('Tri-X'))?.click();
  });
  await page.waitForTimeout(600);
  console.log('--- FM2 + Tri-X（vf.bw 应为 true）---');
  console.log(JSON.stringify(await read(), null, 1),
    'bw=' + await page.evaluate(() => document.getElementById('vf').classList.contains('bw')));
  await page.screenshot({ path: path.join(OUT, 'e2e_2_film_bw.png') });

  await page.evaluate(() => {
    [...document.querySelectorAll('#techChips .chip')]
      .find((x) => x.textContent.includes('追随拍摄'))?.click();
  });
  await page.waitForTimeout(500);
  console.log('--- 追随拍摄（快门应自动变 1/30）---',
    await page.evaluate(() => document.getElementById('ivShutter').textContent));

  await page.evaluate(() => {
    [...document.querySelectorAll('.scene-tile')]
      .find((x) => x.textContent.includes('雨夜霓虹'))?.click();
  });
  await page.waitForTimeout(1500);
  console.log('--- 切场景 雨夜霓虹（机身 / 胶片应被保留）---');
  console.log(JSON.stringify(await read(), null, 1));
  await page.screenshot({ path: path.join(OUT, 'e2e_3_scene_neon.png') });

  await page.click('#modeSeg button[data-mode="lesson"]');
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, 'e2e_4_lesson.png') });
  console.log('--- 课程数 =',
    await page.evaluate(() => document.querySelectorAll('#drawerBody .lesson').length));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  await page.click('#btnImmerse');
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, 'e2e_5_immersive.png') });
  await page.click('#btnImmerse');
  await page.waitForTimeout(600);

  if (SHOT) {
    console.log('--- 按快门 ---');
    const t0 = Date.now();
    await page.click('#shutterBtn');
    await page.waitForFunction(
      () => document.querySelectorAll('#filmstrip .frame:not(.skeleton)').length > 0,
      { timeout: 180000 });
    console.log(`出图耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(OUT, 'e2e_6_shot.png') });
    await page.evaluate(() => document.querySelector('#filmstrip .frame').click());
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT, 'e2e_7_lightbox.png') });
    console.log('--- EXIF ---\n' +
      await page.evaluate(() => document.getElementById('lbExif').innerText));
  }

  console.log(`\n=== 报错 (${errors.length}) ===`);
  errors.slice(0, 25).forEach((e) => console.log(' ! ' + e));

  await browser.close();
  process.exit(errors.length ? 2 : 0);
})().catch((e) => { console.error('DRIVER FAILED:', e); process.exit(1); });
