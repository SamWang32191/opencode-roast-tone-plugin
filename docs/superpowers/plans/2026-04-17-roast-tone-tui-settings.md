# Roast Tone TUI Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a command-palette-driven `Roast Tone settings` panel that toggles roast tone injection independently from the built-in Plugins dialog while keeping both controls effective.

**Architecture:** Keep the existing state-file root resolution, but upgrade the stored payload from a single `enabled` boolean to a backward-compatible dual-state shape: `pluginEnabled` and `roastEnabled`. The server transform reads an effective flag (`pluginEnabled && roastEnabled`), while the TUI plugin both mirrors built-in plugin enable/disable into `pluginEnabled` and exposes a one-row `DialogSelect` settings panel that toggles `roastEnabled`.

**Tech Stack:** TypeScript, Node.js fs/promises, `@opencode-ai/plugin`, Vitest

---

## File map

- Modify: `src/enabled-state.ts:1-119`
  - Upgrade state parsing/writing to dual-state storage.
  - Keep compatibility helpers so existing callers keep compiling during the transition.
- Modify: `src/server.ts:1-41`
  - Read the effective enabled state instead of the old single boolean.
- Modify: `src/tui.ts:1-27`
  - Stop overwriting the user feature toggle on load.
  - Register `Roast Tone settings` in the command palette.
  - Open a single-row `DialogSelect` and toggle `roastEnabled`.
- Modify: `test/enabled-state.test.ts:1-183`
  - Cover dual-state parsing, fallback, and partial writes.
- Modify: `test/server.test.ts:1-344`
  - Cover dual-state combinations while preserving legacy compatibility tests.
- Modify: `test/tui.test.ts:1-145`
  - Cover command registration, dialog toggling, and `pluginEnabled` persistence behavior.
- Modify: `README.md:27-45`
  - Document the new command-palette settings entry and explain how it differs from the built-in Plugins dialog.

## Task 1: Upgrade state storage and server behavior

**Files:**
- Modify: `src/enabled-state.ts:1-119`
- Modify: `src/server.ts:1-41`
- Test: `test/enabled-state.test.ts:1-183`
- Test: `test/server.test.ts:244-344`

- [ ] **Step 1: Write the failing state-helper and server tests**

First, update the import block in `test/enabled-state.test.ts`:

```ts
import {
  readEffectiveEnabledState,
  readEnabledState,
  resolveStateFile,
  writeEnabledState,
  writeRoastEnabledState,
} from "../src/enabled-state.js";
```

Then update the existing fallback assertions so they match the new return type from `readEnabledState()`:

```ts
it("returns the default dual-state when the state file is missing", async () => {
  const configDir = await trackTempDir("enabled-config-");

  process.env.OPENCODE_CONFIG_DIR = configDir;

  await expect(
    readEnabledState({ directory: configDir, worktree: configDir }),
  ).resolves.toEqual({ pluginEnabled: true, roastEnabled: true });
});

it("returns the default dual-state on non-ENOENT filesystem errors", async () => {
  const blockedPath = join(await trackTempDir("enabled-blocked-"), "blocked-file");

  await writeFile(blockedPath, "", "utf8");
  process.env.OPENCODE_CONFIG_DIR = blockedPath;

  await expect(
    readEnabledState({ directory: blockedPath, worktree: blockedPath }),
  ).resolves.toEqual({ pluginEnabled: true, roastEnabled: true });
});

it("returns the default dual-state when the state JSON is malformed", async () => {
  const configDir = await trackTempDir("enabled-config-");

  process.env.OPENCODE_CONFIG_DIR = configDir;
  await writeRawStateFile(configDir, "not-json-at-all");

  await expect(
    readEnabledState({ directory: configDir, worktree: configDir }),
  ).resolves.toEqual({ pluginEnabled: true, roastEnabled: true });
});

it("returns the default dual-state when enabled is not a boolean", async () => {
  const configDir = await trackTempDir("enabled-config-");

  process.env.OPENCODE_CONFIG_DIR = configDir;
  await writeRawStateFile(configDir, JSON.stringify({ enabled: "yeah totally" }));

  await expect(
    readEnabledState({ directory: configDir, worktree: configDir }),
  ).resolves.toEqual({ pluginEnabled: true, roastEnabled: true });
});
```

