/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { createSignal } from "solid-js";

import {
  readEnabledStateResult,
  type ReadWarning,
  writePluginEnabledState,
  writeRoastEnabledState,
} from "./enabled-state.js";
import { SettingsDialog, type Field, type SettingsState } from "./settings-dialog.js";

const SETTINGS_COMMAND_VALUE = "roast-tone-settings";
const PLUGIN_COMMAND_CATEGORY = "Plugin";
const SETTINGS_DESCRIPTION = "Enable or disable roast tone without disabling the plugin";

const warningMessages: Record<ReadWarning, string> = {
  "invalid-file": "Settings file is invalid. Showing fallback values.",
  "unreadable-file": "Settings file couldn't be read. Showing fallback values.",
  "partial-invalid-fields": "Some settings are invalid. Showing fallback values for affected settings.",
};

const SAVE_ERROR_TOAST = {
  variant: "error" as const,
  title: "Couldn't save setting",
  message: "Failed to update Tone enabled.",
};

const tui: TuiPlugin = async (api, _options, meta) => {
  const context = {
    directory: api.state.path.directory,
    worktree: api.state.path.worktree,
  };

  const [value, setValue] = createSignal<SettingsState>({ roastEnabled: true });
  const [savingField, setSavingField] = createSignal<Field | undefined>(undefined);

  const flip = async (field: Field) => {
    if (savingField()) {
      return;
    }

    if (field !== "roastEnabled") {
      return;
    }

    const previous = value();
    const next = !previous.roastEnabled;

    setValue({ roastEnabled: next });
    setSavingField(field);

    try {
      await writeRoastEnabledState(context, next);
    } catch {
      setValue(previous);
      api.ui.toast(SAVE_ERROR_TOAST);
    } finally {
      setSavingField(undefined);
    }
  };

  const showSettings = async () => {
    const result = await readEnabledStateResult(context);

    setValue({ roastEnabled: result.state.roastEnabled });
    setSavingField(undefined);
    api.ui.dialog.setSize("medium");
    api.ui.dialog.replace(() => (
      <SettingsDialog api={api} value={value} savingField={savingField} flip={flip} />
    ));

    if (result.warning) {
      api.ui.toast({
        variant: "warning",
        title: "Settings issue detected",
        message: warningMessages[result.warning],
      });
    }
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
