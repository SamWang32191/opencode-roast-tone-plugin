# OpenCode Roast Tone Plugin TUI Toggle Design

## Goal

讓 `opencode-roast-tone-plugin` 可以透過 OpenCode 內建的 **Plugin Manager** 在 TUI 中啟用或停用，且這個開關要真正控制 roast tone 的 server 注入行為，並在重新開啟 OpenCode 後持續生效。

## Current State

- 此套件目前只有 `./server` entrypoint。
- 核心行為是透過 `experimental.chat.messages.transform` 在第一個 `user` message 前插入 roast tone。
- 套件目前沒有 `./tui` entrypoint。
- 套件目前沒有任何啟用/停用狀態、設定 UI、或跨 runtime 的共享狀態。
- 目前若要停用，只能移除 plugin 設定，做法直接，但像拔插頭一樣粗暴。

## User Requirements

- 使用 **OpenCode 內建 Plugin Manager** 作為啟用/停用介面。
- 停用後要 **真正停止 roast tone 注入**，不能只是 UI 顯示 disabled。
- 啟用/停用狀態要 **持久化**，重開 OpenCode 後仍然生效。
- 以 `oc-plugin-rainbow` 的官方 TUI plugin package shape 作為參考，但不盲目照抄其 TUI-only 模式。

## Constraints and Observations

- OpenCode 允許同一個 package 同時提供 `./server` 與 `./tui`，但兩者必須是 **不同 entrypoint**。
- OpenCode 內建 Plugin Manager 直接控制的是 **TUI plugin runtime enabled state**，不是 server plugin runtime。
- TUI plugin 可以使用 `api.plugins.activate/deactivate/list()` 與 `api.lifecycle.onDispose()`。
- server plugin runtime 沒有直接暴露 OpenCode 的 global config/state path。
- OpenCode 沒有提供外部 plugin 可直接安全改寫 server plugin options 的公開 API。
- `oc-plugin-rainbow` 示範了好的 TUI plugin package shape、預設 config、KV persistence 與 command wiring，但 **沒有** 解決 server 與 TUI 共享 enabled state 的問題。

## Chosen Approach

採用 **雙 entrypoint package + 套件自管共享 enabled state** 的方案。

### Why this approach

- 符合 OpenCode 現有 plugin package 的 target model：`./server` 與 `./tui` 分開。
- 可直接整合 OpenCode 內建 Plugin Manager，不需要重做一套 toggle UI。
- 不需要修改 OpenCode upstream。
- 可讓 TUI plugin 的啟停結果被 server plugin 讀取，達成真正的功能級啟用/停用。
- 比起嘗試由 TUI plugin 改寫 host config，更穩定、邊界更清楚。

## Package Shape

### Entrypoints

- `./server`
  - 保留現有 roast tone 注入邏輯。
  - 在注入前先檢查共享 enabled state。
- `./tui`
  - 作為 package 的 TUI target，讓 plugin 出現在 OpenCode Plugin Manager 中。
  - 不建立專屬 settings dialog，不加額外 slash command。
  - 只負責把 Plugin Manager 的啟停結果同步到共享 enabled state。
  - 採最小 non-visual entrypoint，不需要 JSX 畫面元件。

### Package metadata

`package.json` 需新增：

- `exports["./tui"]`
- TUI 所需的 peer/dev dependencies

此版本 **不** 將 `plugin options.enabled` 當作 live toggle 的來源。

### Why not use `options.enabled`

若同時存在：

1. Plugin Manager toggle
2. plugin options 中的 `enabled`

就會形成兩個不同來源控制同一個行為，容易造成 UI 顯示、runtime state、server 注入結果三者不一致。

本設計選擇：

- 預設狀態為啟用
- 實際 live toggle 只認共享 enabled state
- Plugin Manager 是唯一使用者可見的啟停入口

## Shared Enabled State Design

### Source of truth

套件新增一個共享 helper，專門負責讀寫：

- `enabled: true | false`

server 與 TUI runtime 都只能透過這個 helper 存取狀態。

### State file location strategy

狀態檔採 plugin 專屬 namespaced 路徑，優先順序如下：

1. `OPENCODE_CONFIG_DIR`
2. 目前 workspace 最近的 `.opencode/`
3. plugin 自己的 global XDG config path

一旦選定 root，實際檔案路徑固定為：

`<root>/plugin-data/opencode-roast-tone-plugin/state.json`

理由：

- `OPENCODE_CONFIG_DIR` 是 OpenCode 已支援的明確 config root。
- local `.opencode` 對外部 plugin 來說是最容易由 `directory/worktree` 與 `api.state.path.*` 推導的共享落點。
- server plugin 無法直接讀 OpenCode internal 的 `Global.Path.config/state`，因此 global fallback 不能依賴 host 私有 API，必須由 plugin 自己推導。
- `plugin-data/` 這種 namespaced 子路徑可避免與 OpenCode 既有的 `plugins/`、`commands/`、`agents/` 等慣例目錄混淆。

### State file shape