Add these test cases to `test/enabled-state.test.ts`:

```ts
it("reads the new dual-state format", async () => {
  const configDir = await trackTempDir("enabled-config-");

  process.env.OPENCODE_CONFIG_DIR = configDir;
  await writeRawStateFile(
    configDir,
    JSON.stringify({ pluginEnabled: false, roastEnabled: true }),
  );

  await expect(
    readEnabledState({ directory: configDir, worktree: configDir }),
  ).resolves.toEqual({ pluginEnabled: false, roastEnabled: true });
});

it("treats the legacy enabled flag as both new flags", async () => {
  const configDir = await trackTempDir("enabled-config-");

  process.env.OPENCODE_CONFIG_DIR = configDir;
  await writeRawStateFile(configDir, JSON.stringify({ enabled: false }));

  await expect(
    readEnabledState({ directory: configDir, worktree: configDir }),
  ).resolves.toEqual({ pluginEnabled: false, roastEnabled: false });
});

it("updates only roastEnabled when using writeRoastEnabledState", async () => {
  const configDir = await trackTempDir("enabled-config-");
  const context = { directory: configDir, worktree: configDir };

  process.env.OPENCODE_CONFIG_DIR = configDir;
  await writeRawStateFile(
    configDir,
    JSON.stringify({ pluginEnabled: true, roastEnabled: true }),
  );

  await writeRoastEnabledState(context, false);

  const contents = await readFile(resolveStateFile(context), "utf8");
  expect(JSON.parse(contents)).toEqual({ pluginEnabled: true, roastEnabled: false });
});

it("computes the effective enabled state from both flags", async () => {
  const configDir = await trackTempDir("enabled-config-");

  process.env.OPENCODE_CONFIG_DIR = configDir;
  await writeRawStateFile(
    configDir,
    JSON.stringify({ pluginEnabled: true, roastEnabled: false }),
  );

  await expect(
    readEffectiveEnabledState({ directory: configDir, worktree: configDir }),
  ).resolves.toBe(false);
});
```

Add these test cases to `test/server.test.ts`:

```ts
it("does not inject when roastEnabled is false but pluginEnabled stays true", async () => {
  const configDir = await trackTempDir("server-config-");
  process.env.OPENCODE_CONFIG_DIR = configDir;
  await writeStateFile(
    configDir,
    JSON.stringify({ pluginEnabled: true, roastEnabled: false }),
  );

  const transform = await createTransform();
  const output = createOutput([
    {
      info: createUserInfo(),
      parts: [createTextPart("hello")],
    },
  ]);

  await transform(TRANSFORM_INPUT, output);

  expect(output.messages[0].parts).toHaveLength(1);
  expect(output.messages[0].parts[0]).toMatchObject({ type: "text", text: "hello" });
});

it("does not inject when pluginEnabled is false but roastEnabled stays true", async () => {
  const configDir = await trackTempDir("server-config-");
  process.env.OPENCODE_CONFIG_DIR = configDir;
  await writeStateFile(
    configDir,
    JSON.stringify({ pluginEnabled: false, roastEnabled: true }),
  );

  const transform = await createTransform();
  const output = createOutput([
    {
      info: createUserInfo(),
      parts: [createTextPart("hello")],
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

Expected: FAIL because `readEnabledState()` still returns a boolean, `readEffectiveEnabledState` / `writeRoastEnabledState` do not exist yet, and `src/server.ts` still checks the old single-flag behavior.

- [ ] **Step 3: Implement the dual-state helpers with backward compatibility**

Replace the state model in `src/enabled-state.ts` with this implementation:

```ts
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export type EnabledStateContext = {
  directory: string;
  worktree: string;
};

