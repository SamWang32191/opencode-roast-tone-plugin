# OpenCode 1.15.0 TUI Discovery Packaging Design

## Goal

讓 `opencode-roast-tone-plugin` 在以 npm 發版包安裝、且宿主為 OpenCode `1.15.0` 時，`./tui` target 能穩定被發現並載入，恢復 plugin 在 TUI plugin 選單中的可見性。

## Confirmed context

- 使用者回報的是「`./tui` 根本沒有出現在 plugin 選單」，不是設定對話框打開後跑版或空白。
- 問題發生在 **npm 發版安裝**，不是目前 repo 的本地路徑安裝流程。
- 使用者記憶中的最後正常區間大約是 OpenCode `1.14.x`。
- 目前 repo 的 TUI 主要由 `src/tui.tsx` 與 `src/settings-dialog.tsx` 組成，但這些檔案處理的是載入後的 UI 與互動，不是 target discovery 本身。
- 目前 repo 若在未先 build 的 workspace 上執行 `npm pack --dry-run`，tarball 只會包含 `LICENSE`、`README.md`、`package.json`，不會包含 `dist/`。這不代表已發布版本必然缺檔，但足以說明「發布包形狀」是高風險點，必須明確驗證。

## Problem statement

這次要修的不是「settings UI 長得對不對」，而是：

1. npm 發版包是否真的帶有 OpenCode 載入 `./tui` 所需的產物
2. 發版包內的 `package.json` 是否以 OpenCode `1.15.x` 可辨識的方式宣告 `./tui`
3. release 流程是否能在 publish 之前阻擋缺檔或錯誤 export 的 tarball

只要上述任一環節失守，宿主就可能在 discovery 階段直接忽略 `./tui`，使用者看到的就會是「TUI plugin 沒出現」，連跑版的機會都沒有。

## Non-goals

- 不在第一階段重寫 `SettingsDialog` 或 preset 互動。
- 不先假設 `@opentui/solid` 或 keyboard handling 是根因。
- 不預設加入大範圍 runtime 重構，除非產物驗證通過後仍能穩定重現於 OpenCode `1.15.0`。

## Chosen approach

採用 **發布包契約硬化**。

核心原則：

- 把 `./tui` 的存在與可載入性視為正式發版契約，而不是「source tree 裡有 `src/tui.tsx` 就算完成」。
- 第一階段優先保住 npm tarball 與 export 形狀，不先調整使用者可見功能。
- 只有在產物驗證全綠、但 OpenCode `1.15.0` 仍看不到 `./tui` 時，才進入第二階段的 host-compat 調整。

## Architecture

### 1. Keep runtime behavior unchanged in phase 1

`src/tui.tsx`、`src/settings-dialog.tsx`、`src/tone.ts`、`src/enabled-state.ts` 的現有行為在第一階段不主動變更。

原因：

- 目前症狀發生在 discovery / load 前段
- 先動 UI 只會把故障面擴大，卻無法直接回答發版包是否有效

### 2. Add a package-level smoke verification step

新增一個 package smoke 驗證腳本，專門檢查「發版產物」而不是原始碼。

驗證內容至少包含：

1. build 後必要產物存在：
   - `dist/server.js`
   - `dist/tui.js`
   - `dist/settings-dialog.js`
   - `dist/enabled-state.js`
   - `dist/tone.js`
2. `npm pack --dry-run --json` 的結果包含上述必要檔案
3. tarball 內 `package.json` 的 `exports["./tui"]` 指向一個實際存在的檔案
4. tarball 內 `package.json` 的 `exports["./server"]` 也維持有效，避免修 TUI 時順手把 server target 弄壞

這個 smoke 驗證的目的不是重跑 OpenCode 本體，而是把「包本身已經不完整」這種低階錯誤先擋在 release 之前。

### 3. Treat `package.json` target declarations as compatibility surface

`package.json` 目前已宣告：

```json
{
  "exports": {
    "./server": "./dist/server.js",
    "./tui": "./dist/tui.js"
  }
}
```

第一階段不會盲目改這個 shape，但會把它納入驗證契約。

若 smoke 驗證或後續 reproduction 顯示 OpenCode `1.15.x` 對 npm plugin target 的辨識規則更嚴格，才在第二階段考慮：

- 調整 export 宣告形狀
- 補更保守的 manifest / entry 宣告
- 或拆出更薄的 `./tui` loader 以降低 eager load 失敗面

### 4. Gate release on package validity

release workflow 在 `npm publish` 前，除了現有的 test/build，還必須再通過 package smoke。

新流程預期為：

1. `npm ci`
2. `npm test`
3. `npm run build`
4. `npm run package:smoke`
5. version bump / tag
6. `npm publish`

只要 tarball 缺必要檔案，或 `./tui` export 指向不存在檔案，publish 直接 fail。

## File impact

### Add

- `scripts/package-smoke.mjs`
  - 驗證 build 產物
  - 驗證 `npm pack --dry-run --json`
  - 驗證 tarball 內 `package.json` export 與檔案對應

### Modify

- `package.json`
  - 新增 `package:smoke` script
  - 視實際驗證結果決定是否調整 export 宣告
- `.github/workflows/release.yml`
  - 在 publish 前加入 `npm run package:smoke`
- `README.md`
  - 補一小段維護說明，講清楚 `./tui` 是發版契約的一部分

### Explicitly not in phase 1

- `src/settings-dialog.tsx`
- `src/tui.tsx`
- `src/server.ts`

除非 smoke 驗證與後續實機重現證明 host 端還有第二層相容問題，否則這些 runtime 檔案不列入第一階段修改範圍。

## Data flow

### Release-time flow

1. 原始碼 build 出 `dist/`
2. smoke script 檢查必要輸出檔是否存在
3. smoke script 執行 `npm pack --dry-run --json`
4. smoke script 檢查 tarball 檔案清單與 `exports`
5. 全部通過後才允許 publish

### Failure modes caught by the new gate

- `dist/` 沒有生成或不完整
- `files` 白名單把 `dist/` 漏掉
- `exports["./tui"]` 指向不存在檔案
- 只修 server target，TUI target 悄悄壞掉

## Verification strategy

至少要有以下驗證：

- `npm run build`
- `npm run package:smoke`

若需要把 smoke 驗證納入測試總入口，可以另外決定是否讓 `npm test` 聚合它；但第一階段至少要保證 release workflow 會跑它。

## Risk handling

### If package smoke fails

表示根因就在發布包本身，直接修正 build / files / export 契約即可，不需要先動 runtime UI。

### If package smoke passes but OpenCode 1.15.0 still cannot discover `./tui`

這代表問題更可能在 host compatibility，而不是 tarball 缺檔。

第二階段才會啟動，方向包含：

- 補更保守的 export / manifest 形狀
- 把 `src/tui.tsx` 拆成極簡 loader，將較重的 UI 延後載入
- 針對 OpenCode `1.15.x` 的 npm plugin discovery 規則補一個更接近宿主行為的 fixture 驗證

這一階段不納入本 spec 的第一輪實作，避免在還沒證明 tarball 有效之前就做過度重構。

## Success criteria

完成後應能明確保證：

1. 發版流程不會再產出缺少 `dist/tui.js` 的 npm tarball
2. repo 中有可重跑的檢查，能直接驗證 `./tui` export 是否對應到已打包檔案
3. release workflow 會在 publish 前阻擋破損的 TUI target
4. 若 `opencode 1.15.0` 仍看不到 `./tui`，我們能清楚知道問題已不在 tarball 完整性，而可直接進入第二階段相容調整
