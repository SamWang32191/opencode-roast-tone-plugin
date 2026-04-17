import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";

import {
  readEnabledState,
  writePluginEnabledState,
  writeRoastEnabledState,
} from "./enabled-state.js";

const SETTINGS_COMMAND_VALUE = "roast-tone-settings";
const ROAST_ENABLED_OPTION_VALUE = "roast-enabled";

const tui: TuiPlugin = async (api, _options, meta) => {
  const context = {
    directory: api.state.path.directory,
    worktree: api.state.path.worktree,
  };

  const showSettings = async () => {
    const state = await readEnabledState(context);

    api.ui.dialog.replace(() =>
      api.ui.DialogSelect<string>({
        title: "Roast Tone settings",
        current: state.roastEnabled ? ROAST_ENABLED_OPTION_VALUE : undefined,
        options: [
          {
            title: "Enabled",
            value: ROAST_ENABLED_OPTION_VALUE,
            description: state.roastEnabled ? "On" : "Off",
          },
        ],
        onSelect: async (option) => {
          if (option.value !== ROAST_ENABLED_OPTION_VALUE) {
            return;
          }

          await writeRoastEnabledState(context, !state.roastEnabled);
          await showSettings();
        },
      }),
    );
  };

  await writePluginEnabledState(context, true);

  const unregisterCommands = api.command.register(() => [
    {
      title: "Roast Tone settings",
      value: SETTINGS_COMMAND_VALUE,
      onSelect: showSettings,
    },
  ]);

  api.lifecycle.onDispose(async () => {
    unregisterCommands();

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
