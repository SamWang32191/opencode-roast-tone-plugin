# Tone Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add selectable tone presets to `opencode-roast-tone-plugin` while preserving the existing roast toggle semantics and backward compatibility for old state files.

**Architecture:** Keep the plugin lightweight: `src/tone.ts` becomes the single registry for preset metadata and prompt text, `src/enabled-state.ts` stores `activeTone` beside the existing booleans, and `src/server.ts` continues to be the only place that mutates outgoing chat messages. The TUI layer expands the existing settings dialog into a two-step selector that can toggle tone injection and pick the active preset without introducing a separate configuration system.

**Tech Stack:** TypeScript, Solid/OpenTUI (`@opentui/solid`), OpenCode plugin APIs from `@opencode-ai/plugin`, Vitest, Node `fs/promises`

---

## File map

- Modify: `src/tone.ts`
  - Replace the single exported `TONE` constant with a preset registry that still preserves the existing roast prompt verbatim.
- Modify: `src/enabled-state.ts`
  - Add `activeTone` to the persisted state shape.
  - Validate tone IDs and preserve unknown top-level fields during merges.
- Modify: `src/server.ts`
  - Inject, replace, or remove known preset prompts based on `pluginEnabled`, `roastEnabled`, and `activeTone`.
- Modify: `src/settings-dialog.tsx`
  - Expand the current one-row dialog into a main settings list plus a tone-picker view.
- Modify: `src/tui.tsx`
  - Track `activeTone` in UI state, save tone selections, and show field-specific save errors.
- Modify: `test/enabled-state.test.ts`
  - Cover `activeTone` parsing, fallback, merge writes, and legacy normalization.
- Modify: `test/server.test.ts`
  - Cover preset injection, prompt replacement, and prompt removal when tone is disabled.
- Modify: `test/settings-dialog.test.tsx`
  - Cover the two-row settings view and the tone-picker interaction.
- Modify: `test/tui.test.ts`
  - Cover `activeTone` display, persistence, optimistic updates, and rollback on save failure.
- Modify: `README.md`
  - Document preset selection and explain how `Tone enabled` interacts with `Active tone`.

## Task 1: Preset registry, persisted state, and server transform

**Files:**
- Modify: `src/tone.ts`
- Modify: `src/enabled-state.ts`
- Modify: `src/server.ts`
- Test: `test/enabled-state.test.ts`
- Test: `test/server.test.ts`

- [ ] **Step 1: Write the failing state-helper and server tests**

Update the imports at the top of `test/enabled-state.test.ts`:

```ts
import {
  readEffectiveEnabledState,
  readEnabledState,
  readEnabledStateResult,
  resolveStateFile,
  writeActiveToneState,
  writeEnabledState,
  writePluginEnabledState,
  writeRoastEnabledState,
} from "../src/enabled-state.js";
import { DEFAULT_TONE_ID } from "../src/tone.js";
```

Add these cases to `test/enabled-state.test.ts`:

```ts
it("falls back activeTone to roast when the new format omits it", async () => {
  const configDir = await trackTempDir("enabled-config-");

  process.env.OPENCODE_CONFIG_DIR = configDir;
  await writeRawStateFile(
    configDir,
    JSON.stringify({ pluginEnabled: true, roastEnabled: false }),
  );

  await expect(
    readEnabledState({ directory: configDir, worktree: configDir }),
  ).resolves.toEqual({
    pluginEnabled: true,
    roastEnabled: false,
    activeTone: DEFAULT_TONE_ID,
  });
});

it("falls back invalid activeTone independently", async () => {
  const configDir = await trackTempDir("enabled-config-");

  process.env.OPENCODE_CONFIG_DIR = configDir;
  await writeRawStateFile(
    configDir,
    JSON.stringify({
      pluginEnabled: false,
      roastEnabled: true,
      activeTone: "chaotic",
      futureSetting: true,
    }),
  );

  await expect(
    readEnabledStateResult({ directory: configDir, worktree: configDir }),
  ).resolves.toMatchObject({
    kind: "partial-invalid-fields",
    warning: "partial-invalid-fields",
    state: {
      pluginEnabled: false,
      roastEnabled: true,
      activeTone: DEFAULT_TONE_ID,
    },
    raw: {
      pluginEnabled: false,
      roastEnabled: true,
      activeTone: "chaotic",
      futureSetting: true,
    },
  });
});

it("writeActiveToneState preserves booleans and unknown top-level fields", async () => {
  const configDir = await trackTempDir("enabled-config-");
  const context = { directory: configDir, worktree: configDir };

  process.env.OPENCODE_CONFIG_DIR = configDir;
  await writeRawStateFile(
    configDir,
    JSON.stringify({
      pluginEnabled: false,
      roastEnabled: true,
      activeTone: "roast",
      futureSetting: "keep-me",
    }),
  );

  await writeActiveToneState(context, "deadpan");

  const contents = await readFile(resolveStateFile(context), "utf8");

  expect(JSON.parse(contents)).toEqual({
    pluginEnabled: false,
    roastEnabled: true,
    activeTone: "deadpan",
    futureSetting: "keep-me",
  });
});

it("writeEnabledState preserves activeTone when normalizing legacy files", async () => {
  const configDir = await trackTempDir("enabled-config-");
  const context = { directory: configDir, worktree: configDir };

  process.env.OPENCODE_CONFIG_DIR = configDir;
  await writeRawStateFile(
    configDir,
    JSON.stringify({ enabled: false, activeTone: "mentor", futureSetting: true }),
  );

  await writeEnabledState(context, true);

  const contents = await readFile(resolveStateFile(context), "utf8");

  expect(JSON.parse(contents)).toEqual({
    pluginEnabled: true,
    roastEnabled: true,
    activeTone: "mentor",
    futureSetting: true,
  });
});
```

