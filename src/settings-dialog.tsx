/** @jsxImportSource @opentui/solid */
import { useKeyboard } from "@opentui/solid";
import type { TuiPlugin } from "@opencode-ai/plugin/tui";
import { createEffect, createMemo, createSignal } from "solid-js";

import { TONE_IDS, getToneDefinition, isToneId, type ToneId } from "./tone.js";

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
  const [current, setCurrent] = createSignal<DialogValue | undefined>("roastEnabled");
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

    setCurrent(visible[0]?.key);
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
