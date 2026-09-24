/* RECOMP 瀏覽器測試
   每一條都對應一個真的發生過、或是這次修掉的問題。
   時間固定在 2026-09-23（台北，A 日），外部網路（字型、圖示）一律擋掉，
   讓結果不受日期與網路影響。 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TODAY = new Date('2026-09-23T10:00:00+08:00');

/* 每個測試：固定時間、擋外部網路、收集 JS 錯誤 */
test.beforeEach(async ({ page }, info) => {
  await page.clock.setFixedTime(TODAY);
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.abort());
  info.pageErrors = [];
  page.on('pageerror', e => info.pageErrors.push(e.message));
});

test.afterEach(async ({ page }, info) => {
  /* app 自己的錯誤列（#errorBanner）出現就算失敗 */
  const banner = await page.evaluate(() => {
    const b = document.getElementById('errorBanner');
    return b && getComputedStyle(b).display !== 'none' ? b.textContent : null;
  }).catch(() => null);
  expect(info.pageErrors || [], 'uncaught page errors').toEqual([]);
  expect(banner, 'error banner').toBeNull();
});

async function open(page, seed){
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  if(seed) await page.evaluate(seed);
  await page.goto('./');
  await expect(page.locator('#dpTitle')).not.toHaveText('—');
}

const chestSets = page => page.locator('[data-ex-row="chest_press"] .set-check');
const stored = (page, key) => page.evaluate(k => localStorage.getItem(k), key);

/* 往前找最近的幾個 A 日（不含今天），由舊到新 */
const PAST_A_DAYS = (n) => `(() => {
  const out = []; const d = new Date(); d.setHours(12,0,0,0);
  while(out.length < ${n}){ d.setDate(d.getDate() - 1); if(getPlanForDate(d).train === 'A') out.unshift(formatDateStr(d)); }
  return out;
})()`;


test.describe('發版', () => {
  test('version.json 與 APP_VERSION 一致', () => {
    /* v3.2.0 上線時 version.json 還停在 v3.1.0，每次打開都跳「有新版本」 */
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const appVersion = html.match(/const APP_VERSION = '([^']+)'/)[1];
    const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));
    expect(version).toBe(appVersion);
  });

  test('只有伺服器版本比較新才提示更新', async ({ page }) => {
    await page.route('**/version.json*', r => r.fulfill({ json: { version: 'v3.1.0' } }));
    await open(page);
    await page.waitForTimeout(300);
    await expect(page.locator('#versionUpdateBanner.show')).toHaveCount(0);

    await page.unroute('**/version.json*');
    await page.route('**/version.json*', r => r.fulfill({ json: { version: 'v99.0.0' } }));
    await page.reload();
    await expect(page.locator('#versionUpdateBanner.show')).toContainText('v99.0.0');
  });

  test('compareVersions 逐段比數字', async ({ page }) => {
    await open(page);
    expect(await page.evaluate(() => [
      compareVersions('v3.10.0', 'v3.9.2'), compareVersions('v3.3.0', 'v3.3.0'),
      compareVersions('v3.1.0', 'v3.2.0'), compareVersions('3.3', 'v3.3.0'),
    ])).toEqual([1, 0, -1, 0]);
  });
});


test.describe('搜尋', () => {
  test('打開就有結果，篩選與點選都正常', async ({ page }) => {
    /* 原本讀了已刪除的 orderDrawer → TypeError，結果永遠是空的 */
    await open(page);
    await page.click('#searchOpenBtn');
    await expect(page.locator('#searchResults .search-item').first()).toBeVisible();
    await expect(page.locator('#searchResultMeta')).toContainText('找到');

    await page.click('#searchFilterRow [data-filter="rest"]');
    const titles = await page.locator('#searchResults .search-item-title').allTextContents();
    expect(titles.length).toBeGreaterThan(0);
    expect(titles.every(t => t.includes('休息日'))).toBe(true);

    await page.click('#searchFilterRow [data-filter="all"]');
    await page.fill('#searchInput', '2026-09-20');
    await page.locator('#searchResults .search-item').first().click();
    await expect(page.locator('#searchDrawer')).not.toHaveClass(/open/);
    await expect(page.locator('#dpKicker')).toContainText('09/20');
  });

  test('點抽屜外面會關閉', async ({ page }) => {
    await open(page);
    await page.click('#searchOpenBtn');
    await expect(page.locator('#searchDrawer')).toHaveClass(/open/);
    await page.mouse.click(page.viewportSize().width - 5, 400);
    await expect(page.locator('#searchDrawer')).not.toHaveClass(/open/);
  });
});