Update the imports at the top of `test/server.test.ts`:

```ts
import { TONE, TONE_REGISTRY } from "../src/tone.js";
```

Add these cases to `test/server.test.ts`:

```ts
it("injects the selected preset prompt instead of always using roast", async () => {
  const configDir = await trackTempDir("server-config-");
  process.env.OPENCODE_CONFIG_DIR = configDir;
  await writeStateFile(
    configDir,
    JSON.stringify({
      pluginEnabled: true,
      roastEnabled: true,
      activeTone: "dry",
    }),
  );

  const transform = await createTransform();
  const output = createOutput([
    {
      info: createUserInfo(),
      parts: [createTextPart("hello")],
    },
  ]);

  await transform(TRANSFORM_INPUT, output);

  expect(output.messages[0].parts[0]).toEqual({
    type: "text",
    text: TONE_REGISTRY.dry.prompt,
  });
});

it("replaces an older injected preset when activeTone changes", async () => {
  const configDir = await trackTempDir("server-config-");
  process.env.OPENCODE_CONFIG_DIR = configDir;
  await writeStateFile(
    configDir,
    JSON.stringify({
      pluginEnabled: true,
      roastEnabled: true,
      activeTone: "mentor",
    }),
  );

  const transform = await createTransform();
  const output = createOutput([
    {
      info: createUserInfo(),
      parts: [createTextPart(TONE_REGISTRY.roast.prompt), createTextPart("hello")],
    },
  ]);

  await transform(TRANSFORM_INPUT, output);

  expect(output.messages[0].parts).toHaveLength(2);
  expect(output.messages[0].parts[0]).toEqual({
    type: "text",
    text: TONE_REGISTRY.mentor.prompt,
  });
});

it("removes an injected preset when roastEnabled is false", async () => {
  const configDir = await trackTempDir("server-config-");
  process.env.OPENCODE_CONFIG_DIR = configDir;
  await writeStateFile(
    configDir,
    JSON.stringify({
      pluginEnabled: true,
      roastEnabled: false,
      activeTone: "deadpan",
    }),
  );

  const transform = await createTransform();
  const output = createOutput([
    {
      info: createUserInfo(),
      parts: [createTextPart(TONE_REGISTRY.roast.prompt), createTextPart("hello")],
    },
  ]);

  await transform(TRANSFORM_INPUT, output);

  expect(output.messages[0].parts).toHaveLength(1);
  expect(output.messages[0].parts[0]).toMatchObject({ type: "text", text: "hello" });
});
```

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run:

```bash
npm test -- test/enabled-state.test.ts test/server.test.ts
```

Expected: FAIL because `EnabledState` still lacks `activeTone`, `writeActiveToneState()` does not exist, and `src/server.ts` always injects the fixed `TONE` constant.

- [ ] **Step 3: Implement the preset registry, state upgrades, and transform logic**

Replace `src/tone.ts` with:

