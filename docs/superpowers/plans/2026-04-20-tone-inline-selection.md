# Tone Inline Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change `Active tone` in `Roast Tone settings` from a second-layer picker to first-layer left/right inline cycling, while keeping the existing persistence path intact.

**Architecture:** Keep the persistence contract in `src/tui.tsx` unchanged and move the interaction change into `src/settings-dialog.tsx`. Replace the dialog's two-mode flow with a single settings view, then prove the new behavior through focused dialog tests and a targeted TUI regression run.

**Tech Stack:** TypeScript, Solid JSX, Vitest, OpenTUI dialog APIs

---

## File structure

- Modify: `test/settings-dialog.test.tsx`
  - Replace second-layer picker expectations with inline keyboard behavior expectations.
- Modify: `src/settings-dialog.tsx`
  - Remove dialog mode switching and implement inline tone cycling on the existing `Active tone` row.
- Verify: `test/tui.test.ts`
  - Keep the `selectTone()` persistence path green with the existing TUI regression coverage.

### Task 1: Implement inline tone cycling in the settings dialog

**Files:**
- Modify: `test/settings-dialog.test.tsx`
- Modify: `src/settings-dialog.tsx`
- Regression run: `test/tui.test.ts`

- [ ] **Step 1: Replace the second-layer picker tests with inline-cycle expectations**

```tsx
it("cycles to the next tone with Right on the Active tone row", () => {
  const dialog = mountDialog({
    initialValue: { roastEnabled: true, activeTone: "roast" },
  });

  dialog.dialog().onMove?.(dialog.dialog().options[1]!);

  const event = {
    name: "right",
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } satisfies KeyboardEventLike;

  lastKeyboardHandler?.(event);

  expect(event.preventDefault).toHaveBeenCalledTimes(1);
  expect(event.stopPropagation).toHaveBeenCalledTimes(1);
  expect(dialog.selectTone).toHaveBeenCalledWith("dry");

  dialog.dispose();
});

it("wraps to the last tone with Left from the first preset", () => {
  const dialog = mountDialog({
    initialValue: { roastEnabled: true, activeTone: "roast" },
  });

  dialog.dialog().onMove?.(dialog.dialog().options[1]!);

  const event = {
    name: "left",
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } satisfies KeyboardEventLike;

  lastKeyboardHandler?.(event);

  expect(dialog.selectTone).toHaveBeenCalledWith("mentor");

  dialog.dispose();
});

it("does not open a second dialog when Enter is pressed on Active tone", async () => {
  const dialog = mountDialog({
    initialValue: { roastEnabled: false, activeTone: "mentor" },
  });

  dialog.dialog().onMove?.(dialog.dialog().options[1]!);
  await dialog.dialog().onSelect?.(dialog.dialog().options[1]!);

  expect(dialog.dialog()).toMatchObject({
    title: "Roast Tone settings",
    current: "activeTone",
  });
  expect(dialog.selectTone).not.toHaveBeenCalled();

  dialog.dispose();
});

it("ignores Left/Right while Active tone is saving", () => {
  const dialog = mountDialog({
    initialValue: { roastEnabled: true, activeTone: "deadpan" },
    initialSavingField: "activeTone",
  });

  dialog.dialog().onMove?.(dialog.dialog().options[1]!);

  const event = {
    name: "right",
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } satisfies KeyboardEventLike;

  lastKeyboardHandler?.(event);

  expect(dialog.selectTone).not.toHaveBeenCalled();
  expect(event.preventDefault).not.toHaveBeenCalled();
  expect(event.stopPropagation).not.toHaveBeenCalled();

  dialog.dispose();
});

it("treats Space as a no-op on the Active tone row", () => {
  const dialog = mountDialog({
    initialValue: { roastEnabled: true, activeTone: "dry" },
  });

  dialog.dialog().onMove?.(dialog.dialog().options[1]!);

  const event = {
    name: "space",
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } satisfies KeyboardEventLike;

  lastKeyboardHandler?.(event);

  expect(dialog.selectTone).not.toHaveBeenCalled();
  expect(event.preventDefault).toHaveBeenCalledTimes(1);
  expect(event.stopPropagation).toHaveBeenCalledTimes(1);

  dialog.dispose();
});
```