export type EnabledState = {
  pluginEnabled: boolean;
  roastEnabled: boolean;
};

const STATE_FILE_PARTS = ["plugin-data", "opencode-roast-tone-plugin", "state.json"] as const;
const DEFAULT_ENABLED_STATE: EnabledState = {
  pluginEnabled: true,
  roastEnabled: true,
};

const isWithinDirectory = (child: string, parent: string) => {
  const relativePath = relative(parent, child);

  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
};

const findWorkspaceConfigRoot = ({ directory, worktree }: EnabledStateContext) => {
  const resolvedWorktree = resolve(worktree);
  let currentDirectory = resolve(directory);

  if (!isWithinDirectory(currentDirectory, resolvedWorktree)) {
    currentDirectory = resolvedWorktree;
  }

  while (true) {
    const candidate = join(currentDirectory, ".opencode");

    if (existsSync(candidate)) {
      return candidate;
    }

    if (currentDirectory === resolvedWorktree) {
      return undefined;
    }

    currentDirectory = dirname(currentDirectory);

    if (!isWithinDirectory(currentDirectory, resolvedWorktree)) {
      return undefined;
    }
  }
};

const resolveStateRoot = (context: EnabledStateContext) => {
  if (process.env.OPENCODE_CONFIG_DIR) {
    return process.env.OPENCODE_CONFIG_DIR;
  }

  const workspaceConfigRoot = findWorkspaceConfigRoot(context);

  if (workspaceConfigRoot) {
    return workspaceConfigRoot;
  }

  if (process.env.XDG_CONFIG_HOME) {
    return join(process.env.XDG_CONFIG_HOME, "opencode");
  }

  return join(homedir(), ".config", "opencode");
};

export const resolveStateFile = (context: EnabledStateContext) => {
  return join(resolveStateRoot(context), ...STATE_FILE_PARTS);
};

const isFileNotFoundError = (error: unknown): error is NodeJS.ErrnoException => {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
};

const bool = (value: unknown, fallback: boolean) => {
  return typeof value === "boolean" ? value : fallback;
};

const parseEnabledState = (contents: string): EnabledState => {
  try {
    const parsed = JSON.parse(contents) as {
      enabled?: unknown;
      pluginEnabled?: unknown;
      roastEnabled?: unknown;
    };

    if (typeof parsed.enabled === "boolean") {
      return {
        pluginEnabled: parsed.enabled,
        roastEnabled: parsed.enabled,
      };
    }

    return {
      pluginEnabled: bool(parsed.pluginEnabled, DEFAULT_ENABLED_STATE.pluginEnabled),
      roastEnabled: bool(parsed.roastEnabled, DEFAULT_ENABLED_STATE.roastEnabled),
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return DEFAULT_ENABLED_STATE;
    }

    throw error;
  }
};

export const readEnabledState = async (context: EnabledStateContext): Promise<EnabledState> => {
  const stateFile = resolveStateFile(context);

  try {
    const contents = await readFile(stateFile, "utf8");
    return parseEnabledState(contents);
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return DEFAULT_ENABLED_STATE;
    }

    return DEFAULT_ENABLED_STATE;
  }
};

export const readEffectiveEnabledState = async (context: EnabledStateContext) => {
  const state = await readEnabledState(context);
  return state.pluginEnabled && state.roastEnabled;
};

const writeState = async (context: EnabledStateContext, next: Partial<EnabledState>) => {
  try {
    const stateFile = resolveStateFile(context);
    const current = await readEnabledState(context);
    const state: EnabledState = {
      ...current,
      ...next,
    };

    await mkdir(dirname(stateFile), { recursive: true });
    await writeFile(stateFile, JSON.stringify(state), "utf8");
  } catch {
    // best-effort only
  }
};