```ts
export type ToneId = "roast" | "dry" | "deadpan" | "mentor";

export type ToneDefinition = {
  id: ToneId;
  title: string;
  description: string;
  prompt: string;
};

export const TONE =
  "<Tone>Roast-comic sharp. Setup, punch, move on.If the logic is flimsy, heckle it. If the same mistake appears twice, call back to the first time — repetition is a pattern, and patterns get roasted harder. If the work is actually solid, say so like you're disappointed you couldn't find anything.When you screw up, roast yourself first — fair's fair.A good closer is welcome. Just don't let the bit be smarter than the work.</Tone>";

const DRY_TONE =
  "<Tone>Dry, clipped, and unimpressed. Keep the joke short. If the logic is weak, point at the weakness like it embarrassed itself in public. Stay concise, keep the dead weight out, and do not let the bit outrun the substance.</Tone>";

const DEADPAN_TONE =
  "<Tone>Deadpan and severe. Deliver the joke with a straight face, like the bug report wrote itself and you are simply reading the findings into the record. Keep the language flat, the observations sharp, and the conclusion quietly devastating.</Tone>";

const MENTOR_TONE =
  "<Tone>Strict but constructive. You may roast sloppy thinking, but the point is to correct it, not just admire the wreckage. Name the mistake, explain the fix, and keep the user moving in the right direction.</Tone>";

export const DEFAULT_TONE_ID: ToneId = "roast";

export const TONE_REGISTRY: Record<ToneId, ToneDefinition> = {
  roast: {
    id: "roast",
    title: "Roast",
    description: "Sharp, punchy, and openly judgmental.",
    prompt: TONE,
  },
  dry: {
    id: "dry",
    title: "Dry",
    description: "Short, clipped, and unimpressed.",
    prompt: DRY_TONE,
  },
  deadpan: {
    id: "deadpan",
    title: "Deadpan",
    description: "Flat delivery with quietly brutal conclusions.",
    prompt: DEADPAN_TONE,
  },
  mentor: {
    id: "mentor",
    title: "Mentor",
    description: "Strict guidance with lighter roast.",
    prompt: MENTOR_TONE,
  },
};

export const TONE_IDS = Object.keys(TONE_REGISTRY) as ToneId[];

export const isToneId = (value: unknown): value is ToneId => {
  return typeof value === "string" && value in TONE_REGISTRY;
};

export const getToneDefinition = (toneId: ToneId) => {
  return TONE_REGISTRY[toneId];
};

export const getTonePrompt = (toneId: ToneId) => {
  return getToneDefinition(toneId).prompt;
};

export const getToneIdForPrompt = (prompt: string): ToneId | undefined => {
  return TONE_IDS.find((toneId) => TONE_REGISTRY[toneId].prompt === prompt);
};
```

Update the type and parsing sections in `src/enabled-state.ts`:

```ts
import { DEFAULT_TONE_ID, isToneId, type ToneId } from "./tone.js";

export type EnabledState = {
  pluginEnabled: boolean;
  roastEnabled: boolean;
  activeTone: ToneId;
};

type PersistedEnabledState = Record<string, unknown> & {
  enabled?: unknown;
  pluginEnabled?: unknown;
  roastEnabled?: unknown;
  activeTone?: unknown;
};

const DEFAULT_ENABLED_STATE: EnabledState = {
  pluginEnabled: true,
  roastEnabled: true,
  activeTone: DEFAULT_TONE_ID,
};

const hasNewEnabledStateFields = (state: PersistedEnabledState) => {
  return "pluginEnabled" in state || "roastEnabled" in state || "activeTone" in state;
};

const createDefaultEnabledState = (): EnabledState => ({
  pluginEnabled: DEFAULT_ENABLED_STATE.pluginEnabled,
  roastEnabled: DEFAULT_ENABLED_STATE.roastEnabled,
  activeTone: DEFAULT_ENABLED_STATE.activeTone,
});
```

Replace `createResultFromParsedState()` in `src/enabled-state.ts` with:

```ts
const createResultFromParsedState = (raw: PersistedEnabledState): ReadEnabledStateResult => {
  if (hasNewEnabledStateFields(raw)) {
    const pluginEnabledValid = typeof raw.pluginEnabled === "boolean";
    const roastEnabledValid = typeof raw.roastEnabled === "boolean";
    const activeToneValid = isToneId(raw.activeTone);
    const state = {
      pluginEnabled: pluginEnabledValid
        ? (raw.pluginEnabled as boolean)
        : DEFAULT_ENABLED_STATE.pluginEnabled,
      roastEnabled: roastEnabledValid
        ? (raw.roastEnabled as boolean)
        : DEFAULT_ENABLED_STATE.roastEnabled,
      activeTone: activeToneValid
        ? (raw.activeTone as ToneId)
        : DEFAULT_ENABLED_STATE.activeTone,
    } satisfies EnabledState;

    if (pluginEnabledValid && roastEnabledValid && activeToneValid) {
      return { state, kind: "new-format-ok", raw };
    }

    return {
      state,
      kind: "partial-invalid-fields",
      warning: "partial-invalid-fields",
      raw,
    };
  }

  if (typeof raw.enabled === "boolean") {
    const activeTone = isToneId(raw.activeTone)
      ? (raw.activeTone as ToneId)
      : DEFAULT_ENABLED_STATE.activeTone;

    return {
      state: {
        pluginEnabled: raw.enabled as boolean,
        roastEnabled: raw.enabled as boolean,
        activeTone,
      },
      kind: "legacy",
      raw,
    };
  }

  return {
    state: createDefaultEnabledState(),
    kind: "invalid-file",
    warning: "invalid-file",
    raw,
  };
};
```

Update the persistence helpers in `src/enabled-state.ts`:

