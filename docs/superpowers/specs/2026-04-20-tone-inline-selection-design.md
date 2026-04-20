# Tone Inline Selection Design

## Goal

把 `Roast Tone settings` 裡的 `Active tone` 從「先選這列，再進第二層 tone picker」改成「在第一層直接左右切換 preset」。

這次只處理互動手感，不重做 tone 資料模型，也不擴充 preset 集合。目標很單純：少一層、多一點順手，別把選 preset 搞得像在跑迷你地城。

## Non-goals

- 不改變 `pluginEnabled`、`roastEnabled`、`activeTone` 的 state shape 或語意。
- 不新增或刪除任何 tone preset。
- 不重做整個 dialog 元件或 command palette 流程。
- 不保留第二層 tone picker 當備援入口。

## Requirements

1. 使用者在第一層 settings dialog 選到 `Active tone` 時，可用 `left/right` 直接切換 preset。
2. `Active tone` 的切換要沿用既有 `selectTone()` 寫入流程，變更後立即保存。
3. `Enter` 在 `Active tone` 這列不再開第二層選單。
4. `Tone enabled` 既有 toggle 行為不變。
5. dialog 底部提示文案要反映新的鍵盤行為，不能再暗示有第二層 picker。

## Considered approaches

### Approach A: Inline cycle in the existing dialog

保留兩列 settings row，但移除 `tone-picker` mode，讓 `Active tone` 在同一層直接處理 `left/right`。

優點：

- 最貼近使用者需求。
- 改動集中在 dialog 邏輯，`tui.tsx` 的持久化流程幾乎不用變。
- 不需要維持兩套畫面狀態與返回邏輯。

缺點：

- 若未來 tone 數量暴增，左右切換會比完整列表慢。

### Approach B: Inline cycle but keep Enter as a fallback list

讓 `left/right` 可直接切換，但 `Enter` 仍可進第二層 tone picker。

優點：

- 對大量 preset 較有彈性。

缺點：

- 和目前需求衝突，使用者明講不要再進下一層。
- UI 語意變成雙軌，學習成本反而更高。

### Approach C: Replace the row with a custom segmented control

在第一層直接把 preset 做成內嵌控制元件，而不是沿用 `DialogSelect` row。

優點：

- 視覺上最直接。

缺點：

- 改動面過大，等於為了少按一次鍵先把整個 UI 結構翻桌。

## Chosen approach

採用 **Approach A: Inline cycle in the existing dialog**。

這是最小、最直接、也最不容易把既有導航一起扯壞的做法。需求只是把 `Active tone` 從兩段式改成同層切換，不需要順便展開一場 UI 革命。

## Interaction design

### Row behavior

- `Tone enabled`
  - 維持既有行為：`space`、`left`、`right`、`Enter` 都走 toggle。
- `Active tone`
  - `left`: 切到前一個 tone preset。
  - `right`: 切到下一個 tone preset。
  - `space`: 不做任何事。
  - `Enter`: 不做任何事，不開新畫面。

### Cycling rule

- 依 `TONE_IDS` 的既有順序循環。
- 在第一個 preset 按 `left` 時，回到最後一個。
- 在最後一個 preset 按 `right` 時，回到第一個。

這個 wrap-around 行為比「卡住不動」更一致，否則左右鍵一半時候有反應、一半時候裝死，互動像在看心情上班。

### Saving rule

- `Active tone` 的 inline 切換直接呼叫既有 `selectTone(nextToneId)`。
- 若 `savingField()` 有值，忽略新的切換輸入，延續目前「一次只存一個欄位」的保護。
- 若切到的 tone 和目前值相同，不重複寫入。

### Footer/help text

- 移除所有 `tone-picker` / `Select tone` 的文案。
- 底部提示改成單一 dialog 的真實快捷鍵說明，至少要能反映：
  - `Tone enabled` 可 toggle
  - `Active tone` 用 `left/right` 調整
  - `Active tone` 的 `space` / `Enter` 不會開新畫面，也不會改值

## Implementation surface

### `src/settings-dialog.tsx`

- 移除 `DialogMode`、`toneOptions()`、以及切換到第二層 picker 的流程。
- 新增根據目前 `activeTone` 計算前一個/下一個 preset 的 helper。
- 擴充 `useKeyboard()`：
  - 當目前 row 是 `roastEnabled`，保留既有 toggle 邏輯。
  - 當目前 row 是 `activeTone`，`left/right` 改成呼叫 `selectTone(nextToneId)`。
- 更新 `onSelect()`：
  - `roastEnabled` 仍 toggle。
  - `activeTone` 直接 return，不再改 mode。
- 更新底部提示文案。

### `src/tui.tsx`

- 不改動資料寫入 contract。
- 繼續提供既有 `selectTone(toneId)`，由 dialog inline 呼叫。

## Testing

先寫失敗測試，再補實作。

### `test/settings-dialog.test.tsx`

新增或改寫測試覆蓋：

1. `Active tone` row 按 `right` 會切到下一個 preset。
2. `Active tone` row 按 `left` 會切到前一個 preset。
3. 第一個 preset 往左、最後一個 preset 往右都會 wrap。
4. `Enter` 在 `Active tone` row 不再開第二層 picker。
5. saving 進行中時，`Active tone` 不接受左右切換。

### `test/tui.test.ts`

確認 dialog 經過 inline 切換後，仍使用既有 `selectTone()` 路徑保存 `activeTone`，失敗回滾與 toast 行為不變。

## Success criteria

1. 開啟 `Roast Tone settings` 後，不再出現第二層 tone picker。
2. `Active tone` 在第一層可用左右鍵直接切換並保存。
3. `Tone enabled` 的既有切換行為不回歸。
4. dialog 與 TUI 測試都通過。
