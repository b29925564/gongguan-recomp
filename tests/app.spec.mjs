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

/* 既有使用者：沿用原版課表、不顯示第一次打開的引導 */
async function open(page, seed){
  await page.goto('./');
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('rcmeta_onboarded', '1'); });
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

  test('manifest 與 apple-touch-icon 指到的圖示都存在', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const files = manifest.icons.map(i => i.src).concat(html.match(/rel="apple-touch-icon" href="([^"]+)"/)[1]);
    for(const f of files) expect(fs.existsSync(path.join(ROOT, f.replace(/^\.?\//, ''))), f).toBe(true);
    expect(manifest.icons.some(i => i.purpose === 'maskable')).toBe(true);
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
    await page.evaluate(() => localStorage.setItem('rcmeta_onboarded', '1'));
    await page.reload();
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
    await expect(page.locator('.switch[data-pref="restTimer"]')).toHaveAttribute('aria-checked', 'true');
    await page.click('.switch[data-pref="restTimer"]');
    await expect(page.locator('.switch[data-pref="restTimer"]')).toHaveAttribute('aria-checked', 'false');
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


test.describe('今日畫面', () => {
  test('做完最後一組 → 完成畫面，含升重與訓練量', async ({ page }) => {
    await open(page);
    const rows = page.locator('#dpWorkout [data-ex-row]');
    const n = await rows.count();
    for(let r = 0; r < n; r++){
      const sets = rows.nth(r).locator('.set-check');
      const c = await sets.count();
      for(let i = 0; i < c; i++){
        await sets.nth(i).click();
        if(r === 0) await sets.nth(i).click();          /* 胸推全紅 → 升重 */
      }
    }
    const layer = page.locator('#finishLayer');
    await expect(layer).toBeVisible();
    await expect(page.locator('#finishSetsTotal')).toHaveText('/16 組');
    await expect(page.locator('#finishLetter')).toHaveText('A');
    await expect(page.locator('#finishBumps')).toContainText('36 → 38.5kg');
    await expect(page.locator('#sessionBar .sb-seg.is-cap')).toHaveCount(4);
    await expect(page.locator('#dpSessionCount')).toHaveText('16/16 組');
    await page.click('#finishCloseBtn');
    await expect(layer).toBeHidden();
    /* 取消一組再打回來，不會再跳一次 */
    const last = rows.nth(n - 1).locator('.set-check').last();
    await last.click(); await last.click();
    await page.waitForTimeout(600);
    await expect(layer).toBeHidden();
    /* Esc 也能關 */
    await page.evaluate(() => showFinish('2026-9-23'));
    await expect(layer).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(layer).toBeHidden();
  });

  test('打勾後螢幕常亮，練完自動解除', async ({ page }) => {
    await page.addInitScript(() => {
      window.__wl = { req:0, rel:0 };
      Object.defineProperty(navigator, 'wakeLock', { configurable:true, value:{
        request: async () => { window.__wl.req++; return { release: async () => { window.__wl.rel++; }, addEventListener(){} }; }
      }});
    });
    await open(page);
    const rows = page.locator('#dpWorkout [data-ex-row]');
    await rows.first().locator('.set-check').first().click();
    await expect.poll(() => page.evaluate(() => window.__wl.req)).toBe(1);
    await rows.first().locator('.set-check').nth(1).click();
    expect(await page.evaluate(() => window.__wl.req)).toBe(1);      /* 不重複要求 */
    const n = await rows.count();
    for(let r = 0; r < n; r++){
      const sets = rows.nth(r).locator('.set-check:not(.done)');
      while(await sets.count()) await sets.first().click();
    }
    await expect.poll(() => page.evaluate(() => window.__wl.rel)).toBe(1);
  });

  test('計時器告訴你下一組是什麼', async ({ page }) => {
    await open(page);
    await page.locator('[data-ex-row="chest_press"] .set-check').first().click();
    await expect(page.locator('#restTimerLabel')).toContainText('第 2 組');
    await expect(page.locator('#restTimerLabel b')).toHaveText('合式胸部推舉機');
  });

  test('日期列直接跳到那一天；回到今天', async ({ page }) => {
    await open(page);
    await expect(page.locator('#dpToday')).toBeHidden();
    await page.click('#weekStrip .ws-day[data-ymd="2026-9-21"]');
    await expect(page.locator('#dpKicker')).toContainText('09/21');
    await expect(page.locator('#weekStrip .ws-day.is-selected')).toHaveAttribute('data-ymd', '2026-9-21');
    await page.click('#dpToday');
    await expect(page.locator('#dpKicker')).toContainText('今天');
  });

  test('休息日的恢復清單會存起來', async ({ page }) => {
    await open(page);
    await page.click('#dpPrev');                       /* 9/22 休 */
    await expect(page.locator('#dpTitle')).toHaveText('休息日');
    await page.click('[data-recovery="sleep"]');
    await expect(page.locator('[data-recovery="sleep"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#dpSessionCount')).toHaveText('1/3 項');
    expect(await stored(page, 'recomp_rest_2026-9-22_sleep')).toBe('1');
    await page.reload();
    await page.click('#dpPrev');
    await expect(page.locator('[data-recovery="sleep"]')).toHaveClass(/is-done/);
    /* 點「下次訓練」直接跳過去 */
    await page.click('.rest-next');
    await expect(page.locator('#dpTitle')).toContainText('A日');
  });
});


test.describe('給每個人用', () => {
  test('新使用者：引導 → 選「上下半身」→ 課表生效', async ({ page }) => {
    await page.goto('./');
    await page.evaluate(() => localStorage.clear());
    await page.goto('./');
    await expect(page.locator('#onboard')).toBeVisible();
    await page.click('#obStartBtn');
    await page.click('[data-template="ul"]');
    await expect(page.locator('#onboard')).toBeHidden();
    const plan = JSON.parse(await stored(page, 'recomp_plan'));
    expect(plan.workouts.A.name).toBe('上半身');
    /* 9/23 是週三：上下半身的週三休息；週一是上半身 */
    await expect(page.locator('#dpTitle')).toHaveText('休息日');
    await page.click('#weekStrip .ws-day[data-ymd="2026-9-21"]');
    await expect(page.locator('#dpTitle')).toHaveText('A日 上半身');
    await expect(page.locator('#dpWorkout [data-ex-row="bench_press"]')).toBeVisible();
    await expect(page.locator('#dpWorkout [data-ex-row="chest_press"]')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('#onboard')).toBeHidden();
    await page.click('.tabbar-btn[data-screen="calendar"]');
    await expect(page.locator('.cal-legend')).toContainText('下半身');
  });

  test('編輯課表：改名、加動作、改成每週排程', async ({ page }) => {
    await open(page);
    await page.click('#settingsBtn');
    await page.click('#planEditBtn');
    await expect(page.locator('#planModal')).toHaveClass(/show/);
    await page.fill('.pe-workout[data-code="A"] .pe-wname', '胸肩三頭');
    await page.click('.pe-workout[data-code="A"] [data-act="add-ex"]');
    const last = page.locator('.pe-workout[data-code="A"] .pe-ex').last();
    await last.locator('[data-field="name"]').fill('啞鈴飛鳥');
    await last.locator('[data-field="sets"]').fill('4');
    await last.locator('[data-field="kgNow"]').fill('12');
    /* 原版是 31 天循環 → 改成每週，並把週三（今天）設成休息 */
    await page.click('#planBody [data-act="to-weekly"]');
    const wed = page.locator('.pe-day[data-day="2"]');
    while(!(await wed.textContent()).includes('休')) await wed.click();
    await page.click('#planSaveBtn');
    await expect(page.locator('#planModal')).not.toHaveClass(/show/);
    await expect(page.locator('#dpTitle')).toHaveText('休息日');
    const plan = JSON.parse(await stored(page, 'recomp_plan'));
    expect(plan.cycle).toHaveLength(7);
    expect(plan.workouts.A.name).toBe('胸肩三頭');
    const added = plan.workouts.A.exercises.at(-1);
    expect(added).toMatchObject({ name:'啞鈴飛鳥', sets:4 });
    expect(await stored(page, 'recomp_weight_id_' + added.id)).toBe('12');
    /* 轉成每週時保留本週原本的樣子：週一 B、週六 A */
    await page.click('#weekStrip .ws-day[data-ymd="2026-9-21"]');
    await expect(page.locator('#dpTitle')).toHaveText('B日 下肢背');
    await page.click('#weekStrip .ws-day[data-ymd="2026-9-26"]');
    await expect(page.locator('#dpTitle')).toHaveText('A日 胸肩三頭');
    await expect(page.locator('#dpWorkout [data-ex-row="' + added.id + '"] .set-check')).toHaveCount(4);
  });

  test('改排程不會改到過去的紀錄', async ({ page }) => {
    await open(page, `(() => { for(let s = 1; s <= 4; s++) localStorage.setItem('recomp_set_id_2026-9-20_chest_press_' + s, '1'); })()`);
    const before = await page.evaluate(() => exerciseHistory(exerciseById('chest_press')).map(s => s.ds));
    await page.evaluate(() => { const p = currentPlan(); p.cycle = ['B','休','休','休','休','休','休']; savePlan(p); });
    const after = await page.evaluate(() => exerciseHistory(exerciseById('chest_press')).map(s => s.ds));
    expect(after).toEqual(before);
    expect(after).toContain('2026-9-20');
  });

  test('空白的課表不能存', async ({ page }) => {
    await open(page);
    await page.click('#settingsBtn');
    await page.click('#planEditBtn');
    const names = page.locator('.pe-workout[data-code="B"] .pe-name');
    const n = await names.count();
    for(let i = 0; i < n; i++) await names.nth(i).fill('');
    await page.click('#planSaveBtn');
    await expect(page.locator('#planMsg')).toHaveText('B 日至少要有一個動作');
    await expect(page.locator('#planModal')).toHaveClass(/show/);
  });
});


test.describe('升級安全', () => {
  /* fixtures/v3.2.0-storage.json：用真正的 v3.2.0（commit 40c98ad）在瀏覽器裡
     操作出來的 localStorage —— 三個月的打勾、體重、手動改過的重量、偏好設定。
     舊紀錄只存在使用者手機裡，升級絕對不能動到任何一筆。 */
  const FIXTURE = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/v3.2.0-storage.json'), 'utf8'));
  const load = `(() => { const d = ${JSON.stringify(FIXTURE.data)}; for(const k in d) localStorage.setItem(k, d[k]); })()`;
  const dump = page => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])));
  const records = obj => Object.fromEntries(Object.entries(obj).filter(([k]) => k.startsWith('recomp_')));

  test('打開新版、逛過每一頁，舊紀錄一筆都沒變', async ({ page }) => {
    await open(page, load);
    for(const s of ['calendar', 'progress', 'weight', 'today']) await page.click(`.tabbar-btn[data-screen="${s}"]`);
    await page.click('#searchOpenBtn'); await page.keyboard.press('Escape');
    await page.click('#settingsBtn'); await page.keyboard.press('Escape');
    expect(records(await dump(page))).toEqual(records(FIXTURE.data));
  });

  test('新版讀得懂舊資料，而且不會跳出新使用者引導', async ({ page }) => {
    await page.goto('./');
    await page.evaluate(() => localStorage.clear());
    await page.evaluate(load);
    await page.goto('./');
    await expect(page.locator('#onboard')).toBeHidden();
    await expect(page.locator('#dpTitle')).toHaveText('A日 上肢推');
    await page.click('.tabbar-btn[data-screen="weight"]');
    await expect(page.locator('#bwStatsRow .stat-cell-val').first()).toHaveText('75.8kg');
    await page.click('.tabbar-btn[data-screen="progress"]');
    await expect(page.locator('#pgTitle')).toHaveText(/^\+\d/);
    await expect(page.locator('.pg-lift[data-lift="triceps_press"] .pg-lift-meta')).toContainText('45kg');
    await expect(page.locator('html')).toHaveAttribute('data-theme-pref', 'light');
  });

  test('在新版打勾，只會新增紀錄，不會改到其他天', async ({ page }) => {
    await open(page, load);
    const todayKey = 'recomp_set_id_2026-9-23_pec_fly_1';
    const orig = records(FIXTURE.data);
    const beforeToday = orig[todayKey] ?? null;
    await page.locator('[data-ex-row="pec_fly"] .set-check').first().click();
    const now = records(await dump(page));
    for(const [k, v] of Object.entries(orig)){
      if(k === todayKey) continue;
      expect(now[k], k).toBe(v);
    }
    expect(now[todayKey]).not.toBe(beforeToday);
  });
});


test('每個分頁都能正常切換', async ({ page }) => {
  await open(page);
  for(const name of ['calendar', 'progress', 'weight', 'today']){
    await page.click(`.tabbar-btn[data-screen="${name}"]`);
    await expect(page.locator(`.tabbar-btn[data-screen="${name}"]`)).toHaveAttribute('aria-selected', 'true');
  }
});
