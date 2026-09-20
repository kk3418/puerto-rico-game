# 波多黎各 Puerto Rico

Aleksander 經典桌遊《波多黎各》的瀏覽器實作：一人對戰本地啟發式 AI，規則引擎與介面皆為 TypeScript。對局仍在瀏覽器裡跑；後端負責帳號、對局紀錄、結構化航海日誌，以及終局分數驗證。

你種地、蓋建築、生產貨物、裝船運出，目標是在遊戲結束時擁有最多勝利分。

## 功能

- 3 / 4 / 5 人局（你 + 其餘玩家為 AI）
- 兩種 AI 風格：均衡、積極
- 角色輪次：拓荒者、市長、建築師、工匠、商人、船長、淘金者
- 建築效果、殖民者安置、貨船與倉庫、終局計分
- 盤面提示與中文介面
- 訪客暱稱開局；可選 Google 或 GitHub 登入後查自己的戰績
- 對局事件寫入資料庫；終局由伺服器重放引擎計分後再入帳
- 單人存檔／讀檔（之後多人需全體真人同意）

終局條件與原版相同：勝利分籌碼用盡、殖民者無法補滿殖民船、或任一玩家城市蓋滿。

## 開始遊戲

需要 Node.js 18 或更新版本，以及 Postgres（本機 Docker 或同等連線）。

```bash
cp .env.example .env          # 至少改 SESSION_SECRET
docker compose up -d          # Postgres 16，埠 5432
npm install
npx prisma migrate deploy
npm run dev
```

瀏覽器開啟 `http://localhost:5173`。`npm run dev` 會同時開 Vite 與 Express（`:3001`）；前端以同源 `/api` 轉發，並帶上 session cookie。

未填 OAuth 環境變數時仍可用暱稱訪客遊玩。Google／GitHub 按鈕只在設定對應 client id 後出現。GitHub callback 開發時請設成 `http://localhost:5173/api/auth/github/callback`。

| 指令 | 說明 |
| --- | --- |
| `npm run dev` | 同時開前端與 API |
| `npm run dev:client` | 只開 Vite |
| `npm run dev:server` | 只開 Express |
| `npm run build` | 型別檢查後打包前端與後端 |
| `npm run build:client` | 只打包前端到 `dist/` |
| `npm run build:server` | 只用 esbuild 打包後端到 `server/dist/` |
| `npm start` | 跑打包後的後端（正式環境入口） |
| `npm run preview` | 預覽正式打包 |
| `npm test` | 規則引擎與後端單元測試 |
| `npm run test:watch` | 監看模式跑測試 |
| `npm run db:up` | 啟動 compose 裡的 Postgres |
| `npm run db:deploy` | 套用 Prisma migration |

## 怎麼玩

1. 填暱稱（必填），選擇人數與 AI 風格後按「開局」。可選 Google／GitHub 登入。
2. 每回合依總督順序選擇一個尚未被拿的角色，並執行該角色的特權與行動。
3. 其餘玩家依序執行同一角色（無特權）。
4. 未選角色會累積金幣，下回合更誘人。
5. 遊戲結束後依籌碼、建築印刷分，以及大型建築加成（公會堂、宅邸、要塞、海關、市政廳）計分。

角色一覽：

| 角色 | 作用 |
| --- | --- |
| 拓荒者 | 拿種植園或採石場 |
| 市長 | 從殖民船取得殖民者並安置 |
| 建築師 | 花費金幣蓋建築 |
| 工匠 | 依已安置的種植園與生產建築產出貨物 |
| 商人 | 賣 1 桶貨物到交易屋 |
| 船長 | 把貨物裝上貨船換取勝利分 |
| 淘金者 | 拿 1 金幣（僅 4、5 人局；5 人局有兩個） |

規則細節以專案內的 `Puerto rule us korrigiert 2 - Puerto-Rico-Rules.pdf` 為準。

## 專案結構

```
src/
  engine/     純規則引擎：開局、合法行動、角色結算、計分（零 UI 依賴）
  agents/     PlayerAgent：HumanAgent、HeuristicAgent、回合迴圈
  ui/         React 介面；只經 Action 改狀態
  api/        呼叫 /api（session cookie）
  data/       建築定義
server/
  prisma/     Postgres schema 與 migration
  src/        Express：登入、對局、事件、finish 重放、存檔
```

核心迴圈：

```
legal = getLegalActions(state)
action = await agent.chooseAction({ state, legalActions, playerId })
state = applyAction(state, action)   // 僅此處改遊戲狀態
```

目前 AI 是啟發式評分（均衡模式偶而選次佳手），不是 LLM。UI 不直接改金幣、貨物、殖民者等欄位。

## 可擴展性（已預留）

線上即時對戰與 LLM 仍未做，但帳號與對局紀錄已接上；其餘介面按之後擴充落地：

1. **引擎零 UI 依賴** — `src/engine/` 純 TypeScript，無 React、無 `window`／DOM。唯一改狀態入口是 `applyAction`。
2. **`GameState` / `Action` JSON 可序列化** — 只用 plain data，可 `JSON.stringify` 往返；便於存檔、WebSocket 同步、給模型結構化輸出。
3. **`PlayerAgent` 一律 async** — 人類、啟發式、之後的 LLM 或遠端對手共用同一回合迴圈；非法 Action 在 `dispatchAction` 被拒絕，不進引擎。

