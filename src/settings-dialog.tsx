/** @jsxImportSource @opentui/solid */
import { useKeyboard } from "@opentui/solid";
import type { TuiPlugin } from "@opencode-ai/plugin/tui";
import { createEffect, createMemo, createSignal } from "solid-js";

import { TONE_IDS, getToneDefinition, type ToneId } from "./tone.js";

type Api = Parameters<TuiPlugin>[0];

export type ToggleField = "roastEnabled";
export type PickerField = "activeTone";
export type Field = ToggleField | PickerField;

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

const cycleTone = (activeTone: ToneId, direction: "left" | "right") => {
  const currentIndex = TONE_IDS.indexOf(activeTone);

  if (currentIndex < 0) {
    return activeTone;
  }

  const delta = direction === "left" ? -1 : 1;
  const nextIndex = (currentIndex + delta + TONE_IDS.length) % TONE_IDS.length;
  return TONE_IDS[nextIndex] ?? activeTone;
};

export const SettingsDialog = (props: {
  api: Api;
  value: () => SettingsState;
  savingField: () => Field | undefined;
  flip: (key: ToggleField) => void | Promise<void>;
  selectTone: (toneId: ToneId) => void | Promise<void>;
}) => {
  const [filterQuery, setFilterQuery] = createSignal("");
  const [current, setCurrent] = createSignal<Field | undefined>("roastEnabled");
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
    const visible = visibleRows();
    const nextCurrent = current();

    if (nextCurrent !== undefined && visible.some((row) => row.key === nextCurrent)) {
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

  useKeyboard((event) => {
    const activeField = current();

    if (!activeField || props.savingField()) {
      return;
    }

    if (activeField === "roastEnabled") {
      if (event.name === "space" || event.name === "left" || event.name === "right") {
        event.preventDefault();
        event.stopPropagation();
        void props.flip("roastEnabled");
      }

      return;
    }

    if (event.name === "left" || event.name === "right") {
      event.preventDefault();
      event.stopPropagation();
      void props.selectTone(cycleTone(props.value().activeTone, event.name));
      return;
    }

    if (event.name === "space") {
      event.preventDefault();
      event.stopPropagation();
    }
  });

  return (
    <box flexDirection="column">
      <props.api.ui.DialogSelect
        title="Roast Tone settings"
        placeholder="Filter settings"
        options={settingsOptions()}
        current={current()}
        onFilter={(query) => {
          setFilterQuery(query);
        }}
        onMove={(item) => {
          setCurrent(field(item.value));
        }}
        onSelect={async (item) => {
          const nextField = field(item.value);

          if (!nextField || props.savingField()) {
            return;
          }

          setCurrent(nextField);

          if (nextField === "roastEnabled") {
            await props.flip("roastEnabled");
            return;
          }
        }}
      />
      <box
        paddingRight={2}
        paddingLeft={4}
        flexDirection="column"
        paddingTop={1}
        paddingBottom={1}
        flexShrink={0}
      >
        <text>
          <span style={{ fg: theme().text }}>
            <b>toggle</b>{" "}
          </span>
          <span style={{ fg: theme().textMuted }}>
            Tone enabled: space enter left/right
          </span>
        </text>
        <text>
          <span style={{ fg: theme().text }}>
            <b>adjust</b>{" "}
          </span>
          <span style={{ fg: theme().textMuted }}>
            Active tone: left/right
          </span>
        </text>
      </box>
    </box>
  );
};