test.describe('升重', () => {
  test('全部達上限只升一次；點錯再改回來不會重複升', async ({ page }) => {
    await open(page);
    await expect(page.locator('#dpTitle')).toContainText('A日');
    const sets = chestSets(page);
    for(let i = 0; i < 4; i++){ await sets.nth(i).click(); await sets.nth(i).click(); }
    expect(await stored(page, 'recomp_weight_id_chest_press')).toBe('38.5');

    /* 標籤：當天用的重量 + 一個升重徽章，不能出現兩份重量 */
    const label = page.locator('[data-ex-weight="chest_press"]');
    await expect(label).toContainText('36kg · 6-10');
    await expect(label).toContainText('+2.5kg ▲');
    expect((await label.textContent()).match(/kg · /g)).toHaveLength(1);

    /* 紅 → 空：收回升重 */
    await sets.nth(3).click();
    expect(await stored(page, 'recomp_weight_id_chest_press')).toBe('36');
    /* 空 → 完成 → 紅：再升一次，總共還是 +2.5 */
    await sets.nth(3).click(); await sets.nth(3).click();
    expect(await stored(page, 'recomp_weight_id_chest_press')).toBe('38.5');
  });

  test('撤銷之後重量還能點擊修改', async ({ page }) => {
    await open(page);
    const sets = chestSets(page);
    for(let i = 0; i < 4; i++){ await sets.nth(i).click(); await sets.nth(i).click(); }
    await page.click('[data-ex-weight="chest_press"] .bump-undo');
    expect(await stored(page, 'recomp_weight_id_chest_press')).toBe('36');
    await expect(page.locator('[data-edit-weight="chest_press"]')).toHaveCount(1);
    /* 撤銷過的那天不能再被算成升重 */
    expect(await page.evaluate(() => exerciseHistory(exerciseById('chest_press')).at(-1).bump)).toBe(0);
  });
});


test.describe('重量歷史', () => {
  test('打第一組時記下當天的重量', async ({ page }) => {
    await open(page);
    await chestSets(page).first().click();
    expect(await stored(page, 'recomp_log_2026-9-23_chest_press')).toBe('36');
    /* 全部取消 = 沒練，紀錄一起清掉 */
    await chestSets(page).first().click();
    await chestSets(page).first().click();
    expect(await stored(page, 'recomp_log_2026-9-23_chest_press')).toBeNull();
  });

  test('修改過去某天只更正那天，不動現在的重量', async ({ page }) => {
    await open(page, `(() => {
      const [d] = ${PAST_A_DAYS(1)};
      for(let s = 1; s <= 4; s++) localStorage.setItem('recomp_set_id_' + d + '_chest_press_' + s, '1');
      localStorage.setItem('recomp_log_' + d + '_chest_press', '34');
      localStorage.setItem('recomp_weight_id_chest_press', '36');
      window.__pastDay = d;
    })()`);
    const past = await page.evaluate(PAST_A_DAYS(1));
    await page.click('#dpPrev');
    while(!(await page.locator('#dpTitle').textContent()).startsWith('A日')) await page.click('#dpPrev');
    await expect(page.locator('[data-edit-weight="chest_press"]')).toHaveText('34kg');

    await page.click('[data-edit-weight="chest_press"]');
    await page.fill('.ex-weight-input', '33');
    await page.keyboard.press('Enter');
    expect(await stored(page, `recomp_log_${past[0]}_chest_press`)).toBe('33');
    expect(await stored(page, 'recomp_weight_id_chest_press')).toBe('36');

    /* 回到今天：「上次」要引用更正後的值 */
    await page.click('#dpToday');
    await expect(page.locator('[data-ex-row="chest_press"] .ex-last')).toContainText('33kg');
  });

  test('沒有逐次紀錄的舊資料，從現在的重量往回推', async ({ page }) => {
    await open(page, `(() => {
      const [d1, d2, d3] = ${PAST_A_DAYS(3)};
      const set = (d, v) => { for(let s = 1; s <= 4; s++) localStorage.setItem('recomp_set_id_' + d + '_chest_press_' + s, v); };
      set(d1, '1'); set(d2, '2'); set(d3, '2');
      localStorage.setItem('recomp_weight_id_chest_press', '41');
    })()`);
    const hist = await page.evaluate(() => exerciseHistory(exerciseById('chest_press')).map(s => [s.kg, s.estimated]));
    expect(hist).toEqual([[36, true], [36, true], [38.5, true]]);
  });
});


