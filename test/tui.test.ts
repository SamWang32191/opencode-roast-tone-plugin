import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as enabledState from "../src/enabled-state.js";
import { resolveStateFile } from "../src/enabled-state.js";

vi.mock("@opentui/solid/jsx-runtime", () => ({
  Fragment: Symbol.for("fragment"),
  jsx: (type: unknown, props: Record<string, unknown>) => {
    return typeof type === "function" ? type(props) : { type, props };
  },
  jsxs: (type: unknown, props: Record<string, unknown>) => {
    return typeof type === "function" ? type(props) : { type, props };
  },
}));

vi.mock("@opentui/solid", () => ({
  createComponent: (component: (props: Record<string, unknown>) => unknown, props: Record<string, unknown>) => {
    return component(props);
  },
}));

vi.mock("../src/settings-dialog.js", () => ({
  SettingsDialog: (props: {
    api: {
      ui: {
        DialogSelect: (dialogProps: DialogSelectProps) => DialogSelectProps;
      };
    };
    value: () => { roastEnabled: boolean };
    savingField: () => string | undefined;
    flip: (field: "roastEnabled") => void | Promise<void>;
  }) => {
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
          footer: props.savingField() === "roastEnabled" ? "Saving..." : props.value().roastEnabled ? "ON" : "OFF",
          disabled: props.savingField() !== undefined,
        },
      ],
      onSelect: async (option) => {
        if (option.value !== "roastEnabled") {
          return;
        }

        await props.flip("roastEnabled");
      },
    });
  },
}));

import tuiModule from "../src/tui.js";

const originalOpencodeConfigDir = process.env.OPENCODE_CONFIG_DIR;
const tempDirs = new Set<string>();
const TEST_PLUGIN_ID = "opencode-roast-tone-plugin";

type EnabledStateContext = {
  directory: string;
  worktree: string;
};

type PluginStatus = {
  id: string;
  enabled: boolean;
  active: boolean;
};

type DisposeHandler = () => void | Promise<void>;

type RegisteredCommand = {
  title: string;
  value: string;
  description?: string;
  slash?: {
    name: string;
    aliases?: string[];
  };
  onSelect?: () => void | Promise<void>;
};

type DialogSelectOption = {
  title: string;
  value: string;
  description?: string;
  category?: string;
  footer?: string;
  disabled?: boolean;
};

type DialogSelectProps = {
  title: string;
  placeholder?: string;
  current?: string;
  options: DialogSelectOption[];
  onFilter?: (query: string) => void;
  onMove?: (option: DialogSelectOption) => void;
  onSelect?: (option: DialogSelectOption) => void | Promise<void>;
};

const trackTempDir = async (prefix: string) => {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.add(directory);
  return directory;
};

const restoreEnv = () => {
  if (originalOpencodeConfigDir === undefined) {
    delete process.env.OPENCODE_CONFIG_DIR;
    return;
  }

  process.env.OPENCODE_CONFIG_DIR = originalOpencodeConfigDir;
};

const readStateFile = async (context: EnabledStateContext) => {
  const contents = await readFile(resolveStateFile(context), "utf8");
  return JSON.parse(contents) as { pluginEnabled: boolean; roastEnabled: boolean };
};

const writeRawStateFile = async (
  context: EnabledStateContext,
  state: { pluginEnabled: boolean; roastEnabled: boolean },
) => {
  const stateFile = resolveStateFile(context);

  await mkdir(dirname(stateFile), { recursive: true });
  await writeFile(stateFile, JSON.stringify(state), "utf8");
};