export const writePluginEnabledState = async (context: EnabledStateContext, enabled: boolean) => {
  await writeState(context, { pluginEnabled: enabled });
};

export const writeRoastEnabledState = async (context: EnabledStateContext, enabled: boolean) => {
  await writeState(context, { roastEnabled: enabled });
};

export const writeEnabledState = async (context: EnabledStateContext, enabled: boolean) => {
  try {
    const stateFile = resolveStateFile(context);

    await mkdir(dirname(stateFile), { recursive: true });
    await writeFile(stateFile, JSON.stringify({ enabled }), "utf8");
  } catch {
    // best-effort only
  }
};
```

- [ ] **Step 4: Switch the server transform to the effective enabled helper**

Update `src/server.ts` to read the combined flag:

```ts
import type { Plugin } from "@opencode-ai/plugin";

import { readEffectiveEnabledState } from "./enabled-state.js";
import { TONE } from "./tone.js";

const prependTonePart = (parts: unknown[]) => {
  parts.unshift({ type: "text", text: TONE });
};

const RoastTonePlugin: Plugin = async (input) => ({
  "experimental.chat.messages.transform": async (_transformInput, output) => {
    const enabled = await readEffectiveEnabledState({
      directory: input.directory,
      worktree: input.worktree,
    });

    if (!enabled) {
      return;
    }

    if (!output.messages.length) {
      return;
    }

    const firstUser = output.messages.find((message) => message.info.role === "user");

    if (!firstUser || !firstUser.parts.length) {
      return;
    }

    const firstPart = firstUser.parts[0];

    if (firstPart?.type === "text" && firstPart.text === TONE) {
      return;
    }

    prependTonePart(firstUser.parts);
  },
});

export default RoastTonePlugin;
```

- [ ] **Step 5: Run the targeted tests to verify they pass**

Run:

```bash
npm test -- test/enabled-state.test.ts test/server.test.ts
```

Expected: PASS for the updated state helper and server coverage, while the existing TUI tests still remain green because `writeEnabledState()` keeps writing the legacy `{ enabled }` payload until Task 2 migrates `src/tui.ts`.

- [ ] **Step 6: Commit the core state changes**

```bash
git add src/enabled-state.ts src/server.ts test/enabled-state.test.ts test/server.test.ts
git commit -m "feat: add dual-state roast tone persistence"
```

## Task 2: Add the Roast Tone settings command and dialog

**Files:**
- Modify: `src/tui.ts:1-27`
- Test: `test/tui.test.ts:1-145`

- [ ] **Step 1: Write the failing TUI tests for command registration and toggle behavior**

Update `test/tui.test.ts` so the helper API captures command registration and dialog usage. Add these pieces:

```ts
type Command = {
  title: string;
  value: string;
  category?: string;
  onSelect?: () => void | Promise<void>;
};

type DialogSelectProps = {
  title: string;
  current?: string;
  options: Array<{
    title: string;
    value: string;
    description?: string;
    footer?: string;
  }>;
  onSelect?: (item: { title: string; value: string }) => void;
};
```

Change `readStateFile()` to read the new JSON shape:

```ts
const readStateFile = async (context: EnabledStateContext) => {
  const contents = await readFile(resolveStateFile(context), "utf8");
  return JSON.parse(contents) as { pluginEnabled: boolean; roastEnabled: boolean };
};
```

Extend `createApi()` with command and dialog capture, then add these tests:

```ts
it("registers Roast Tone settings in the command palette", async () => {
  const configDir = await trackTempDir("tui-config-");
  const worktree = await trackTempDir("tui-worktree-");
  const context = { directory: worktree, worktree };

  process.env.OPENCODE_CONFIG_DIR = configDir;

  const plugin = createApi(context, [{ id: TEST_PLUGIN_ID, enabled: true, active: true }]);

  await tuiModule.tui(plugin.api as never, undefined, { id: TEST_PLUGIN_ID } as never);

  expect(plugin.commands().map((item) => item.title)).toContain("Roast Tone settings");
});