最小 JSON 結構：

```json
{
  "enabled": false
}
```

本版本不加入額外 metadata，避免為單一布林狀態引入不必要複雜度。

## Runtime Data Flow

### TUI startup / activation

當 plugin 在 Plugin Manager 中為 enabled 且成功載入時：

1. `./tui` entry 初始化。
2. 共享 helper 將狀態寫成 `enabled: true`。
3. server plugin 後續每次 transform 讀到此狀態時，會繼續注入 roast tone。

### TUI deactivation from Plugin Manager

當使用者在 Plugin Manager 中停用此 plugin：

1. OpenCode TUI runtime 將此 TUI plugin 標記為 disabled。
2. runtime dispose 該 plugin scope。
3. plugin 在 `api.lifecycle.onDispose()` 中檢查自己是否是被「真正停用」而非單純 app 結束。
4. 若確認為停用，則共享 helper 將狀態寫成 `enabled: false`。
5. server plugin 後續每次 transform 讀到此狀態時，直接跳過注入。

### App shutdown / restart

- 一般 app 關閉造成的 dispose **不應** 把狀態改成 `false`。
- 重新啟動後，若 TUI plugin 仍為 enabled，初始化流程會再次同步為 `true`。
- 若 TUI plugin 仍為 disabled，server plugin 會持續從共享狀態檔讀到 `false`，維持停用。

## Server Behavior Changes

目前的 `experimental.chat.messages.transform` 流程保持不變，只新增最前面的 guard：

1. **每次 transform 都重新讀取**共享 enabled state。
2. 若為 `false`，直接 return。
3. 否則沿用現有邏輯：
   - 找第一個 `user` message
   - 判斷是否已注入相同 tone
   - 需要時插入 tone part

選擇每次都讀的理由：

- 狀態資料極小，IO 成本低。
- 可確保使用者剛在 TUI 內切換後，下一次訊息就反映新狀態。
- 避免為了快取而引入額外同步機制，讓小問題長成自己的副專案。

此變更只影響 plugin 是否執行，不改 roast tone 文案內容與注入規則。

## File Layout Changes

預計新增或調整：

- `src/server.ts`
  - 注入前讀取共享 enabled state
- `src/tui.ts`
  - 新的 TUI entrypoint
  - 只處理 Plugin Manager 啟停同步
- `src/enabled-state.ts` 或同等命名的共享 helper
  - 路徑解析
  - 讀取狀態
  - 寫入狀態
- `package.json`
  - 新增 `./tui` export 與對應依賴
- `README.md`
  - 補上 TUI Plugin Manager 啟停說明
- `test/server.test.ts`
  - 擴充 server 行為測試
- 視需要新增 helper / TUI 測試檔

## Error Handling

共享 enabled state 採 **safe fallback**：

- 狀態檔不存在 → 視為啟用
- 狀態檔 JSON 損壞 → 視為啟用
- `enabled` 欄位不是 boolean → 視為啟用
- 寫入失敗 → 不中斷 TUI/plugin runtime

原因：

- 這個 plugin 的預設價值是「存在就注入 roast tone」。
- 狀態同步失敗時，回到預設啟用比整個 plugin 不可預期地失效更容易理解。

## Testing Strategy

### Server tests

擴充現有測試，至少覆蓋：

1. 無狀態檔時仍會注入 tone
2. `enabled: false` 時不注入 tone
3. `enabled: true` 時照常注入 tone
4. 狀態檔損壞時 fallback 為注入 tone

### Shared helper tests

至少覆蓋：

1. 路徑解析優先序
2. 讀取缺失/損壞檔案時的 fallback
3. 寫入 `enabled` 狀態的結果

### TUI tests

以最小 mock 驗證：

1. 初始化時會同步 `enabled: true`
2. 因 plugin disable 而 dispose 時會同步 `enabled: false`
3. 一般 dispose 不會誤寫 `false`

## Documentation Updates

README 需補充：

- 套件現在同時包含 server 與 TUI target
- 安裝後會出現在 OpenCode 的 Plugin Manager
- 可以直接在 TUI 中啟用/停用 roast tone
- 啟停結果會持久化，並影響實際 tone 注入行為
- 本版本不提供額外 settings dialog 或 tone customization

## Success Criteria

完成後應達成：

1. 套件可同時被 OpenCode 當作 server plugin 與 TUI plugin 載入
2. 此 plugin 會出現在 OpenCode 內建 Plugin Manager 中
3. 在 Plugin Manager 中停用後，新訊息不再注入 roast tone
4. 在 Plugin Manager 中重新啟用後，新訊息恢復注入 roast tone
5. 啟用/停用狀態在重開 OpenCode 後仍維持
6. 現有 roast tone 注入邏輯在 enabled 狀態下維持原樣

## Out of Scope

- 修改 OpenCode upstream 以增加官方 server/tui shared toggle API
- 新增專屬 settings dialog
- 新增 slash command
- 讓使用者自訂 tone 文案
- 加入 theme、動畫或其他額外 TUI 裝飾
