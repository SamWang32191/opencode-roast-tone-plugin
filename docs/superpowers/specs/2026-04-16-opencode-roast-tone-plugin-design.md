# OpenCode Roast Tone Plugin npm Packaging Design

## Goal

把目前只能手動複製到 `.opencode/plugins/` 的單檔 `roast.ts`，整理成可發佈到 npm 的 OpenCode plugin package，讓使用者能以 `opencode-roast-tone-plugin@latest` 作為 plugin spec 直接安裝與載入。

## Current State

- 目前 repo 只有 `roast.ts` 一個檔案。
- 沒有 `package.json`、README、測試、build 設定、發版設定。
- 目前安裝方式是手動複製檔案到 `~/.config/opencode/plugins/`。
- OpenCode 已支援 npm plugin spec，且會把裸套件名解析成 `name@latest`。

## Chosen Approach

採用「正式 npm package + 編譯後 JS entrypoint」方案。

### Why this approach

- 符合 OpenCode 現有 plugin loader 對 npm package 的期待。
- 比直接發佈 `.ts` 檔穩定，避免執行端對 TypeScript 載入方式有隱性依賴。
- 比包一層很薄的 wrapper 更容易維護、測試與後續版控。

## Package Shape

此 package 定位為 **server plugin only**。

### Source files

- `src/server.ts`
  - plugin 的唯一 server entrypoint。
  - 匯出目前的 OpenCode plugin factory。
- `src/tone.ts`
  - 單獨存放 tone prompt 常數，避免 plugin 實作與內容字串耦合在一起。
- `test/server.test.ts`
  - 驗證注入邏輯與 idempotent 行為。

### Package metadata

`package.json` 需明確提供：

- `name: "opencode-roast-tone-plugin"`
- `version`
- `license: "MIT"`
- `type: "module"`
- `main: "./dist/server.js"`
- `exports["./server"] = "./dist/server.js"`
- `files = ["dist", "README.md", "LICENSE"]`
- `engines.opencode = ">=1.4.6 <2"`

### Non-goals

- 不提供 `./tui` entry。
- 不在第一版提供 plugin options 或可配置 tone。
- 不在第一版加入 theme、CLI、額外設定 UI。
- 不在第一版做自動 release pipeline。

## Build Strategy

使用 **TypeScript compiler (`tsc`)** 進行最小編譯流程：

- source 放在 `src/`
- build 輸出到 `dist/`
- npm 發佈內容只包含編譯後 JS 與必要文件

選擇 `tsc` 的原因：

- 這個 plugin 很小，不需要 bundling
- 能減少額外 build 工具依賴
- package 結構與輸出結果更直白

## Runtime Behavior

發佈後的 plugin 行為維持與現有 `roast.ts` 相同：

- 在 `experimental.chat.messages.transform` 中尋找第一個 `user` message
- 若不存在 user message 或 parts 為空，直接跳過
- 若已經存在相同 tone 文字，跳過注入
- 否則在第一個 part 前插入 tone text part

此次工作只改變 **封裝與發佈方式**，不改變 tone 文案與執行邏輯。

## Installation and Documentation Model

README 的主安裝方式改成 **CLI 安裝**，並使用 unscoped package name：

```bash
opencode plugin opencode-roast-tone-plugin@latest
```

README 需額外補充：

- 這是 **local install** 的主範例
- 若要全域安裝，可使用 `opencode plugin opencode-roast-tone-plugin@latest --global`
- plugin config 陣列是替代說明，不是主路徑

README 的替代安裝方式可再補 npm plugin spec 設定：

```json
{
  "plugin": ["opencode-roast-tone-plugin@latest"]
}
```

README 另外保留本地開發用法：

- 以本機路徑或 `file://` spec 載入尚未發版的 plugin package 目錄
- 說明這是開發/驗證用途，不是正式安裝路徑

README 應明確包含：

- 套件用途
- 安裝方式（主推 CLI，補充 config）
- 本地開發方式（path spec）
- build/test 指令（以 `npm` 為主）
- 發版步驟（手動 `npm publish`）

## Testing Strategy

加入最小但完整的自動化測試，覆蓋核心行為：

1. 會把 tone 插入第一個 user message 的最前面
2. 若 tone 已存在，不會重複插入
3. 若沒有 user message，安全跳過
4. 若 user message 沒有 parts，安全跳過

測試框架使用 `vitest`。

## Licensing

此 package 補上 `LICENSE`，採用 **MIT**。

理由：

- npm package 應明確宣告授權
- 對小型 utility/plugin 來說，MIT 最直接、阻力最低

## Error Handling

此 plugin 維持目前的容錯風格：

- 對缺少訊息、缺少 parts、重複注入等情況直接 return
- 不額外增加 logging、throw、或外部依賴

理由是此 plugin 應該保持輕量，且不應因為 roast tone 沒插進去就把整段流程掀桌。

## Release Model

第一版採用手動發版：

1. 更新版本號
2. 執行 `npm run build`
3. 執行 `npm test`
4. `npm publish`

不在本次範圍內加入 GitHub Actions 或自動 release。

## Success Criteria

完成後應達成：

1. repo 成為合法 npm package
2. npm package 產物可被 OpenCode 當成 server plugin 載入
3. README 主安裝方式改為 npm plugin spec
4. 核心注入行為有自動化測試保護
5. 本地仍可透過 path spec 載入未發版版本進行驗證

## Out of Scope

- 修改 OpenCode 本體
- 增加 TUI plugin 功能
- 增加主題、設定畫面、遙測或分析
- 建立 CI/CD 自動發版流程