test.describe('進步', () => {
  const SEED = `(() => {
    const [d1, d2, d3] = ${PAST_A_DAYS(3)};
    const set = (d, v) => { for(let s = 1; s <= 4; s++) localStorage.setItem('recomp_set_id_' + d + '_chest_press_' + s, v); };
    set(d1, '1'); set(d2, '2'); set(d3, '2');
    localStorage.setItem('recomp_log_' + d1 + '_chest_press', '36');
    localStorage.setItem('recomp_log_' + d2 + '_chest_press', '36');
    localStorage.setItem('recomp_bump_' + d2 + '_chest_press', '2.5');
    localStorage.setItem('recomp_log_' + d3 + '_chest_press', '38.5');
    localStorage.setItem('recomp_bump_' + d3 + '_chest_press', '2.5');
    localStorage.setItem('recomp_weight_id_chest_press', '41');
  })()`;

  test('摘要、力量曲線與出席格', async ({ page }) => {
    await open(page, SEED);
    await page.click('.tabbar-btn[data-screen="progress"]');
    await expect(page.locator('#screenProgress')).toBeVisible();

    /* 只有胸推有紀錄：36 → 41 = +13.9% */
    await expect(page.locator('#pgTitle')).toHaveText('+13.9%');
    await expect(page.locator('#pgStats')).toContainText('3次');
    await expect(page.locator('#pgStats')).toContainText('2次');

    const lift = page.locator('.pg-lift[data-lift="chest_press"]');
    await expect(lift).toContainText('36 → 41kg · 3 次');
    await expect(lift.locator('.pg-delta')).toHaveText('+5');

    await lift.click();
    await expect(lift).toHaveAttribute('aria-expanded', 'true');
    const detail = page.locator('#pg-detail-chest_press');
    await expect(detail.locator('svg')).toBeVisible();
    await expect(detail.locator('.pg-session')).toHaveCount(3);
    await expect(detail.locator('.pg-session').first()).toContainText('38.5kg');
    await expect(detail.locator('.pg-key-dash')).toHaveCount(0);   /* 都是實際紀錄，沒有推算值 */

    await expect(page.locator('.pg-heat .pg-cell.h-full')).toHaveCount(0);  /* 只練了胸推 → 部分完成 */
    await expect(page.locator('.pg-heat .pg-cell.h-partial')).toHaveCount(3);
    await expect(page.locator('.pg-heat .pg-cell.h-today')).toHaveCount(1);
  });

  test('空資料顯示引導，不會壞掉', async ({ page }) => {
    await open(page);
    await page.click('.tabbar-btn[data-screen="progress"]');
    await expect(page.locator('#pgLifts')).toContainText('還沒有訓練紀錄');
  });

  test('打勾之後進步頁即時更新', async ({ page }) => {
    await open(page, SEED);
    await page.click('.tabbar-btn[data-screen="progress"]');
    await expect(page.locator('#pgStats')).toContainText('3次');
    await page.click('.tabbar-btn[data-screen="today"]');
    await chestSets(page).first().click();
    await page.click('.tabbar-btn[data-screen="progress"]');
    await expect(page.locator('#pgStats .stat-cell').first()).toContainText('4次');
  });

  test('進步卡是 1080×1350', async ({ page }) => {
    await open(page, SEED);
    const size = await page.evaluate(() => { const c = drawProgressCard(); return [c.width, c.height]; });
    expect(size).toEqual([1080, 1350]);
  });
});


test.describe('主題與設定', () => {
  test('跟隨系統 + 系統深色 = 完整的深色樣式', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'dark', timezoneId: 'Asia/Taipei' });
    const page = await context.newPage();
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.abort());
    await page.goto('./');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme-pref', 'auto');
    await page.click('.tabbar-btn[data-screen="calendar"]');
    /* 原本 auto 模式下非本月格子是米白色 rgb(238,235,230) */
    const bg = await page.locator('.cal-cell.is-other').first().evaluate(el => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe('rgb(238, 235, 230)');
    await context.close();
  });

  test('關掉組間計時器，正在倒數的也會消失', async ({ page }) => {
    await open(page);
    await chestSets(page).first().click();
    await expect(page.locator('#restTimer')).toHaveClass(/show/);
    await page.click('#settingsBtn');
    await page.click('[data-pref="restTimer"][data-val="0"]');
    await expect(page.locator('#restTimer')).not.toHaveClass(/show/);
  });

  test('匯入備份接受新的歷史紀錄 key', async ({ page }) => {
    await open(page);
    await page.click('#settingsBtn');
    const payload = { app:'RECOMP', data:{
      'recomp_set_id_2026-9-20_chest_press_1':'1',
      'recomp_log_2026-9-20_chest_press':'37.5',
      'recomp_bump_2026-9-20_chest_press':'2.5',
      'evil_key':'x',
    }};
    await page.setInputFiles('#importFileInput', { name:'b.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(payload)) });
    await expect(page.locator('#dataToolsMsg')).toContainText('已匯入 3 筆');
    expect(await stored(page, 'recomp_log_2026-9-20_chest_press')).toBe('37.5');
    expect(await stored(page, 'evil_key')).toBeNull();
  });
});


test('每個分頁都能正常切換', async ({ page }) => {
  await open(page);
  for(const name of ['calendar', 'progress', 'weight', 'today']){
    await page.click(`.tabbar-btn[data-screen="${name}"]`);
    await expect(page.locator(`.tabbar-btn[data-screen="${name}"]`)).toHaveAttribute('aria-selected', 'true');
  }
});