it("toggles roastEnabled from the settings dialog without changing pluginEnabled", async () => {
  const configDir = await trackTempDir("tui-config-");
  const worktree = await trackTempDir("tui-worktree-");
  const context = { directory: worktree, worktree };

  process.env.OPENCODE_CONFIG_DIR = configDir;

  const plugin = createApi(context, [{ id: TEST_PLUGIN_ID, enabled: true, active: true }]);

  await tuiModule.tui(plugin.api as never, undefined, { id: TEST_PLUGIN_ID } as never);
  await plugin.openCommand("Roast Tone settings");
  await plugin.selectDialogOption("roast-enabled");

  await expect(readStateFile(context)).resolves.toEqual({
    pluginEnabled: true,
    roastEnabled: false,
  });
});

it("preserves roastEnabled when plugin disable dispose writes pluginEnabled=false", async () => {
  const configDir = await trackTempDir("tui-config-");
  const worktree = await trackTempDir("tui-worktree-");
  const context = { directory: worktree, worktree };

  process.env.OPENCODE_CONFIG_DIR = configDir;

  const plugin = createApi(context, [{ id: TEST_PLUGIN_ID, enabled: true, active: true }]);

  await tuiModule.tui(plugin.api as never, undefined, { id: TEST_PLUGIN_ID } as never);
  await plugin.openCommand("Roast Tone settings");
  await plugin.selectDialogOption("roast-enabled");
  plugin.setPlugins([{ id: TEST_PLUGIN_ID, enabled: false, active: false }]);
  await plugin.dispose();

  await expect(readStateFile(context)).resolves.toEqual({
    pluginEnabled: false,
    roastEnabled: false,
  });
});
```

Also update the three existing TUI assertions so they match the new state model:

```ts
it("writes pluginEnabled=true when the plugin loads", async () => {
  const configDir = await trackTempDir("tui-config-");
  const worktree = await trackTempDir("tui-worktree-");
  const context = { directory: worktree, worktree };

  process.env.OPENCODE_CONFIG_DIR = configDir;

  const { api } = createApi(context, [{ id: TEST_PLUGIN_ID, enabled: true, active: true }]);

  await tuiModule.tui(api as never, undefined, { id: TEST_PLUGIN_ID } as never);

  await expect(readStateFile(context)).resolves.toEqual({
    pluginEnabled: true,
    roastEnabled: true,
  });
});

it("writes pluginEnabled=false when dispose happens after the plugin is disabled", async () => {
  const configDir = await trackTempDir("tui-config-");
  const worktree = await trackTempDir("tui-worktree-");
  const context = { directory: worktree, worktree };

  process.env.OPENCODE_CONFIG_DIR = configDir;

  const plugin = createApi(context, [{ id: TEST_PLUGIN_ID, enabled: true, active: true }]);

  await tuiModule.tui(plugin.api as never, undefined, { id: TEST_PLUGIN_ID } as never);
  plugin.setPlugins([{ id: TEST_PLUGIN_ID, enabled: false, active: false }]);
  await plugin.dispose();

  await expect(readStateFile(context)).resolves.toEqual({
    pluginEnabled: false,
    roastEnabled: true,
  });
});

it("does not overwrite the state when dispose happens but the plugin remains enabled", async () => {
  const configDir = await trackTempDir("tui-config-");
  const worktree = await trackTempDir("tui-worktree-");
  const context = { directory: worktree, worktree };

  process.env.OPENCODE_CONFIG_DIR = configDir;

  const plugin = createApi(context, [{ id: TEST_PLUGIN_ID, enabled: true, active: true }]);

  await tuiModule.tui(plugin.api as never, undefined, { id: TEST_PLUGIN_ID } as never);
  plugin.setPlugins([{ id: TEST_PLUGIN_ID, enabled: true, active: false }]);
  await plugin.dispose();

  await expect(readStateFile(context)).resolves.toEqual({
    pluginEnabled: true,
    roastEnabled: true,
  });
});
```

- [ ] **Step 2: Run the targeted TUI tests to verify they fail**

Run:

```bash
npm test -- test/tui.test.ts
```

Expected: FAIL because `src/tui.ts` does not register any command, does not open a settings dialog, and still writes both flags together through `writeEnabledState()`.

- [ ] **Step 3: Implement the command-palette settings dialog in `src/tui.ts`**

Replace `src/tui.ts` with this implementation:

```ts
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";