const createApi = (context: EnabledStateContext, initialPlugins: PluginStatus[] = []) => {
  const disposeHandlers: DisposeHandler[] = [];
  let plugins = initialPlugins;
  let commands: RegisteredCommand[] = [];
  let dialogRender: (() => unknown) | undefined;

  const DialogSelect = vi.fn((props: DialogSelectProps) => props);
  const dialogReplace = vi.fn((render: () => unknown) => {
    dialogRender = render;
  });

  return {
    api: {
      state: {
        path: {
          directory: context.directory,
          worktree: context.worktree,
        },
      },
      command: {
        register: (cb: () => RegisteredCommand[]) => {
          commands = cb();

          return () => {
            commands = [];
          };
        },
        trigger: vi.fn(),
        show: vi.fn(),
      },
      ui: {
        Dialog: vi.fn(),
        DialogAlert: vi.fn(),
        DialogConfirm: vi.fn(),
        DialogPrompt: vi.fn(),
        DialogSelect,
        Slot: vi.fn(),
        Prompt: vi.fn(),
        toast: vi.fn(),
        dialog: {
          replace: dialogReplace,
          clear: vi.fn(),
          setSize: vi.fn(),
          size: "medium" as const,
          depth: 0,
          open: false,
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
    setPlugins: (nextPlugins: PluginStatus[]) => {
      plugins = nextPlugins;
    },
    commands: () => commands,
    renderDialog: () => {
      if (!dialogRender) {
        throw new Error("Expected dialog to be rendered");
      }

      dialogRender();

      const call = DialogSelect.mock.calls[DialogSelect.mock.calls.length - 1]?.[0];

      if (!call) {
        throw new Error("Expected DialogSelect to be rendered");
      }

      return call as DialogSelectProps;
    },
    dialogReplace,
    DialogSelect,
    dispose: async () => {
      for (const handler of disposeHandlers) {
        await handler();
      }
    },
  };
};

afterEach(async () => {
  restoreEnv();

  await Promise.all(
    [...tempDirs].map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );

  tempDirs.clear();
});

describe("tui entrypoint", () => {
  it("registers the Roast Tone settings command with a clarifying description", async () => {
    const configDir = await trackTempDir("tui-config-");
    const worktree = await trackTempDir("tui-worktree-");
    const context = { directory: worktree, worktree };

    process.env.OPENCODE_CONFIG_DIR = configDir;

    const plugin = createApi(context, [{ id: TEST_PLUGIN_ID, enabled: true, active: true }]);

    await tuiModule.tui(plugin.api as never, undefined, { id: TEST_PLUGIN_ID } as never);

    expect(plugin.commands()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Roast Tone settings",
          description: "Enable or disable roast tone without disabling the plugin",
          value: "roast-tone-settings",
          category: "Plugin",
        }),
      ]),
    );
  });

  it("writes pluginEnabled=true and roastEnabled=true when the plugin loads with no prior state", async () => {
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

  it("preserves roastEnabled when the plugin loads", async () => {
    const configDir = await trackTempDir("tui-config-");
    const worktree = await trackTempDir("tui-worktree-");
    const context = { directory: worktree, worktree };

    process.env.OPENCODE_CONFIG_DIR = configDir;
    await writeRawStateFile(context, { pluginEnabled: false, roastEnabled: false });

    const { api } = createApi(context, [{ id: TEST_PLUGIN_ID, enabled: true, active: true }]);

    await tuiModule.tui(api as never, undefined, { id: TEST_PLUGIN_ID } as never);

    await expect(readStateFile(context)).resolves.toEqual({
      pluginEnabled: true,
      roastEnabled: false,
    });
  });

  it("opens the TSX settings dialog at medium size", async () => {
    const configDir = await trackTempDir("tui-config-");
    const worktree = await trackTempDir("tui-worktree-");
    const context = { directory: worktree, worktree };

    process.env.OPENCODE_CONFIG_DIR = configDir;

    const plugin = createApi(context, [{ id: TEST_PLUGIN_ID, enabled: true, active: true }]);

    await tuiModule.tui(plugin.api as never, undefined, { id: TEST_PLUGIN_ID } as never);

    const command = plugin.commands().find((entry) => entry.title === "Roast Tone settings");

    await command?.onSelect?.();

    expect(plugin.api.ui.dialog.setSize).toHaveBeenCalledWith("medium");
    expect(plugin.renderDialog()).toMatchObject({
      title: "Roast Tone settings",
      placeholder: "Filter settings",
      current: "roastEnabled",
    });
    expect(plugin.renderDialog().options).toEqual([
      expect.objectContaining({
        title: "Tone enabled",
        category: "Tone",
        footer: "ON",
      }),
    ]);
  });

  it("does not show a historical warning when startup self-heals a malformed state file", async () => {
    const configDir = await trackTempDir("tui-config-");
    const worktree = await trackTempDir("tui-worktree-");
    const context = { directory: worktree, worktree };

    process.env.OPENCODE_CONFIG_DIR = configDir;
    await writeFile(resolveStateFile(context), "not-json-at-all", "utf8").catch(async () => {
      await mkdir(dirname(resolveStateFile(context)), { recursive: true });
      await writeFile(resolveStateFile(context), "not-json-at-all", "utf8");
    });

    const plugin = createApi(context, [{ id: TEST_PLUGIN_ID, enabled: true, active: true }]);

    await tuiModule.tui(plugin.api as never, undefined, { id: TEST_PLUGIN_ID } as never);

    const command = plugin.commands().find((entry) => entry.title === "Roast Tone settings");
    await command?.onSelect?.();
    plugin.renderDialog();

    expect(plugin.dialogReplace).toHaveBeenCalledTimes(1);
    expect(plugin.api.ui.toast).not.toHaveBeenCalledWith({
      variant: "warning",
      title: "Settings issue detected",
      message: "Settings file is invalid. Showing fallback values.",
    });
  });

  it("shows a warning toast after rendering when the current settings read is still unreadable", async () => {
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
    plugin.renderDialog();

    expect(plugin.dialogReplace).toHaveBeenCalledTimes(1);
    expect(plugin.api.ui.toast).toHaveBeenCalledWith({
      variant: "warning",
      title: "Settings issue detected",
      message: "Settings file couldn't be read. Showing fallback values.",
    });
  });

  it("rolls back and shows an error toast when saving roastEnabled fails", async () => {
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
    await dialog.onSelect?.(dialog.options[0]!);

    expect(plugin.renderDialog().options).toEqual([
      expect.objectContaining({
        value: "roastEnabled",
        footer: "ON",
      }),
    ]);
    expect(plugin.api.ui.toast).toHaveBeenCalledWith({
      variant: "error",
      title: "Couldn't save setting",
      message: "Failed to update Tone enabled.",
    });
  });

  it("preserves the optimistic value and dialog lock when reopened during an in-flight save", async () => {
    const configDir = await trackTempDir("tui-config-");
    const worktree = await trackTempDir("tui-worktree-");
    const context = { directory: worktree, worktree };

    process.env.OPENCODE_CONFIG_DIR = configDir;

    let resolveWrite!: () => void;
    const writePending = new Promise<void>((resolve) => {
      resolveWrite = resolve;
    });
    const originalWriteRoastEnabledState = enabledState.writeRoastEnabledState;
    const writeRoastEnabledState = vi
      .spyOn(enabledState, "writeRoastEnabledState")
      .mockImplementation(async (nextContext, roastEnabled) => {
        expect(nextContext).toEqual(context);
        expect(roastEnabled).toBe(false);
        await writePending;
        await originalWriteRoastEnabledState(nextContext, roastEnabled);
      });

    const plugin = createApi(context, [{ id: TEST_PLUGIN_ID, enabled: true, active: true }]);

    await tuiModule.tui(plugin.api as never, undefined, { id: TEST_PLUGIN_ID } as never);

    const command = plugin.commands().find((entry) => entry.title === "Roast Tone settings");
    await command?.onSelect?.();

    const firstDialog = plugin.renderDialog();
    const savePromise = firstDialog.onSelect?.(firstDialog.options[0]!);

    await Promise.resolve();

    expect(plugin.renderDialog().options).toEqual([
      expect.objectContaining({
        value: "roastEnabled",
        footer: "Saving...",
        disabled: true,
      }),
    ]);

    await command?.onSelect?.();

    expect(plugin.renderDialog().options).toEqual([
      expect.objectContaining({
        value: "roastEnabled",
        footer: "Saving...",
        disabled: true,
      }),
    ]);
    expect(writeRoastEnabledState).toHaveBeenCalledTimes(1);

    resolveWrite();
    await savePromise;

    expect(plugin.renderDialog().options).toEqual([
      expect.objectContaining({
        value: "roastEnabled",
        footer: "OFF",
        disabled: false,
      }),
    ]);
    await expect(readStateFile(context)).resolves.toEqual({
      pluginEnabled: true,
      roastEnabled: false,
    });

    writeRoastEnabledState.mockRestore();
  });

  it("only writes pluginEnabled=false when dispose happens after the plugin is disabled", async () => {
    const configDir = await trackTempDir("tui-config-");
    const worktree = await trackTempDir("tui-worktree-");
    const context = { directory: worktree, worktree };

    process.env.OPENCODE_CONFIG_DIR = configDir;
    await writeRawStateFile(context, { pluginEnabled: true, roastEnabled: true });

    const plugin = createApi(context, [{ id: TEST_PLUGIN_ID, enabled: true, active: true }]);

    await tuiModule.tui(plugin.api as never, undefined, { id: TEST_PLUGIN_ID } as never);
    plugin.setPlugins([{ id: TEST_PLUGIN_ID, enabled: false, active: false }]);
    await plugin.dispose();

    await expect(readStateFile(context)).resolves.toEqual({
      pluginEnabled: false,
      roastEnabled: true,
    });
  });

  it("does not corrupt state when dispose happens but the plugin remains enabled", async () => {
    const configDir = await trackTempDir("tui-config-");
    const worktree = await trackTempDir("tui-worktree-");
    const context = { directory: worktree, worktree };

    process.env.OPENCODE_CONFIG_DIR = configDir;
    await writeRawStateFile(context, { pluginEnabled: true, roastEnabled: false });

    const plugin = createApi(context, [{ id: TEST_PLUGIN_ID, enabled: true, active: true }]);

    await tuiModule.tui(plugin.api as never, undefined, { id: TEST_PLUGIN_ID } as never);
    plugin.setPlugins([{ id: TEST_PLUGIN_ID, enabled: true, active: false }]);
    await plugin.dispose();

    await expect(readStateFile(context)).resolves.toEqual({
      pluginEnabled: true,
      roastEnabled: false,
    });
  });

  it("catches lifecycle write failures instead of rejecting startup or dispose", async () => {
    const blockedPath = join(await trackTempDir("tui-blocked-"), "blocked-file");
    const context = { directory: blockedPath, worktree: blockedPath };

    await writeFile(blockedPath, "", "utf8");
    process.env.OPENCODE_CONFIG_DIR = blockedPath;

    const plugin = createApi(context, [{ id: TEST_PLUGIN_ID, enabled: true, active: true }]);

    await expect(
      tuiModule.tui(plugin.api as never, undefined, { id: TEST_PLUGIN_ID } as never),
    ).resolves.toBeUndefined();

    plugin.setPlugins([{ id: TEST_PLUGIN_ID, enabled: false, active: false }]);

    await expect(plugin.dispose()).resolves.toBeUndefined();
  });
});
