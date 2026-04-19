# Tone Presets Design

## Goal

為 `opencode-roast-tone-plugin` 增加可切換的 tone preset，讓使用者在保留現有 roast 開關語意的前提下，能從多種喜劇風格中選擇目前要注入的 tone。

這次設計聚焦在「固定 preset 選單」而不是自由編輯 prompt。目標是先把資料模型、UI 與 server 注入路徑整理成可擴充形狀，避免現在只有一條 `TONE` 常數的做法把後續需求都擠成布林值旁邊的小違建。

## Non-goals

- 不加入使用者自訂 tone 文案編輯器。
- 不加入依任務情境自動切換 tone 的邏輯。
- 不加入 tone 強度滑桿或多維參數調校。
- 不改變 plugin-level enable/disable 與 `roastEnabled` 既有語意。
- 不重新設計整個 TUI 互動框架，只在現有 settings dialog 上擴充必要能力。

## Requirements

1. 使用者可以在 plugin 保持啟用時，選擇目前生效的 tone preset。
2. 既有 `roastEnabled` 開關仍保留，關閉時不注入任何 tone。
3. 預設 tone 仍為目前的 `roast`，升級後舊使用者行為不應突然變人格。
4. 舊狀態檔沒有 tone 欄位時必須可安全讀取，且自動 fallback 到 `roast`。
5. server 端注入邏輯要根據目前 active tone 決定 prompt 內容，並維持避免重複注入。
6. TUI 設定面板要能同時顯示 tone 開關與目前選中的 preset。
7. 新增 preset 時，不應需要在 server 與 TUI 各自手刻一份分支判斷。

## First release preset pack

首發只提供 4 個核心 tone：

- `roast`: 目前的基準款，尖銳、節奏快、帶明顯 punchline。
- `dry`: 冷面、克制、少表演，吐槽像順手補刀。
- `deadpan`: 更平、更硬，笑點靠語氣反差，不靠情緒起伏。
- `mentor`: 嚴格但建設性，允許挖苦，但重點是把對方拉回正軌。

這 4 個 preset 的差異已足夠讓使用者感受到「人格切換」而不是「同一個人換 4 件外套」。首發不加 `chaotic` 或 `corporate-sarcastic`，避免先把菜單撐大，再發現每一道都像同一鍋湯。

## Considered approaches

### Approach A: Central tone registry

用單一模組維護所有 preset metadata 與 prompt 內容，例如：

- `id`
- `title`
- `description`
- `prompt`

state 只保存 `activeTone`，server 與 TUI 都從 registry 取資料。

優點：

- 單一資料來源，新增 tone 時只改一個地方。
- TUI 顯示文案與 server prompt 不容易漂移。
- 很適合目前 repo 規模，小而穩。

缺點：

- 所有 tone 定義集中在同一層，若未來 tone 數量大幅增加，檔案會變肥。

### Approach B: One file per tone

每個 preset 拆成獨立檔案，再由索引模組組裝選單。

優點：

- tone 文案彼此隔離。
- 若未來要做更長的 tone 說明，單檔維護較輕鬆。

缺點：

- 以目前只有 4 個 preset 的規模來看，拆檔偏早。
- 檔案數與 import 結構會先膨脹，像為了收納 4 支湯匙先買一整套工業櫥櫃。

### Approach C: External JSON or markdown presets

把 preset 定義放到外部資料檔，執行時讀取。

優點：

- 為未來自訂 tone 或社群共享格式預留空間。

缺點：

- 目前沒有使用者自訂需求，卻先引入解析、驗證與 fallback 負擔。
- 對這個 repo 現階段來說，複雜度明顯高於收益。

## Chosen approach

採用 **Approach A: central tone registry**。

這個方案最符合目前 repo 的大小與需求成熟度。它能先把 `TONE` 單常數升級為受控的 preset registry，又不會把功能做成過度工程化的展示櫃。未來如果 preset 真的長到十幾個，再考慮拆檔也不遲；在那之前，先把結構做對，比急著把檔案切碎重要得多。

## State model

### New state shape

```json
{
  "pluginEnabled": true,
  "roastEnabled": true,
  "activeTone": "roast"
}
```

### State semantics

- `pluginEnabled`: 由 OpenCode 內建 Plugins 面板控制。
- `roastEnabled`: 由 `Roast Tone settings` 控制是否注入 tone。
- `activeTone`: 由 `Roast Tone settings` 控制目前選中的 preset。

有效注入條件仍為：

