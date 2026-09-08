# 波多黎各 Puerto Rico

Aleksander 經典桌遊《波多黎各》的瀏覽器實作：一人對戰本地啟發式 AI，規則引擎與介面皆為 TypeScript。

你種地、蓋建築、生產貨物、裝船運出，目標是在遊戲結束時擁有最多勝利分。

## 功能

- 3 / 4 / 5 人局（你 + 其餘玩家為 AI）
- 兩種 AI 風格：均衡、積極
- 角色輪次：拓荒者、市長、建築師、工匠、商人、船長、淘金者
- 建築效果、殖民者安置、貨船與倉庫、終局計分
- 盤面提示與中文介面

終局條件與原版相同：勝利分籌碼用盡、殖民者無法補滿殖民船、或任一玩家城市蓋滿。

## 開始遊戲

需要 Node.js 18 或更新版本。

```bash
npm install
npm run dev
```

瀏覽器開啟終端機顯示的本機網址（預設 `http://localhost:5173`）。

| 指令 | 說明 |
| --- | --- |
| `npm run dev` | 開發伺服器 |
| `npm run build` | 型別檢查並打包 |
| `npm run preview` | 預覽正式打包 |
| `npm test` | 執行規則引擎測試 |
| `npm run test:watch` | 監看模式跑測試 |

## 怎麼玩

1. 選擇人數與 AI 風格後按「開局」。
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
  data/       建築定義
```

核心迴圈：

```
legal = getLegalActions(state)
action = await agent.chooseAction({ state, legalActions, playerId })
state = applyAction(state, action)   // 僅此處改遊戲狀態
```

目前 AI 是啟發式評分（均衡模式偶而選次佳手），不是 LLM。UI 不直接改金幣、貨物、殖民者等欄位。

## 可擴展性（已預留）

本階段不做 LLM 呼叫與線上多人，但介面已按之後擴充落地：

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

規則層不會重寫；會多一個「權威狀態 + 同步」層。

| | 現在（SPA） | 之後全端 |
| --- | --- | --- |
| 規則 | 瀏覽器裡的 `engine/` | **同一套**搬到伺服器（或前後端共用） |
| 狀態 | 記憶體 | DB / Redis + 房間 |
| 對手 | 本機 Heuristic（之後可 LLM） | 其他真人、伺服器跑 AI／LLM |
| 同步 | 不需要 | WebSocket / SSE |

建議演進：

1. **現在** — SPA + 本機引擎（已完成）。
2. **半步（可選）** — 把 `src/engine` 收成獨立 package，前後端一起 import。
3. **全端** — 伺服器持有權威 `GameState`；客戶端只送 Action、收整包或 patch state；AI／LLM 在伺服器跑。`LlmAgent` 與線上房間可疊在同一層。

全端會另外長出、但不推翻引擎的部分：帳號、房間碼、斷線重連、只能動自己的回合、延遲與樂觀更新。單人 vs AI 可繼續純前端。

## 技術

React 19、TypeScript、Vite、Vitest。本階段無後端。