```ts
const createPersistedState = (
  result: ReadEnabledStateResult,
  state: EnabledState,
): Record<string, unknown> => {
  const persisted = result.raw ? { ...result.raw } : {};

  delete persisted.enabled;

  return {
    ...persisted,
    pluginEnabled: state.pluginEnabled,
    roastEnabled: state.roastEnabled,
    activeTone: state.activeTone,
  };
};

const writeMergedEnabledState = async (
  context: EnabledStateContext,
  nextState: Partial<EnabledState>,
) => {
  const current = await readEnabledStateResult(context);
  const mergedState = {
    ...current.state,
    ...nextState,
  } satisfies EnabledState;

  await writeStateFile(context, createPersistedState(current, mergedState));
};

export const writeActiveToneState = async (
  context: EnabledStateContext,
  activeTone: ToneId,
) => {
  await writeMergedEnabledState(context, { activeTone });
};

export const writeEnabledState = async (context: EnabledStateContext, enabled: boolean) => {
  const current = await readEnabledStateResult(context);

  await writeStateFile(
    context,
    createPersistedState(current, {
      pluginEnabled: enabled,
      roastEnabled: enabled,
      activeTone: current.state.activeTone,
    }),
  );
};
```

Replace `src/server.ts` with:

```ts
import type { Plugin } from "@opencode-ai/plugin";

import { readEnabledState } from "./enabled-state.js";
import { getToneIdForPrompt, getTonePrompt } from "./tone.js";

const createTonePart = (text: string) => {
  return { type: "text", text } as const;
};

const RoastTonePlugin: Plugin = async (input) => ({
  "experimental.chat.messages.transform": async (_transformInput, output) => {
    const state = await readEnabledState({
      directory: input.directory,
      worktree: input.worktree,
    });

    const firstUser = output.messages.find((message) => message.info.role === "user");

    if (!firstUser || !firstUser.parts.length) {
      return;
    }

    const firstPart = firstUser.parts[0];
    const injectedToneId =
      firstPart?.type === "text" ? getToneIdForPrompt(firstPart.text) : undefined;

    if (!state.pluginEnabled || !state.roastEnabled) {
      if (injectedToneId) {
        firstUser.parts.shift();
      }

      return;
    }

    const nextPrompt = getTonePrompt(state.activeTone);

    if (firstPart?.type === "text" && firstPart.text === nextPrompt) {
      return;
    }

    if (injectedToneId) {
      firstUser.parts[0] = createTonePart(nextPrompt);
      return;
    }

    firstUser.parts.unshift(createTonePart(nextPrompt));
  },
});

export default RoastTonePlugin;
```

- [ ] **Step 4: Run the targeted tests to verify the new state and server behavior**

Run:

```bash
npm test -- test/enabled-state.test.ts test/server.test.ts
```

Expected: PASS, including the new `activeTone` parsing cases and the prompt replacement/removal cases.

- [ ] **Step 5: Commit the state and server work**

Run:

```bash
git add src/tone.ts src/enabled-state.ts src/server.ts test/enabled-state.test.ts test/server.test.ts
git commit -m "feat: add tone preset state and server transform"
```

Expected: a new commit containing only the preset registry, state-helper, and server-transform changes.

## Task 2: Settings dialog and TUI preset selection

**Files:**
- Modify: `src/settings-dialog.tsx`
- Modify: `src/tui.tsx`
- Test: `test/settings-dialog.test.tsx`
- Test: `test/tui.test.ts`

- [ ] **Step 1: Write the failing dialog and TUI tests**

Update the imports at the top of `test/settings-dialog.test.tsx`:

```ts
import { SettingsDialog, type Field, type SettingsState } from "../src/settings-dialog.js";
import type { ToneId } from "../src/tone.js";
```

Update `mountDialog()` in `test/settings-dialog.test.tsx` so it can save tone selection:

```ts
const mountDialog = (options?: {
  initialValue?: SettingsState;
  initialSavingField?: Field | undefined;
  flip?: (key: "roastEnabled") => void | Promise<void>;
  selectTone?: (toneId: ToneId) => void | Promise<void>;
}) => {
  const [value, setValue] = createSignal<SettingsState>(
    options?.initialValue ?? { roastEnabled: true, activeTone: "roast" },
  );
  const [savingField, setSavingField] = createSignal<Field | undefined>(
    options?.initialSavingField,
  );
  const flip = vi.fn(options?.flip ?? (() => {
    setValue((state) => ({ ...state, roastEnabled: !state.roastEnabled }));
  }));
  const selectTone = vi.fn(options?.selectTone ?? ((toneId: ToneId) => {
    setValue((state) => ({ ...state, activeTone: toneId }));
  }));

  let dispose!: () => void;

  createRoot((nextDispose) => {
    dispose = nextDispose;

    return (
      <SettingsDialog
        api={{
          ui: { DialogSelect },
          theme: { current: { text: "text", textMuted: "muted" } },
        } as never}
        value={value}
        savingField={savingField}
        flip={flip}
        selectTone={selectTone}
      />
    );
  });

  return {
    dispose,
    flip,
    selectTone,
    setValue,
    setSavingField,
    dialog: () => {
      if (!lastDialogProps) {
        throw new Error("Expected DialogSelect to be rendered");
      }

      return lastDialogProps;
    },
  };
};
```

Add these cases to `test/settings-dialog.test.tsx`:

