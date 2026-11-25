# 線上規則模擬器（scripts/sim）

以真實 Socket.IO 連線對伺服器跑整局線上對局，以及斷線、關網頁、投票等情境，
驗證 PR #12 的線上規則（不含瀏覽器 UI，UI 流程屬 e2e 範圍）。

## 前置

- Postgres 可連線（使用獨立的 `?schema=sim` schema，migrations 由腳本經測試
  harness 自動部署）
- `npm install`（含 `prisma generate`）
- 專案根目錄有 `.env`（沿用其中的 SESSION_SECRET 與資料庫主機/帳號）

## 執行

```sh
npx tsx scripts/sim/online-scenarios.ts
```

全部通過會印出 `ALL SCENARIOS PASSED`；失敗時列出 `FAIL` 清單並回傳非零 exit code。

## 計時器縮短（可選）

正式預設為 90 秒閒置 / 60 秒投票 / 800ms AI 延遲；模擬用 env 縮短：

```sh
SIM_ONLINE_IDLE_MS=2200 SIM_ONLINE_AI_DELAY_MS=250 SIM_ONLINE_VOTE_MS=1500 \
  npx tsx scripts/sim/online-scenarios.ts
```

## 覆蓋情境

- 3 人局與 5 人局全真人打完整局（分數與引擎重放比對、事件序號連續、verified）
- socket 連線不穩：多次斷線重連（含正輪到行動者時），重連後 state 重新同步
- 輪到自己時關掉網頁（不呼叫 leave）→ 閒置到期 AI 接手、AI 延遲行為量測
- 投票階段直接關網頁 → deadline 結算
- 發起人開票後立即關頁 + 他人反對 → 提前結算 failed、冷卻生效
- 投票中斷線重連 → watch 帶 open vote、補票提前結算
- 對局中按離開 → 座位轉 AI、可立即開新房、舊 socket 被拒
- 棄局規則（只剩一位真人時）

每個情境的伺服器端行為皆以「DB 事件重放 == 模擬器本地狀態」及最終計分雙重驗證。