```text
pluginEnabled && roastEnabled
```

`activeTone` 不參與 enabled 判斷，只決定要注入哪一種 tone。

### Backward compatibility

既有狀態可能是：

```json
{
  "pluginEnabled": true,
  "roastEnabled": false
}
```

或更舊的：

```json
{
  "enabled": true
}
```

升級後的讀取規則：

- 若 `activeTone` 是已知字串，直接使用。
- 若缺少 `activeTone`、型別錯誤、或值不在 registry 中，fallback 為 `"roast"`。
- 若是舊格式 `{ enabled }`，仍將其視為 `pluginEnabled` 與 `roastEnabled` 的共同值，`activeTone` 則 fallback 為 `"roast"`。
- 若 JSON 損壞、檔案不存在或讀取失敗，整體 fallback 為 `pluginEnabled=true`、`roastEnabled=true`、`activeTone="roast"`。

這樣可以讓舊版使用者升級後維持原本行為，不需要任何 migration script。

## Tone registry model

新增一個集中管理 preset 的模組，建議放在 `src/tone.ts` 或拆成 `src/tones.ts`。本次以最小改動為優先，保留在相近位置即可。

建議提供：

- `ToneId` union type
- `ToneDefinition` type
- `DEFAULT_TONE_ID`
- `TONE_REGISTRY`
- `getTonePrompt(toneId)`
- `isToneId(value)`

建議結構：

```ts
type ToneId = "roast" | "dry" | "deadpan" | "mentor";

type ToneDefinition = {
  id: ToneId;
  title: string;
  description: string;
  prompt: string;
};
```

`title` 與 `description` 給 TUI 用，`prompt` 給 server 用。這樣資料來源單一，避免 UI 顯示叫 `Dry`，server 實際卻注入另一段人格，整個系統像在對自己做身分詐欺。

## Architecture

### 1. State helpers (`src/enabled-state.ts`)

`src/enabled-state.ts` 從目前的雙布林 state 升級為「雙布林 + activeTone」。

職責：

- 解析狀態檔路徑
- 讀取完整 state
- 提供有效啟用狀態判斷
- 更新 `pluginEnabled`
- 更新 `roastEnabled`
- 更新 `activeTone`
- 對舊格式做向下相容

建議 API：

- `readEnabledState(context)`：回傳完整 state
- `readEffectiveEnabledState(context)`：回傳 `pluginEnabled && roastEnabled`
- `writePluginEnabledState(context, enabled)`：只更新 `pluginEnabled`
- `writeRoastEnabledState(context, enabled)`：只更新 `roastEnabled`
- `writeActiveToneState(context, toneId)`：只更新 `activeTone`

所有寫入路徑都應維持「讀現況 -> 合併單一欄位 -> 回寫完整 state」，避免某一路徑把其他欄位洗掉。

### 2. Settings dialog (`src/settings-dialog.tsx`)

目前 dialog 只有一個 toggle row，需要擴充成兩類設定：

1. `Tone enabled`
2. `Active tone`

這裡不建議把 preset 做成 4 個獨立 toggle。那會把單選需求做成互斥布林群，資料模型會變醜，使用者也會得到一個「你可以把 4 種人格都打開，但其實只該有一種生效」的荒謬 UI。

建議 UI 行為：

- 保留 `Tone enabled` toggle row
- 新增 `Active tone` row，footer 顯示目前選中的 tone title
- 使用者 select `Active tone` 時，再進入第二層 `DialogSelect` 子選單列出 4 個 preset
- 子選單顯示 `title` 與 `description`
- 選定後立即寫入 `activeTone`，返回主 settings 或直接更新目前畫面

這樣可以在不重做整套 TUI 框架的前提下，把單一 toggle 面板升級成足夠清楚的兩層設定流程。

### 3. TUI entrypoint (`src/tui.tsx`)

`src/tui.tsx` 既有的 plugin lifecycle 邏輯保留，但要把 settings state 擴充為：

```ts
type SettingsState = {
  roastEnabled: boolean;
  activeTone: ToneId;
};
```

職責：

- 載入時同步 `pluginEnabled=true`
- 開啟 `Roast Tone settings`
- 在主面板顯示當前 `roastEnabled` 與 `activeTone`
- 處理 tone toggle
- 處理 active tone 選擇
- dispose 時只同步 `pluginEnabled=false`，不改 `roastEnabled` 與 `activeTone`

### 4. Server transform (`src/server.ts`)

server 端改為：

