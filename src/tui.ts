import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";

import { writeEnabledState } from "./enabled-state.js";

const tui: TuiPlugin = async (api, _options, meta) => {
  const context = {
    directory: api.state.path.directory,
    worktree: api.state.path.worktree,
  };

  await writeEnabledState(context, true);

  api.lifecycle.onDispose(async () => {
    const pluginStatus = api.plugins.list().find((plugin) => plugin.id === meta.id);
    const isPluginDisabled = pluginStatus?.enabled === false;

    if (isPluginDisabled) {
      await writeEnabledState(context, false);
    }
  });
};

const tuiModule: TuiPluginModule = {
  tui,
};

export default tuiModule;