import {
  readEnabledState,
  writePluginEnabledState,
  writeRoastEnabledState,
} from "./enabled-state.js";

const SETTINGS_TITLE = "Roast Tone settings";
const SETTINGS_VALUE = "roast-enabled";

const tui: TuiPlugin = async (api, _options, meta) => {
  const context = {
    directory: api.state.path.directory,
    worktree: api.state.path.worktree,
  };

  const showSettings = async () => {
    const state = await readEnabledState(context);

    api.ui.dialog.setSize("medium");
    api.ui.dialog.replace(() =>
      api.ui.DialogSelect({
        title: SETTINGS_TITLE,
        current: SETTINGS_VALUE,
        options: [
          {
            title: "Enabled",
            value: SETTINGS_VALUE,
            description: state.roastEnabled
              ? "Inject roast tone into future user messages"
              : "Do not inject roast tone into future user messages",
            footer: state.roastEnabled ? "ON" : "OFF",
          },
        ],
        onSelect: () => {
          void writeRoastEnabledState(context, !state.roastEnabled).then(() => {
            void showSettings();
          });
        },
      }),
    );
  };

  await writePluginEnabledState(context, true);

  api.command.register(() => [
    {
      title: SETTINGS_TITLE,
      value: `${meta.id}.settings`,
      category: "Plugin",
      onSelect() {
        void showSettings();
      },
    },
  ]);

  api.lifecycle.onDispose(async () => {
    const pluginStatus = api.plugins.list().find((plugin) => plugin.id === meta.id);
    const isPluginDisabled = pluginStatus?.enabled === false;

    if (isPluginDisabled) {
      await writePluginEnabledState(context, false);
    }
  });
};

const tuiModule: TuiPluginModule = {
  tui,
};

