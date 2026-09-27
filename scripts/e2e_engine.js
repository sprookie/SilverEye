/**
 * 生图引擎面板的端到端检查
 * ---------------------------------------------------------------------------
 *   NODE_PATH=<node workspace>/node_modules node scripts/e2e_engine.js
 *
 * 检查：
 *   1. 五个引擎卡片、十二个预设是否渲染
 *   2. 连通性实测（绿/红/灰点）是否按当前网络给出结果
 *   3. 切引擎时表单字段与能力提示是否跟着变
 *   4. 「测试连接」是否给出可读结果
 *   5. 自定义机型：建 → 存 → 刷新 → 仍在
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

const GREEN = '83, 209, 122';
const RED = '255, 77, 67';

(async () => {
  const browser = await chromium.launch({
    executablePath: CHROME.find((p) => fs.existsSync(p)),
    args: ['--no-proxy-server', '--no-first-run', '--disable-gpu'],
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1760, height: 1080 }, deviceScaleFactor: 1.4 });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  const shot = (f) => page.screenshot({ path: path.join(DOC, f) });

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(3000);

  /* ---------------------------------------------------- 1. 引擎面板 */
  await page.click('#btnEngine');
  await page.waitForTimeout(4500);                 // 等后台探测 + 前端轮询

  const cards = await page.evaluate(() => document.querySelectorAll('#engineList .engine-card').length);
  const presets = await page.evaluate(() => [...document.querySelectorAll('#enginePresets .chip')].map((c) => ({
    label: c.textContent.trim(),
    color: getComputedStyle(c.querySelector('span')).backgroundColor,
    tip: (c.title || '').split('\n')[1] || '',
  })));
  console.log(`引擎卡片 ${cards} 个 · 预设 ${presets.length} 个`);
  console.log('连通性（按当前网络实测）：');
  presets.forEach((p) => {
    const mark = p.color.includes(GREEN) ? '🟢' : p.color.includes(RED) ? '🔴' : '⚪';
    console.log(`  ${mark} ${p.label.padEnd(32)} ${p.tip}`);
  });
  console.log('状态文案:', await page.evaluate(() => document.getElementById('reachState').textContent));
  await shot('08-生图引擎.png');

  /* ------------------------------------------- 2. 切引擎 → 字段变化 */
  const fieldsOf = () => page.evaluate(() =>
    [...document.querySelectorAll('#engineForm .field > label')]
      .map((e) => e.textContent.trim().split(' ')[0]));
  const hintOf = () => page.evaluate(() =>
    document.getElementById('engineHint').innerText.replace(/\n/g, ' | '));

  await page.evaluate(() => { window.ENGINEBOX.active = 'openai_images'; });
  await page.waitForTimeout(500);
  console.log('\nOpenAI 表单字段:', (await fieldsOf()).join(' / '));
  console.log('OpenAI 能力提示:', await hintOf());

  await page.evaluate(() => { window.ENGINEBOX.active = 'comfy_qwen'; });
  await page.waitForTimeout(500);
  console.log('\n本地引擎表单字段:', (await fieldsOf()).join(' / '));
  console.log('本地引擎能力提示:', await hintOf());
  await page.click('#btnProbe');
  await page.waitForTimeout(2500);
  console.log('本地引擎预检:', await page.evaluate(() => document.getElementById('engineMsg').textContent));

  /* ------------------------------------- 3. 重新检测连通性不阻塞界面 */
  const t0 = Date.now();
  await page.click('#btnRecheck');
  await page.waitForFunction(
    () => document.getElementById('reachState').textContent.indexOf('已按当前网络实测') >= 0,
    { timeout: 60000 });
  console.log(`\n重新检测耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  await page.evaluate(() => window.ENGINEBOX.close());
  await page.waitForTimeout(400);

  /* --------------------------------------------- 4. 自定义机型持久化 */
  const name = 'E2E 测试机 ' + Date.now().toString(36).slice(-4);
  await page.click('#btnNewBody');
  await page.waitForTimeout(500);
  await page.fill('#gCn', name);
  await page.fill('#gName', 'SilverEye E2E');
  await page.selectOption('#gGrip', 'rangefinder');
  await page.click('#gAutoToken');
  await page.waitForTimeout(350);
  const token = await page.inputValue('#gToken');
  console.log('\n自动签名:', token.slice(0, 130));
  await page.click('#gearSave');
  await page.waitForTimeout(1200);

  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(3000);
  const persisted = await page.evaluate((want) => {
    const chips = [...document.querySelectorAll('#bodyChips .chip')];
    const hit = chips.find((c) => c.textContent.trim() === want);
    return { total: chips.length, found: !!hit, marked: hit ? hit.classList.contains('mine') : false };
  }, name);
  console.log('刷新后自定义机型:', JSON.stringify(persisted));

  /* ---------------------------------------------- 5. 提示词里真的有签名 */
  await page.evaluate((want) => {
    [...document.querySelectorAll('#bodyChips .chip')].find((c) => c.textContent.trim() === want).click();
  }, name);
  await page.waitForTimeout(600);
  const prompt = await page.evaluate(() => document.getElementById('promptBox').innerText);
  console.log('提示词含自定义签名:', prompt.indexOf('SilverEye E2E') >= 0);
  const i = prompt.indexOf('SilverEye E2E');
  console.log('片段: …' + prompt.slice(Math.max(0, i - 30), i + 110) + '…');
  await shot('10-自定义机型生效.png');

  console.log(`\n=== 报错 (${errors.length}) ===`);
  errors.slice(0, 12).forEach((e) => console.log(' ! ' + e));
  await browser.close();
  process.exit(errors.length ? 2 : 0);
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
