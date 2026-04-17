# Roast Tone TUI Settings Design

## Goal

為 `opencode-roast-tone-plugin` 新增一個可從 OpenCode TUI 指令面板開啟的 `Roast Tone settings` 面板，讓使用者能在不卸載 plugin 的前提下開啟或關閉 roast tone 注入；同時保留 OpenCode 內建 Plugins 面板對整個 plugin 啟用/停用的控制能力。

## Non-goals

- 不新增多個 tone 參數或進階調校項目。
- 不複製 `oc-plugin-rainbow` 的完整 TSX / Solid 結構。
- 不改變目前狀態檔的儲存根目錄解析邏輯（仍優先 workspace `.opencode`，否則退回使用者 config）。

## Requirements

1. 使用者可從 OpenCode TUI 的 command palette 開啟 `Roast Tone settings`。
2. 設定面板僅提供一個 `Enabled` 開關，控制 roast tone 是否注入。
3. OpenCode 內建 Plugins 面板仍可啟用或停用整個 plugin。
4. 內建 Plugins 面板與自訂 settings 面板需同時生效，且互不覆蓋對方的語意。
5. server 端僅在「plugin 啟用」與「roast tone 啟用」都為 `true` 時注入 tone。
6. 既有單欄位狀態檔需可持續讀取，不因升級失效。
7. 狀態讀寫錯誤、缺檔或格式損壞時，保持目前寬鬆 fallback 行為：預設視為啟用。

## Chosen approach

採用雙狀態檔案設計：

- `pluginEnabled`: 代表 OpenCode 內建 Plugins 面板對本 plugin 的持久化啟用狀態。
- `roastEnabled`: 代表 `Roast Tone settings` 對 roast tone 功能的持久化開關。

server 端計算有效啟用狀態時，使用 `pluginEnabled && roastEnabled`。

這個設計可以避免目前 `src/tui.ts` 在 plugin 載入時直接把單一 `enabled` 寫回 `true` 的覆寫問題；否則使用者剛在自訂 settings 裡關掉 roast tone，下一次 TUI 啟動又被洗回去，整個設定就像被背景程序霸凌。

## State model

### New state shape

```json
{
  "pluginEnabled": true,
  "roastEnabled": true
}
```

### Backward compatibility

既有狀態檔格式為：

```json
{
  "enabled": true
}
```

升級後的讀取規則：

- 若檔案是新格式，直接讀取 `pluginEnabled` 與 `roastEnabled`。
- 若檔案是舊格式，將 `enabled` 同時視為 `pluginEnabled` 與 `roastEnabled` 的值。
- 若欄位缺失或型別錯誤，僅該欄 fallback 為 `true`。
- 若 JSON 損壞、檔案不存在或讀取失敗，兩者都 fallback 為 `true`。

這樣可以讓舊版本留下的狀態檔繼續生效，不需要遷移腳本。

## Architecture

### 1. State helpers (`src/enabled-state.ts`)

`src/enabled-state.ts` 從「單一布林值 helper」升級成「雙狀態讀寫 helper」。

職責：

- 解析狀態檔路徑（沿用現有 root resolution）
- 讀取完整 state
- 提供有效啟用狀態判斷
- 分別更新 `pluginEnabled` 與 `roastEnabled`
- 維持舊格式向下相容

建議提供的 API：

- `readEnabledState(context)`：回傳完整 state，供 TUI 與 server 共用
- `readEffectiveEnabledState(context)`：回傳 `pluginEnabled && roastEnabled`
- `writePluginEnabledState(context, enabled)`：只更新 `pluginEnabled`
- `writeRoastEnabledState(context, enabled)`：只更新 `roastEnabled`

寫入時應採取「讀現有 state → 合併單一欄位 → 回寫完整 state」流程，避免某一條寫入路徑把另一個欄位吃掉。

### 2. TUI entrypoint (`src/tui.ts`)

`src/tui.ts` 負責兩件事：

1. 同步 Plugins 面板狀態到 `pluginEnabled`
2. 提供 `Roast Tone settings` 指令面板與單一開關

啟動行為：

- plugin 載入時，寫入 `pluginEnabled=true`
- 不覆寫 `roastEnabled`

dispose 行為：

- 檢查 `api.plugins.list()` 中本 plugin 的 `enabled`
- 只有在 plugin 被使用者從 Plugins 面板停用時，才寫入 `pluginEnabled=false`
- 若只是正常關閉畫面或 runtime dispose，但 plugin 仍維持 enabled，不應寫回 `false`

設定面板行為：