```ts
it("renders both Tone enabled and Active tone rows", () => {
  const dialog = mountDialog({
    initialValue: { roastEnabled: true, activeTone: "roast" },
  });

  expect(dialog.dialog().options).toEqual([
    expect.objectContaining({
      title: "Tone enabled",
      value: "roastEnabled",
      footer: "ON",
    }),
    expect.objectContaining({
      title: "Active tone",
      value: "activeTone",
      footer: "Roast",
    }),
  ]);

  dialog.dispose();
});

it("opens the tone picker when Active tone is selected", async () => {
  const dialog = mountDialog({
    initialValue: { roastEnabled: false, activeTone: "mentor" },
  });

  await dialog.dialog().onSelect?.(dialog.dialog().options[1]!);

  expect(dialog.dialog()).toMatchObject({
    title: "Select tone",
    current: "mentor",
  });
  expect(dialog.dialog().options).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ title: "Roast", value: "roast" }),
      expect.objectContaining({ title: "Dry", value: "dry" }),
      expect.objectContaining({ title: "Deadpan", value: "deadpan" }),
      expect.objectContaining({ title: "Mentor", value: "mentor" }),
    ]),
  );

  dialog.dispose();
});

it("selects a tone from the tone picker", async () => {
  const dialog = mountDialog();

  await dialog.dialog().onSelect?.(dialog.dialog().options[1]!);
  await dialog.dialog().onSelect?.(
    dialog.dialog().options.find((option) => option.value === "deadpan")!,
  );

  expect(dialog.selectTone).toHaveBeenCalledWith("deadpan");

  dialog.dispose();
});
```

Update the `SettingsDialog` mock in `test/tui.test.ts`:

```ts
vi.mock("../src/settings-dialog.js", () => ({
  SettingsDialog: (props: {
    api: {
      ui: {
        DialogSelect: (dialogProps: DialogSelectProps) => DialogSelectProps;
      };
    };
    value: () => { roastEnabled: boolean; activeTone: "roast" | "dry" | "deadpan" | "mentor" };
    savingField: () => string | undefined;
    flip: (field: "roastEnabled") => void | Promise<void>;
    selectTone: (toneId: "roast" | "dry" | "deadpan" | "mentor") => void | Promise<void>;
  }) => {
    const toneTitles = {
      roast: "Roast",
      dry: "Dry",
      deadpan: "Deadpan",
      mentor: "Mentor",
    } as const;

    return props.api.ui.DialogSelect({
      title: "Roast Tone settings",
      placeholder: "Filter settings",
      current: "roastEnabled",
      options: [
        {
          title: "Tone enabled",
          value: "roastEnabled",
          description: "Apply roast tone to future messages.",
          category: "Tone",
          footer:
            props.savingField() === "roastEnabled"
              ? "Saving..."
              : props.value().roastEnabled
                ? "ON"
                : "OFF",
          disabled: props.savingField() !== undefined,
        },
        {
          title: "Active tone",
          value: "activeTone",
          description: "Choose which preset to inject.",
          category: "Tone",
          footer:
            props.savingField() === "activeTone"
              ? "Saving..."
              : toneTitles[props.value().activeTone],
          disabled: props.savingField() !== undefined,
        },
      ],
      onSelect: async (option) => {
        if (option.value === "roastEnabled") {
          await props.flip("roastEnabled");
        }

        if (option.value === "activeTone") {
          await props.selectTone("deadpan");
        }
      },
    });
  },
}));
```

Add these cases to `test/tui.test.ts`:

```ts
it("shows the current tone in the settings dialog footer", async () => {
  const configDir = await trackTempDir("tui-config-");
  const worktree = await trackTempDir("tui-worktree-");
  const context = { directory: worktree, worktree };

  process.env.OPENCODE_CONFIG_DIR = configDir;
  await writeRawStateFile(context, {
    pluginEnabled: true,
    roastEnabled: true,
    activeTone: "mentor",
  });

  const plugin = createApi(context, [{ id: TEST_PLUGIN_ID, enabled: true, active: true }]);

  await tuiModule.tui(plugin.api as never, undefined, { id: TEST_PLUGIN_ID } as never);

  const command = plugin.commands().find((entry) => entry.title === "Roast Tone settings");
  await command?.onSelect?.();

  expect(plugin.renderDialog().options).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        title: "Active tone",
        footer: "Mentor",
      }),
    ]),
  );
});

it("writes activeTone without changing roastEnabled", async () => {
  const configDir = await trackTempDir("tui-config-");
  const worktree = await trackTempDir("tui-worktree-");
  const context = { directory: worktree, worktree };

  process.env.OPENCODE_CONFIG_DIR = configDir;
  await writeRawStateFile(context, {
    pluginEnabled: true,
    roastEnabled: false,
    activeTone: "roast",
  });

  const plugin = createApi(context, [{ id: TEST_PLUGIN_ID, enabled: true, active: true }]);

  await tuiModule.tui(plugin.api as never, undefined, { id: TEST_PLUGIN_ID } as never);

  const command = plugin.commands().find((entry) => entry.title === "Roast Tone settings");
  await command?.onSelect?.();

  const dialog = plugin.renderDialog();
  await dialog.onSelect?.(dialog.options[1]!);

  await expect(readStateFile(context)).resolves.toEqual({
    pluginEnabled: true,
    roastEnabled: false,
    activeTone: "deadpan",
  });
});

it("rolls back and shows an error toast when saving activeTone fails", async () => {
  const blockedPath = join(await trackTempDir("tui-blocked-"), "blocked-file");
  const context = { directory: blockedPath, worktree: blockedPath };

  await writeFile(blockedPath, "", "utf8");
  process.env.OPENCODE_CONFIG_DIR = blockedPath;

  const plugin = createApi(context, [{ id: TEST_PLUGIN_ID, enabled: true, active: true }]);

  await expect(
    tuiModule.tui(plugin.api as never, undefined, { id: TEST_PLUGIN_ID } as never),
  ).resolves.toBeUndefined();

  const command = plugin.commands().find((entry) => entry.title === "Roast Tone settings");
  await command?.onSelect?.();

  const dialog = plugin.renderDialog();
  await dialog.onSelect?.(dialog.options[1]!);

  expect(plugin.api.ui.toast).toHaveBeenCalledWith({
    variant: "error",
    title: "Couldn't save setting",
    message: "Failed to update Active tone.",
  });
});
```