1. 讀取完整 state
2. 若 `pluginEnabled && roastEnabled` 為 `false`，直接 return
3. 依 `activeTone` 從 registry 取得 prompt
4. 檢查第一個 user message 是否已注入相同 prompt
5. 若尚未注入，插入對應 tone part

重點是「重複注入判斷」應基於目前 active tone 的 prompt，而不是舊版固定 `TONE` 常數。否則你從 `roast` 切到 `dry` 之後，server 還拿昨天那條字串當門神，判斷就會開始胡言亂語。

## Data flow

### Case A: 舊使用者升級後第一次開啟

1. 讀到舊 state，沒有 `activeTone`
2. `readEnabledState` fallback `activeTone="roast"`
3. 若 `roastEnabled=true`，server 行為與升級前相同
4. 使用者尚未主動選 tone 前，不感知任何破壞性變更

### Case B: 使用者切換 preset

1. 使用者打開 `Roast Tone settings`
2. 選取 `Active tone`
3. 從子選單選擇例如 `deadpan`
4. `src/tui.tsx` 呼叫 `writeActiveToneState(context, "deadpan")`
5. 後續新請求由 server 注入 `deadpan` prompt

### Case C: 使用者關閉 tone 再重新打開

1. `roastEnabled=false` 時，server 不注入任何 tone
2. `activeTone` 仍保留目前選值，例如 `mentor`
3. 使用者重新把 `Tone enabled` 打開
4. server 恢復注入 `mentor`，而不是把人格失憶洗回 `roast`

## File impact

### Modify

- `src/tone.ts`
  - 從單一 `TONE` 常數升級為 preset registry
- `src/enabled-state.ts`
  - state 新增 `activeTone`
  - 補 tone fallback 與單欄位寫入 helper
- `src/settings-dialog.tsx`
  - 加入 preset row 與選單互動
- `src/tui.tsx`
  - settings state 改讀寫 `activeTone`
- `src/server.ts`
  - 依 active tone 取 prompt
- `README.md`
  - 補充 tone preset 功能與操作方式
- `test/enabled-state.test.ts`
  - 補 tone 欄位相容與 fallback 案例
- `test/settings-dialog.test.tsx`
  - 補主面板與 tone 選單互動案例
- `test/tui.test.ts`
  - 補 tone 寫入流程與 UI state 更新案例
- `test/server.test.ts`
  - 補不同 preset 注入與重複注入判斷案例

## Error handling

- state 檔不存在：fallback 到預設 state
- JSON 損壞：fallback 到預設 state
- `activeTone` 非字串或未知值：fallback 到 `"roast"`
- tone 寫入失敗：維持 best-effort，不讓 runtime 因設定寫檔失敗直接中斷

fallback 到 `roast` 是刻意選擇。因為它是目前既有行為，不是神秘彩蛋。升級後若系統讀不懂 tone 值，回到原本人格最合理，不要讓 plugin 在錯誤時突然變成某個新角色，像實驗室逃出來的 prompt 突變體。

## Testing strategy

### Tone registry tests

新增或調整案例：

- registry 包含 4 個首發 preset
- `isToneId` 對未知值回傳 `false`
- `getTonePrompt` 對每個 tone 回傳穩定 prompt

### Enabled state tests

新增或調整案例：

- 新格式 state 讀取成功
- 缺少 `activeTone` 時 fallback 到 `roast`
- `activeTone` 非法值時 fallback 到 `roast`
- 舊格式 `{ enabled }` 仍可讀取，且 tone fallback `roast`
- `writeActiveToneState` 不覆蓋其他欄位

### Settings dialog / TUI tests

新增或調整案例：

- 主 settings 畫面顯示 `Tone enabled` 與 `Active tone`
- `Active tone` footer 反映目前 tone title
- 進入 tone 子選單後可選取 preset
- 儲存 `activeTone` 成功後 UI state 立即更新
- plugin dispose 時不覆寫 `activeTone`

### Server tests

新增或調整案例：

- `roastEnabled=true` 且 `activeTone="roast"` 時注入 roast prompt
- 切到其他 preset 時注入對應 prompt
- `roastEnabled=false` 時無論 `activeTone` 為何都不注入
- 已存在相同 prompt 時不重複注入
- 舊 state 與缺少 `activeTone` 的 state 都維持既有 roast 行為

## Verification

實作完成後至少需執行：

- `npm test`
- `npm run build`

若 README 有更新，也應同步檢查說明是否與 TUI 實際入口一致，避免文件寫得像未來版，程式卻還活在昨天。
