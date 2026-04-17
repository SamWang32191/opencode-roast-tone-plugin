import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";

import {
  readEnabledState,
  writePluginEnabledState,
  writeRoastEnabledState,
} from "./enabled-state.js";

const SETTINGS_COMMAND_VALUE = "roast-tone-settings";
const ROAST_ENABLED_OPTION_VALUE = "roast-enabled";
const ROAST_DISABLED_OPTION_VALUE = "roast-disabled";
const PLUGIN_COMMAND_CATEGORY = "Plugin";

const tui: TuiPlugin = async (api, _options, meta) => {
  const context = {
    directory: api.state.path.directory,
    worktree: api.state.path.worktree,
  };

  const showSettings = async () => {
    const state = await readEnabledState(context);

    api.ui.dialog.replace(() =>
      api.ui.DialogSelect<string>({
        title: "Roast Tone setting",
        current: state.roastEnabled ? ROAST_ENABLED_OPTION_VALUE : ROAST_DISABLED_OPTION_VALUE,
        options: [
          {
            title: "✅ Enabled",
            value: ROAST_ENABLED_OPTION_VALUE,
            description: "Roast tone is applied to every response.",
          },
          {
            title: "⏸ Disabled",
            value: ROAST_DISABLED_OPTION_VALUE,
            description: "Responses keep their normal tone.",
          },
        ],
        onSelect: async (option) => {
          const nextRoastEnabled =
            option.value === ROAST_ENABLED_OPTION_VALUE
              ? true
              : option.value === ROAST_DISABLED_OPTION_VALUE
                ? false
                : state.roastEnabled;

          if (nextRoastEnabled === state.roastEnabled) {
            return;
          }

          await writeRoastEnabledState(context, nextRoastEnabled);
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
      category: PLUGIN_COMMAND_CATEGORY,
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
