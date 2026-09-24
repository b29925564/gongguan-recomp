# RECOMP

自動漸進超負荷的重訓紀錄 PWA：打勾、自動加重、看見每個動作的力量曲線。
起源於「公館重組計畫」這份個人課表，現在任何人都能選一套課表或自己排。
單一 `index.html`，不需要建置，部署在 [gongguan-recomp.vercel.app](https://gongguan-recomp.vercel.app)。

第一次打開會先選課表：**全身入門**（每週 3 天）、**上下半身**（4 天）、**推拉腿**（6 天）、
**公館重組計畫**（原版器械 A/B），或自己排。之後在 設定 → 訓練計畫 可以改動作、組數、次數、重量與每週排程。

## 畫面

| 分頁 | 做什麼 |
|---|---|
| **今日** | 當天的 A / B 訓練或休息日。一週日期列可直接跳日、左右滑動換日；每一組一格的進度條；52px 的打勾按鈕（點一下 = 完成、再點 = 達上限）；組間計時器會告訴你下一組是什麼；最後一組打完出現「訓練完成」畫面 |
| **月曆** | 月曆熱力圖、本月摘要、週報、匯出月曆圖片 |
| **進步** | 平均力量提升、每個動作的重量階梯曲線（可展開看每一次）、每週訓練量、近 16 週出席格與連續紀錄、1080×1350 進步卡 |
| **體重** | 體重紀錄、7 日平均趨勢線、每週增減 |

休息日有恢復清單（走路、睡眠、喝水）。深色模式、訓練中螢幕常亮、iPhone 觸覺回饋都在設定裡。

## 資料

所有紀錄只存在裝置的瀏覽器（`localStorage`，key 以 `recomp_` 開頭），不會上傳到任何地方。
設定 → 資料管理 可以匯出 / 匯入 JSON 備份；匯入或清除前會自動留一份快照，可以反悔。

| key | 內容 |
|---|---|
| `recomp_set_id_{日期}_{動作}_{組}` | `1` 完成、`2` 達上限 |
| `recomp_weight_id_{動作}` | 目前的重量 |
| `recomp_log_{日期}_{動作}` | 那一天實際用的重量（v3.3 起，打第一組時寫入） |
| `recomp_bump_{日期}_{動作}` | 那一天升重的增量，`0` = 升了又撤銷（v3.3 起） |
| `recomp_rest_{日期}_{項目}` | 休息日恢復清單（v3.3 起） |
| `recomp_bw_{日期}` | 體重 |
| `recomp_plan` | 課表與排程（沒有這個 key 時沿用原版課表，舊使用者不受影響） |
| `recomp_pref_*`、`recomp_theme` | 偏好設定 |

v3.3 之前沒有逐次存重量，舊紀錄的重量是由「現在的重量」與升重紀錄往回推算的，進步頁上以虛線與 ≈ 標示。
升級不會改動任何舊紀錄 —— `tests/fixtures/v3.2.0-storage.json` 是真正的 v3.2.0 產生的資料，每次測試都會驗證。

## 測試

每次 push（包含在 GitHub 網頁上傳檔案）都會在 GitHub Actions 的真實瀏覽器裡跑一遍，
失敗時可以在 Actions 分頁下載截圖與操作錄影。本機要跑的話：

```sh
cd tests
npm ci
npx playwright install chromium
npx playwright test
```

## 上架到 App Store / Google Play

這是一個完整的 PWA（manifest 有圖示、maskable 圖示、截圖、分類與捷徑），
可以直接用 [PWABuilder](https://www.pwabuilder.com) 輸入網址產生 iOS（Xcode 專案）與 Android（TWA）套件。
上架需要自己的 Apple Developer（每年 US$99）/ Google Play（一次 US$25）帳號並通過審查。

## 發版前檢查

三個地方的版本要一起改（測試會檢查前兩個）：

1. `index.html` 裡的 `APP_VERSION`
2. `version.json`
3. `sw.js` 裡的 `CACHE_NAME`（讓舊的離線快取被換掉）