- 在 command palette 註冊 `Roast Tone settings`
- 開啟後以 `api.ui.DialogSelect` 顯示單一列 `Enabled`
- 顯示目前狀態（例如 `ON` / `OFF`）
- 使用者 select 後切換 `roastEnabled`
- 切換後更新狀態檔，重新開啟或保留同一個 dialog 皆可，但應立即反映最新狀態

這次不新增 TSX / Solid UI 元件檔，原因如下：

- 目前需求只有單一開關
- `api.ui.DialogSelect` 已足夠承載這種最小面板
- 避免為一顆開關引入整套結構與相依，降低實作與維護成本

### 3. Server transform (`src/server.ts`)

`src/server.ts` 保留現有 message transform 流程，但改為讀取「有效啟用狀態」而不是舊的單一 `enabled` 值。

流程：

1. 每次 transform 時重新讀檔
2. 若 `pluginEnabled && roastEnabled` 為 `false`，直接 return
3. 若為 `true`，維持原本 tone 注入行為
4. 已經注入過 tone 時仍需避免重複注入

保留每次 transform 重新讀檔的設計，這樣使用者在 TUI 設定面板切換後，之後的新請求就能立即套用，不需要重啟 runtime。

## Data flow

### Case A: 從 Plugins 面板停用 plugin

1. 使用者在 OpenCode 內建 Plugins 面板停用 `opencode-roast-tone-plugin`
2. TUI plugin dispose
3. `src/tui.ts` 偵測本 plugin 已是 `enabled=false`
4. 寫入 `pluginEnabled=false`，保留 `roastEnabled` 原值
5. server 端後續讀到 `pluginEnabled=false`，不再注入 tone

### Case B: 從 Roast Tone settings 關掉 roast tone

1. 使用者打開 `Roast Tone settings`
2. 切換 `Enabled` 為 `OFF`
3. `src/tui.ts` 寫入 `roastEnabled=false`，保留 `pluginEnabled` 原值
4. server 端後續讀到有效狀態為 `false`，不再注入 tone
5. plugin 本身仍維持安裝且可再次打開設定面板

### Case C: 從 Roast Tone settings 重新打開 roast tone

1. 使用者在設定面板切回 `Enabled=ON`
2. `src/tui.ts` 寫入 `roastEnabled=true`
3. 若 `pluginEnabled` 仍為 `true`，server 端後續新請求恢復注入 tone

## File impact

### Modify

- `src/enabled-state.ts`
  - 擴充狀態模型
  - 補向下相容解析
  - 補欄位級別寫入 helper
- `src/tui.ts`
  - 註冊 command palette 指令
  - 顯示單列 settings dialog
  - 分離 `pluginEnabled` 與 `roastEnabled` 的寫入邏輯
- `src/server.ts`
  - 改讀有效啟用狀態
- `test/enabled-state.test.ts`
  - 補新格式與向下相容案例
- `test/tui.test.ts`
  - 補 command 註冊與 settings 切換案例
  - 驗證 dispose 只更新 `pluginEnabled`
- `test/server.test.ts`
  - 補雙狀態組合案例

### Optional docs update

- `README.md`
  - 說明 `Roast Tone settings` 指令入口
  - 說明自訂開關與 Plugins 面板的差異

## Error handling

- state 檔不存在：視為雙 `true`
- state JSON 壞掉：視為雙 `true`
- 其中某欄不是 boolean：該欄 fallback `true`
- 寫入失敗：維持 best-effort，不讓 runtime 因為設定寫檔失敗直接炸裂

這維持目前產品決策：設定檔壞掉時寧可繼續有 roast tone，也不要因為一份壞 JSON 讓功能整個沉海。

## Testing strategy

### Enabled state tests

新增或調整案例：

- 新格式 state 讀取成功
- 舊格式 `{ enabled }` 仍可讀取
- 缺少 `pluginEnabled` 或 `roastEnabled` 時個別 fallback
- 壞 JSON / 缺檔 / 非 boolean 欄位 fallback
- 單欄位寫入 helper 不會覆蓋另一欄

### TUI tests

新增或調整案例：

- plugin 載入時只把 `pluginEnabled` 設為 `true`
- command palette 有 `Roast Tone settings`
- 選取設定項後只切換 `roastEnabled`
- plugin disable dispose 時只把 `pluginEnabled` 設為 `false`
- plugin 正常 dispose 且仍 enabled 時不應誤寫 `pluginEnabled=false`

### Server tests

新增或調整案例：

- `pluginEnabled=true` 且 `roastEnabled=true` 時會注入
- 任一為 `false` 時不注入
- 舊格式 state 仍能維持原本行為
- 每次 transform 仍重新讀取狀態，切換後可立即生效

## Verification

實作完成後至少需執行：

- `npm test`
- `npm run build`

若 README 有更新，也應一併檢查描述與實際入口一致，避免文件跟程式互相拆台。