- [ ] **Step 2: Run the dialog test file and verify the new cases fail for the right reason**

Run: `npm test -- test/settings-dialog.test.tsx`

Expected: FAIL because `src/settings-dialog.tsx` still enters the second-layer picker and only routes `left/right` to `roastEnabled`.

- [ ] **Step 3: Simplify the dialog state to a single settings view**

```tsx
export type Field = ToggleField | PickerField;

const cycleTone = (activeTone: ToneId, direction: "left" | "right") => {
  const currentIndex = TONE_IDS.indexOf(activeTone);
  const delta = direction === "left" ? -1 : 1;
  const nextIndex = (currentIndex + delta + TONE_IDS.length) % TONE_IDS.length;

  return TONE_IDS[nextIndex] ?? activeTone;
};

const [filterQuery, setFilterQuery] = createSignal("");
const [current, setCurrent] = createSignal<Field | undefined>("roastEnabled");
```

- [ ] **Step 4: Remove second-layer picker rendering and keep a single dialog**

```tsx
<props.api.ui.DialogSelect
  title="Roast Tone settings"
  placeholder="Filter settings"
  options={settingsOptions()}
  current={current()}
  onFilter={(query) => {
    setFilterQuery(query);
  }}
  onMove={(item) => {
    setCurrent(field(item.value));
  }}
  onSelect={async (item) => {
    const nextField = field(item.value);

    if (!nextField || props.savingField()) {
      return;
    }

    setCurrent(nextField);

    if (nextField === "roastEnabled") {
      await props.flip("roastEnabled");
    }
  }}
/>
```

- [ ] **Step 5: Route keyboard input by the selected row**

```tsx
useKeyboard((event) => {
  const activeField = field(current());

  if (!activeField || props.savingField()) {
    return;
  }

  if (activeField === "roastEnabled") {
    if (event.name === "space" || event.name === "left" || event.name === "right") {
      event.preventDefault();
      event.stopPropagation();
      void props.flip("roastEnabled");
    }

    return;
  }

  if (event.name === "left" || event.name === "right") {
    event.preventDefault();
    event.stopPropagation();
    void props.selectTone(cycleTone(props.value().activeTone, event.name));
    return;
  }

  if (event.name === "space") {
    event.preventDefault();
    event.stopPropagation();
  }
});
```

- [ ] **Step 6: Update the footer text so it matches the real shortcuts**

```tsx
<box paddingRight={2} paddingLeft={4} flexDirection="column" gap={0} paddingTop={1} paddingBottom={1} flexShrink={0}>
  <text>
    <span style={{ fg: theme().text }}>
      <b>toggle</b>{" "}
    </span>
    <span style={{ fg: theme().textMuted }}>
      Tone enabled: space enter left/right
    </span>
  </text>
  <text>
    <span style={{ fg: theme().text }}>
      <b>adjust</b>{" "}
    </span>
    <span style={{ fg: theme().textMuted }}>
      Active tone: left/right
    </span>
  </text>
</box>
```

- [ ] **Step 7: Run the dialog and TUI regression tests**

Run: `npm test -- test/settings-dialog.test.tsx test/tui.test.ts`

Expected: PASS, including the new inline-cycle dialog tests and the existing `activeTone` persistence coverage in `test/tui.test.ts`.

- [ ] **Step 8: Commit the implementation**

```bash
git add src/settings-dialog.tsx test/settings-dialog.test.tsx
git commit -m "feat: inline tone selection in settings"
```

Expected: one commit containing only the dialog interaction change and its tests.

## Self-review

- Spec coverage:
  - First-layer `left/right` switching: Task 1 Steps 1, 5, and 7
  - No second-layer picker on `Enter`: Task 1 Steps 1 and 4
  - `Tone enabled` unchanged: Task 1 Steps 5 and 7
  - Accurate help text: Task 1 Step 6
  - Persistence path unchanged: Task 1 Step 7
- Placeholder scan: no `TODO` / `TBD` markers remain.
- Type consistency: `Field`, `ToneId`, `selectTone()`, and `savingField()` naming matches the current codebase.