export default tuiModule;
```

- [ ] **Step 4: Update the test helper API to support commands and dialogs**

Extend `createApi()` in `test/tui.test.ts` with this shape so the new tests can inspect commands and trigger the dialog:

```ts
const createApi = (context: EnabledStateContext, initialPlugins: PluginStatus[] = []) => {
  const disposeHandlers: DisposeHandler[] = [];
  const commandCallbacks: Array<() => Command[]> = [];
  let dialogSelectProps: DialogSelectProps | undefined;
  let plugins = initialPlugins;
  const flushAsyncWork = () => new Promise<void>((resolve) => setImmediate(resolve));

  return {
    api: {
      state: {
        path: {
          directory: context.directory,
          worktree: context.worktree,
        },
      },
      command: {
        register: (cb: () => Command[]) => {
          commandCallbacks.push(cb);
          return () => {
            const index = commandCallbacks.indexOf(cb);
            if (index >= 0) {
              commandCallbacks.splice(index, 1);
            }
          };
        },
      },
      ui: {
        DialogSelect: (props: DialogSelectProps) => {
          dialogSelectProps = props;
          return null;
        },
        dialog: {
          setSize: () => {},
          replace: (render: () => unknown) => {
            render();
          },
        },
      },
      plugins: {
        list: () => plugins,
      },
      lifecycle: {
        signal: new AbortController().signal,
        onDispose: (handler: DisposeHandler) => {
          disposeHandlers.push(handler);

          return () => {
            const index = disposeHandlers.indexOf(handler);
            if (index >= 0) {
              disposeHandlers.splice(index, 1);
            }
          };
        },
      },
    },
    commands: () => commandCallbacks.flatMap((cb) => cb()),
    commandByTitle: (title: string) => commandCallbacks.flatMap((cb) => cb()).find((item) => item.title === title),
    openCommand: async (title: string) => {
      const command = commandCallbacks.flatMap((cb) => cb()).find((item) => item.title === title);
      if (!command?.onSelect) {
        throw new Error(`command not found: ${title}`);
      }
      await command.onSelect();
      await flushAsyncWork();
    },
    selectDialogOption: async (value: string) => {
      const option = dialogSelectProps?.options.find((item) => item.value === value);
      if (!option) {
        throw new Error(`dialog option not found: ${value}`);
      }
      await dialogSelectProps?.onSelect?.({ title: option.title, value: option.value });
      await flushAsyncWork();
      await flushAsyncWork();
    },
    setPlugins: (nextPlugins: PluginStatus[]) => {
      plugins = nextPlugins;
    },
    dispose: async () => {
      for (const handler of disposeHandlers) {
        await handler();
      }
    },
  };
};
```

- [ ] **Step 5: Run the targeted TUI tests to verify they pass**

Run:

```bash
npm test -- test/tui.test.ts
```

Expected: PASS, including the new command registration test and the state-preserving dialog toggle behavior.

- [ ] **Step 6: Commit the TUI settings work**

```bash
git add src/tui.ts test/tui.test.ts
git commit -m "feat: add roast tone settings dialog"
```

## Task 3: Update docs and verify the full feature

**Files:**
- Modify: `README.md:27-45`
- Verify: `test/enabled-state.test.ts`
- Verify: `test/server.test.ts`
- Verify: `test/tui.test.ts`

- [ ] **Step 1: Update the README to describe both controls clearly**

Replace the current enable/disable section in `README.md` with this text:

```md
## Enable or disable in OpenCode

This plugin now has two TUI control surfaces:

- **Plugins dialog**: turns the whole plugin integration on or off.
- **`Roast Tone settings` command**: keeps the plugin loaded, but toggles whether roast tone is injected into future requests.

Open `Roast Tone settings` from the command palette to flip the feature-level toggle.

- **Plugin enabled + Roast Tone enabled:** future user messages get the roast-tone instruction.
- **Plugin enabled + Roast Tone disabled:** the plugin stays installed, but future user messages are sent without the roast-tone instruction.
- **Plugin disabled:** OpenCode stops applying the roast-tone behavior entirely.

The state is persisted using the same config-root resolution as the runtime state file, so the toggle survives restarts.
```

- [ ] **Step 2: Run the focused regression suite**

Run:

```bash
npm test -- test/enabled-state.test.ts test/server.test.ts test/tui.test.ts
```

Expected: PASS for all three test files.

- [ ] **Step 3: Run the full test suite**

Run:

```bash
npm test
```

Expected: PASS for the complete Vitest suite.

- [ ] **Step 4: Run the production build**

Run:

```bash
npm run build
```

Expected: PASS with `dist/server.js` and `dist/tui.js` emitted successfully and no TypeScript errors.

- [ ] **Step 5: Commit the docs and final verification state**

```bash
git add README.md
git commit -m "docs: describe roast tone tui controls"
```

## Self-review checklist

- Spec coverage:
  - Dual-state persistence: Task 1
  - Effective server gating: Task 1
  - Command-palette settings panel: Task 2
  - Preserve built-in Plugins behavior: Task 2
  - README / user guidance: Task 3
- Placeholder scan:
  - No `TODO`, `TBD`, or unnamed “handle this later” steps remain.
- Type consistency:
  - State type is consistently `pluginEnabled` / `roastEnabled`.
  - Effective state helper is consistently named `readEffectiveEnabledState`.
  - Granular writers are consistently named `writePluginEnabledState` and `writeRoastEnabledState`.
