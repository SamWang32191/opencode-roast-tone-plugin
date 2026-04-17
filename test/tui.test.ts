import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveStateFile } from "../src/enabled-state.js";
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
};

type DialogSelectProps = {
  title: string;
  current?: string;
  options: DialogSelectOption[];
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

      return dialogRender() as DialogSelectProps;
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
  it("registers the Roast Tone settings command in the command palette", async () => {
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
          value: "roast-tone-settings",
          category: "Plugin",
        }),
      ]),
    );
    expect(plugin.commands().find((command) => command.title === "Roast Tone settings")?.slash).toBe(
      undefined,
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

  it("opens the settings dialog and toggles roastEnabled", async () => {
    const configDir = await trackTempDir("tui-config-");
    const worktree = await trackTempDir("tui-worktree-");
    const context = { directory: worktree, worktree };

    process.env.OPENCODE_CONFIG_DIR = configDir;

    const plugin = createApi(context, [{ id: TEST_PLUGIN_ID, enabled: true, active: true }]);

    await tuiModule.tui(plugin.api as never, undefined, { id: TEST_PLUGIN_ID } as never);

    const command = plugin.commands().find((entry) => entry.title === "Roast Tone settings");

    expect(command).toBeDefined();

    await command?.onSelect?.();

    expect(plugin.dialogReplace).toHaveBeenCalledTimes(1);

    const dialog = plugin.renderDialog();

    expect(plugin.DialogSelect).toHaveBeenCalledTimes(1);
    expect(dialog.title).toBe("Roast Tone settings");
    expect(dialog.options).toEqual([
      expect.objectContaining({
        title: "Enabled",
        value: "roast-enabled",
      }),
    ]);

    await dialog.onSelect?.(dialog.options[0]!);

    await expect(readStateFile(context)).resolves.toEqual({
      pluginEnabled: true,
      roastEnabled: false,
    });
    expect(plugin.dialogReplace).toHaveBeenCalledTimes(2);
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
});