```ts
type PlayerAgent = {
  chooseAction(input: {
    state: GameState
    legalActions: Action[]
    playerId: string
  }): Promise<Action>
}
```

| 實作 | 狀態 |
| --- | --- |
| `HumanAgent` | 已有：UI 點選後 resolve |
| `HeuristicAgent` | 已有：本機啟發式 |
| `LlmAgent` | 之後：prompt + 結構化輸出，解析成合法 Action |
| 遠端對手 | 之後：WebSocket 送來的 Action，同一介面 |

決策與傳輸可換，規則引擎不動。

## 之後：接 LLM

LLM 與啟發式做同一件事：給定狀態，從合法動作裡選一個。預期做法：

- 新增 `LlmAgent` 實作 `PlayerAgent`；開局把某個座位從 `HeuristicAgent` 換成它，不必改 `reduce.ts`。
- 把 `state` + `legalActions` 編成 prompt，要求模型回傳可序列化 Action（或 action id）；回傳不在合法集合內則丟棄並重試，或 fallback 啟發式。
- 之後可加 `toObservation(state)` 精簡觀測，減少 token、避免多餘內部欄位。

本階段不必做、加 LLM 時才需要：後端 proxy（勿把 API key 放前端）、prompt／JSON schema、延遲與「思考中」UI、費用與速率限制。不必為了 LLM 先上伺服器或多套狀態機。

## 之後：線上對戰／全端

帳號、訪客、對局紀錄與終局重放已完成。規則層不會重寫；下一步是「權威狀態 + 即時同步」。

| | 現在 | 之後即時對戰 |
| --- | --- | --- |
| 規則 | 瀏覽器跑 `engine/`；伺服器 finish 時重放同一套 | 進行中也由伺服器 `applyAction` |
| 狀態 | 本機對局；事件與存檔在 Postgres | 房間內即時 `GameState` |
| 對手 | 本機 Heuristic | 其他真人、伺服器跑 AI／LLM |
| 同步 | HTTP 事件批次 | WebSocket（Socket.IO） |

建議演進：

1. **Phase 1（已完成）** — SPA 對局 + Express／Prisma 帳號與紀錄；finish 以 `seed + events` 重放計分。
2. **半步（可選）** — 把 `src/engine` 收成獨立 package，前後端一起 import。
3. **全端** — 伺服器持有權威 `GameState`；客戶端只送 Action、收整包或 patch state；AI／LLM 在伺服器跑。`LlmAgent` 與線上房間可疊在同一層。

全端會另外長出、但不推翻引擎的部分：房間碼、斷線重連、只能動自己的回合、延遲與樂觀更新、多人存檔需全體同意。單人 vs AI 可繼續本機引擎。

## 部署（DigitalOcean App Platform）

規格在 [`.do/app.yaml`](.do/app.yaml)，後端映像在 [`.do/Dockerfile`](.do/Dockerfile)。

```bash
doctl apps create --spec .do/app.yaml      # 首次建立
doctl apps update <app-id> --spec .do/app.yaml
```

前端是獨立的 static site 元件、由 CDN 提供，所以後端重新部署時前端照樣可用。

| 元件 | 內容 |
| --- | --- |
| `web` static site | `npm run build:client` → `dist/` |
| `api` service | `.do/Dockerfile` |
| `db` database | Postgres 17 |
| `migrate` job | `PRE_DEPLOY`，跑 `prisma migrate deploy` |
| `prune-sessions` job | `SCHEDULED` 每日刪除過期 session |

部署前要在控制台補的環境變數：`SESSION_SECRET`（`openssl rand -hex 32`，至少 32 字、不要寫進 spec）、`GOOGLE_CLIENT_ID`、`GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET`，以及 static site 的 `VITE_GOOGLE_CLIENT_ID`。沒設 `SESSION_SECRET` 的話 API 起不來。`CLIENT_ORIGIN` 與 `GITHUB_CALLBACK_URL` 由 `${APP_URL}` 自動帶入。GitHub OAuth App 的 callback 要設成 `https://<你的網域>/api/auth/github/callback`。

幾個容易踩到的點：

- **`VITE_GOOGLE_CLIENT_ID` 必須是 `BUILD_TIME`**，Vite 會把它 inline 進 bundle；`GOOGLE_CLIENT_ID` 則是後端的 runtime 變數。兩個都要填才會出現 Google 登入。
- **ingress 的 `preserve_path_prefix: true` 不能拿掉。** App Platform 預設會裁掉 match 到的路徑前綴，`/api/health` 會變成 `/health` 送進 Express，全部 route 都會 404。
- **用 Dockerfile 而不是 Node buildpack**，因為 buildpack 會在 build 後移除 devDependencies，而 Prisma 產生的 client 位於 `node_modules/.prisma`。
- 前端呼叫的是相對路徑 `/api`，所以 static site 與 service 必須在同一個 app、同一個網域，session cookie 才不需要處理跨站。

## 技術

React 19、TypeScript、Vite、Vitest、Express、Prisma、Postgres。前端由 Vite 打包，後端以 esbuild 打包成單一檔案。
