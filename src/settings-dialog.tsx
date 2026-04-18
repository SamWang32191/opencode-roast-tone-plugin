/** @jsxImportSource @opentui/solid */
import { useKeyboard } from "@opentui/solid";
import type { TuiPlugin } from "@opencode-ai/plugin/tui";
import { createEffect, createMemo, createSignal } from "solid-js";

type Api = Parameters<TuiPlugin>[0];

export type ToggleField = "roastEnabled";
export type Field = ToggleField;

export type SettingsState = {
  roastEnabled: boolean;
};

type ToggleRow = {
  key: ToggleField;
  title: "Tone enabled";
  description: "Apply roast tone to future messages.";
  category: "Tone";
  kind: "toggle";
};

const rows: ToggleRow[] = [
  {
    key: "roastEnabled",
    title: "Tone enabled",
    description: "Apply roast tone to future messages.",
    category: "Tone",
    kind: "toggle",
  },
];

export const settingByField = Object.fromEntries(rows.map((row) => [row.key, row])) as Record<
  ToggleField,
  ToggleRow
>;

const field = (value: unknown): Field | undefined => {
  return value === "roastEnabled" ? value : undefined;
};

const status = (value: boolean) => {
  return value ? "ON" : "OFF";
};

export const SettingsDialog = (props: {
  api: Api;
  value: () => SettingsState;
  savingField: () => Field | undefined;
  flip: (key: ToggleField) => void | Promise<void>;
}) => {
  const [filterQuery, setFilterQuery] = createSignal("");
  const [current, setCurrent] = createSignal<Field | undefined>(rows[0]?.key);
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

    if (nextCurrent && visible.some((row) => row.key === nextCurrent)) {
      return;
    }

    setCurrent(visible[0]?.key);
  });

  const options = createMemo(() => {
    const value = props.value();
    const savingField = props.savingField();

    return visibleRows().map((row) => {
      const footer = savingField === row.key ? "Saving..." : status(value[row.key]);

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

    if (event.name === "space" || event.name === "left" || event.name === "right") {
      event.preventDefault();
      event.stopPropagation();
      void props.flip(activeField);
    }
  });

  return (
    <box flexDirection="column">
      <props.api.ui.DialogSelect
        title="Roast Tone settings"
        placeholder="Filter settings"
        options={options()}
        current={current()}
        onFilter={(query) => {
          setFilterQuery(query);
        }}
        onMove={(item) => {
          const next = field(item.value);

          if (!next) {
            return;
          }

          setCurrent(next);
        }}
        onSelect={async (item) => {
          const next = field(item.value);

          if (!next || props.savingField()) {
            return;
          }

          setCurrent(next);
          await props.flip(next);
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
            <b>toggle</b>{" "}
          </span>
          <span style={{ fg: theme().textMuted }}>space enter left/right</span>
        </text>
      </box>
    </box>
  );
};