- [ ] **Step 2: Run the dialog and TUI tests to verify they fail**

Run:

```bash
npm test -- test/settings-dialog.test.tsx test/tui.test.ts
```

Expected: FAIL because `SettingsState` lacks `activeTone`, `SettingsDialog` does not expose an `Active tone` row, and `tui.tsx` has no `selectTone()` path.

- [ ] **Step 3: Implement the two-row dialog and tone-selection flow**

Replace `src/settings-dialog.tsx` with:

```tsx
/** @jsxImportSource @opentui/solid */
import { useKeyboard } from "@opentui/solid";
import type { TuiPlugin } from "@opencode-ai/plugin/tui";
import { createEffect, createMemo, createSignal } from "solid-js";

import {
  TONE_IDS,
  getToneDefinition,
  isToneId,
  type ToneId,
} from "./tone.js";

type Api = Parameters<TuiPlugin>[0];

export type ToggleField = "roastEnabled";
export type PickerField = "activeTone";
export type Field = ToggleField | PickerField;
type DialogValue = Field | ToneId;
type DialogMode = "settings" | "tone-picker";

export type SettingsState = {
  roastEnabled: boolean;
  activeTone: ToneId;
};

type SettingsRow = {
  key: Field;
  title: string;
  description: string;
  category: "Tone";
};

const rows: SettingsRow[] = [
  {
    key: "roastEnabled",
    title: "Tone enabled",
    description: "Apply roast tone to future messages.",
    category: "Tone",
  },
  {
    key: "activeTone",
    title: "Active tone",
    description: "Choose which preset to inject.",
    category: "Tone",
  },
];

const field = (value: unknown): Field | undefined => {
  return value === "roastEnabled" || value === "activeTone" ? value : undefined;
};

const status = (value: boolean) => {
  return value ? "ON" : "OFF";
};

export const SettingsDialog = (props: {
  api: Api;
  value: () => SettingsState;
  savingField: () => Field | undefined;
  flip: (key: ToggleField) => void | Promise<void>;
  selectTone: (toneId: ToneId) => void | Promise<void>;
}) => {
  const [filterQuery, setFilterQuery] = createSignal("");
  const [mode, setMode] = createSignal<DialogMode>("settings");
  const [current, setCurrent] = createSignal<DialogValue>("roastEnabled");
  const theme = createMemo(() => props.api.theme.current);

  const visibleRows = createMemo(() => {
    const query = filterQuery().trim().toLowerCase();

    if (!query) {
      return rows;
    }

    return rows.filter((row) => {
      return [row.title, row.description, row.category].some((value) => {
        return value.toLowerCase().includes(query);
      });
    });
  });

  createEffect(() => {
    if (mode() === "tone-picker") {
      return;
    }

    const visible = visibleRows();
    const nextCurrent = current();

    if (field(nextCurrent) && visible.some((row) => row.key === nextCurrent)) {
      return;
    }

    setCurrent(visible[0]?.key ?? "roastEnabled");
  });

  const settingsOptions = createMemo(() => {
    const value = props.value();
    const savingField = props.savingField();

    return visibleRows().map((row) => {
      const footer =
        savingField === row.key
          ? "Saving..."
          : row.key === "roastEnabled"
            ? status(value.roastEnabled)
            : getToneDefinition(value.activeTone).title;

      return {
        title: row.title,
        value: row.key,
        description: row.description,
        category: row.category,
        footer,
        disabled: savingField !== undefined,
      };
    });
  });

  const toneOptions = createMemo(() => {
    const savingField = props.savingField();

    return TONE_IDS.map((toneId) => {
      const tone = getToneDefinition(toneId);

      return {
        title: tone.title,
        value: tone.id,
        description: tone.description,
        category: "Tone",
        footer: props.value().activeTone === toneId ? "Selected" : undefined,
        disabled: savingField !== undefined,
      };
    });
  });

  useKeyboard((event) => {
    if (mode() !== "settings") {
      return;
    }

    const activeField = field(current());

    if (activeField !== "roastEnabled" || props.savingField()) {
      return;
    }

    if (event.name === "space" || event.name === "left" || event.name === "right") {
      event.preventDefault();
      event.stopPropagation();
      void props.flip("roastEnabled");
    }
  });

  return (
    <box flexDirection="column">
      <props.api.ui.DialogSelect
        title={mode() === "settings" ? "Roast Tone settings" : "Select tone"}
        placeholder={mode() === "settings" ? "Filter settings" : "Filter tones"}
        options={mode() === "settings" ? settingsOptions() : toneOptions()}
        current={current()}
        onFilter={(query) => {
          setFilterQuery(query);
        }}
        onMove={(item) => {
          setCurrent(item.value as DialogValue);
        }}
        onSelect={async (item) => {
          if (mode() === "settings") {
            const nextField = field(item.value);

            if (!nextField || props.savingField()) {
              return;
            }

            setCurrent(nextField);

            if (nextField === "roastEnabled") {
              await props.flip("roastEnabled");
              return;
            }

            setMode("tone-picker");
            setCurrent(props.value().activeTone);
            return;
          }

          if (!isToneId(item.value) || props.savingField()) {
            return;
          }

          await props.selectTone(item.value);
          setMode("settings");
          setCurrent("activeTone");
        }}
      />
      <box
        paddingRight={2}
        paddingLeft={4}
        flexDirection="row"
        gap={2}
        paddingTop={1}
        paddingBottom={1}
        flexShrink={0}
      >
        <text>
          <span style={{ fg: theme().text }}>
            <b>{mode() === "settings" ? "toggle" : "select"}</b>{" "}
          </span>
          <span style={{ fg: theme().textMuted }}>
            {mode() === "settings" ? "space enter left/right" : "enter"}
          </span>
        </text>
      </box>
    </box>
  );
};
```

