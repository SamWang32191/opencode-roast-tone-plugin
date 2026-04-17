import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

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
  return JSON.parse(contents) as { enabled: boolean };
};

const createApi = (context: EnabledStateContext, initialPlugins: PluginStatus[] = []) => {
  const disposeHandlers: DisposeHandler[] = [];
  let plugins = initialPlugins;

  return {
    api: {
      state: {
        path: {
          directory: context.directory,
          worktree: context.worktree,
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
  it("writes enabled=true when the plugin loads", async () => {
    const configDir = await trackTempDir("tui-config-");
    const worktree = await trackTempDir("tui-worktree-");
    const context = { directory: worktree, worktree };

    process.env.OPENCODE_CONFIG_DIR = configDir;

    const { api } = createApi(context, [{ id: TEST_PLUGIN_ID, enabled: true, active: true }]);

    await tuiModule.tui(api as never, undefined, { id: TEST_PLUGIN_ID } as never);

    await expect(readStateFile(context)).resolves.toEqual({ enabled: true });
  });

  it("writes enabled=false when dispose happens after the plugin is disabled", async () => {
    const configDir = await trackTempDir("tui-config-");
    const worktree = await trackTempDir("tui-worktree-");
    const context = { directory: worktree, worktree };

    process.env.OPENCODE_CONFIG_DIR = configDir;

    const plugin = createApi(context, [{ id: TEST_PLUGIN_ID, enabled: true, active: true }]);

    await tuiModule.tui(plugin.api as never, undefined, { id: TEST_PLUGIN_ID } as never);
    plugin.setPlugins([{ id: TEST_PLUGIN_ID, enabled: false, active: false }]);
    await plugin.dispose();

    await expect(readStateFile(context)).resolves.toEqual({ enabled: false });
  });

  it("does not overwrite the state to false when dispose happens but the plugin remains enabled", async () => {
    const configDir = await trackTempDir("tui-config-");
    const worktree = await trackTempDir("tui-worktree-");
    const context = { directory: worktree, worktree };

    process.env.OPENCODE_CONFIG_DIR = configDir;

    const plugin = createApi(context, [{ id: TEST_PLUGIN_ID, enabled: true, active: true }]);

    await tuiModule.tui(plugin.api as never, undefined, { id: TEST_PLUGIN_ID } as never);
    plugin.setPlugins([{ id: TEST_PLUGIN_ID, enabled: true, active: false }]);
    await plugin.dispose();

    await expect(readStateFile(context)).resolves.toEqual({ enabled: true });
  });
});