Update `src/tui.tsx`:

```tsx
/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { createSignal } from "solid-js";

import {
  readEnabledStateResult,
  type ReadWarning,
  writeActiveToneState,
  writePluginEnabledState,
  writeRoastEnabledState,
} from "./enabled-state.js";
import {
  DEFAULT_TONE_ID,
  type ToneId,
} from "./tone.js";
import { SettingsDialog, type Field, type SettingsState } from "./settings-dialog.js";

const SETTINGS_COMMAND_VALUE = "roast-tone-settings";
const PLUGIN_COMMAND_CATEGORY = "Plugin";
const SETTINGS_DESCRIPTION = "Enable roast tone and choose the active preset";

const warningMessages: Record<ReadWarning, string> = {
  "invalid-file": "Settings file is invalid. Showing fallback values.",
  "unreadable-file": "Settings file couldn't be read. Showing fallback values.",
  "partial-invalid-fields": "Some settings are invalid. Showing fallback values for affected settings.",
};

const saveErrorMessages: Record<Field, string> = {
  roastEnabled: "Failed to update Tone enabled.",
  activeTone: "Failed to update Active tone.",
};

const createSaveErrorToast = (field: Field) => {
  return {
    variant: "error" as const,
    title: "Couldn't save setting",
    message: saveErrorMessages[field],
  };
};

const tui: TuiPlugin = async (api, _options, meta) => {
  const context = {
    directory: api.state.path.directory,
    worktree: api.state.path.worktree,
  };

  const [value, setValue] = createSignal<SettingsState>({
    roastEnabled: true,
    activeTone: DEFAULT_TONE_ID,
  });
  const [savingField, setSavingField] = createSignal<Field | undefined>(undefined);

  const flip = async (field: "roastEnabled") => {
    if (savingField()) {
      return;
    }

    const previous = value();
    const next = !previous.roastEnabled;

    setValue({ ...previous, roastEnabled: next });
    setSavingField(field);

    try {
      await writeRoastEnabledState(context, next);
    } catch {
      setValue(previous);
      api.ui.toast(createSaveErrorToast(field));
    } finally {
      setSavingField(undefined);
    }
  };

  const selectTone = async (toneId: ToneId) => {
    if (savingField() || value().activeTone === toneId) {
      return;
    }

    const previous = value();

    setValue({ ...previous, activeTone: toneId });
    setSavingField("activeTone");

    try {
      await writeActiveToneState(context, toneId);
    } catch {
      setValue(previous);
      api.ui.toast(createSaveErrorToast("activeTone"));
    } finally {
      setSavingField(undefined);
    }
  };

  const showSettings = async () => {
    if (!savingField()) {
      const result = await readEnabledStateResult(context);

      setValue({
        roastEnabled: result.state.roastEnabled,
        activeTone: result.state.activeTone,
      });
      setSavingField(undefined);

      if (result.warning) {
        api.ui.toast({
          variant: "warning",
          title: "Settings issue detected",
          message: warningMessages[result.warning],
        });
      }
    }

    api.ui.dialog.setSize("medium");
    api.ui.dialog.replace(() => (
      <SettingsDialog
        api={api}
        value={value}
        savingField={savingField}
        flip={flip}
        selectTone={selectTone}
      />
    ));
  };

  try {
    await writePluginEnabledState(context, true);
  } catch {
    // lifecycle mirroring stays best-effort at the call site
  }

  const unregisterCommands = api.command.register(() => [
    {
      title: "Roast Tone settings",
      description: SETTINGS_DESCRIPTION,
      value: SETTINGS_COMMAND_VALUE,
      category: PLUGIN_COMMAND_CATEGORY,
      onSelect: showSettings,
    },
  ]);

  api.lifecycle.onDispose(async () => {
    unregisterCommands();

    const pluginStatus = api.plugins.list().find((plugin) => plugin.id === meta.id);
    const isPluginDisabled = pluginStatus?.enabled === false;

    if (!isPluginDisabled) {
      return;
    }

    try {
      await writePluginEnabledState(context, false);
    } catch {
      // lifecycle mirroring stays best-effort at the call site
    }
  });
};

const tuiModule: TuiPluginModule = {
  tui,
};

export default tuiModule;
```

- [ ] **Step 4: Run the dialog and TUI tests to verify the new selection flow**

Run:

```bash
npm test -- test/settings-dialog.test.tsx test/tui.test.ts
```

Expected: PASS, including the tone-picker flow and the `activeTone` save/rollback cases.

- [ ] **Step 5: Commit the TUI work**

Run:

```bash
git add src/settings-dialog.tsx src/tui.tsx test/settings-dialog.test.tsx test/tui.test.ts
git commit -m "feat: add tone preset selection in tui"
```

Expected: a new commit containing only the TUI dialog and TUI persistence changes.

## Task 3: README, full verification, and release-ready cleanup

**Files:**
- Modify: `README.md`
- Verify: `src/tone.ts`
- Verify: `src/enabled-state.ts`
- Verify: `src/server.ts`
- Verify: `src/settings-dialog.tsx`
- Verify: `src/tui.tsx`
- Verify: `test/enabled-state.test.ts`
- Verify: `test/server.test.ts`
- Verify: `test/settings-dialog.test.tsx`
- Verify: `test/tui.test.ts`

- [ ] **Step 1: Update the README to document preset selection**

Replace the TUI controls section in `README.md` with:

```md
## TUI controls in OpenCode

This plugin now has **two** TUI control surfaces:

1. **Built-in Plugins dialog**: controls whether the whole `opencode-roast-tone-plugin` package is enabled.
2. **`Roast Tone settings` command**: controls whether tone injection is enabled and which preset gets injected.

Open the command palette and run **`Roast Tone settings`** to manage both values.

### Tone presets

- **Roast**: the existing sharp roast-comic baseline
- **Dry**: shorter, clipped, and unimpressed
- **Deadpan**: flat delivery with colder punchlines
- **Mentor**: stricter guidance with lighter roast

### State combinations

- **Plugin enabled + Tone enabled**: the selected preset is injected into future user messages.
- **Plugin enabled + Tone disabled**: the plugin stays installed, but any known injected preset is removed from the active thread on the next transform.
- **Plugin disabled**: the plugin is off from the Plugins dialog, so no tone injection runs at all.
```

- [ ] **Step 2: Run the full test suite**

Run:

```bash
npm test
```

Expected: PASS across `test/server.test.ts`, `test/enabled-state.test.ts`, `test/settings-dialog.test.tsx`, and `test/tui.test.ts`.

- [ ] **Step 3: Run the build**

Run:

```bash
npm run build
```

Expected: PASS with TypeScript checks succeeding and the build script producing updated `dist/` output without errors.

- [ ] **Step 4: Commit the docs and verified final state**

Run:

```bash
git add README.md
git commit -m "docs: document tone preset controls"
```

Expected: a final documentation/verification commit after the full suite and build pass.

## Self-review

### Spec coverage

- Preset registry and reusable metadata: Task 1
- `activeTone` persistence and legacy fallback: Task 1
- Replace/remove injected prompts in current thread: Task 1
- Two-row settings dialog plus tone picker: Task 2
- TUI optimistic save, rollback, and lifecycle persistence: Task 2
- README updates and end-to-end verification: Task 3

No spec requirements are currently uncovered.

### Placeholder scan

- Searched mentally for `TBD`, `TODO`, "implement later", and "similar to Task N".
- Every task contains exact file paths, commands, and concrete code blocks.
- No step depends on an undefined helper name.

### Type consistency

- `ToneId` is defined once in `src/tone.ts` and reused in state, dialog, and TUI steps.
- `SettingsState` always uses `{ roastEnabled: boolean; activeTone: ToneId }`.
- The new write helper is consistently named `writeActiveToneState`.
