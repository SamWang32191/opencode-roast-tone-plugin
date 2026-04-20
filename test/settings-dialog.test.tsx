/** @jsxImportSource @opentui/solid */
import type { TuiDialogSelectProps } from "@opencode-ai/plugin/tui";
import { createRoot, createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SettingsDialog, type Field, type SettingsState } from "../src/settings-dialog.js";
import type { ToneId } from "../src/tone.js";

type KeyboardEventLike = {
  name: string;
  preventDefault: ReturnType<typeof vi.fn>;
  stopPropagation: ReturnType<typeof vi.fn>;
};

let lastKeyboardHandler: ((event: KeyboardEventLike) => void) | undefined;

vi.mock("@opentui/solid", async () => {
  return {
    createComponent: (component: (props: unknown) => unknown, props: unknown) => {
      return component(props);
    },
    createElement: (type: string) => ({ type, props: {}, children: [] as unknown[] }),
    createTextNode: (value: string) => value,
    effect: (fn: (state: { e: unknown; t: unknown }) => { e: unknown; t: unknown }, state: { e: unknown; t: unknown }) => {
      return fn(state);
    },
    insert: (parent: { children: unknown[] }, child: unknown) => {
      parent.children.push(child);
    },
    insertNode: (parent: { children: unknown[] }, child: unknown) => {
      parent.children.push(child);
    },
    setProp: (target: { props: Record<string, unknown> }, key: string, value: unknown) => {
      target.props[key] = value;
      return value;
    },
    memo: (value: unknown) => value,
    useKeyboard: (handler: (event: KeyboardEventLike) => void) => {
      lastKeyboardHandler = handler;
    },
  };
});

type DialogValue = Field | ToneId;

let lastDialogProps: TuiDialogSelectProps<DialogValue> | undefined;

const DialogSelect = vi.fn((props: TuiDialogSelectProps<DialogValue>) => {
  lastDialogProps = props;
  return props as never;
});

const mountDialog = (options?: {
  initialValue?: SettingsState;
  initialSavingField?: Field | undefined;
  flip?: (key: "roastEnabled") => void | Promise<void>;
  selectTone?: (toneId: ToneId) => void | Promise<void>;
}) => {
  const [value, setValue] = createSignal<SettingsState>(
    options?.initialValue ?? { roastEnabled: true, activeTone: "roast" },
  );
  const [savingField, setSavingField] = createSignal<Field | undefined>(options?.initialSavingField);
  const flip = vi.fn(options?.flip ?? (() => {
    setValue((state) => ({ ...state, roastEnabled: !state.roastEnabled }));
  }));
  const selectTone = vi.fn(options?.selectTone ?? ((toneId: ToneId) => {
    setValue((state) => ({ ...state, activeTone: toneId }));
  }));

  let dispose!: () => void;

  createRoot((nextDispose) => {
    dispose = nextDispose;

    return (
      <SettingsDialog
        api={{
          ui: { DialogSelect },
          theme: { current: { text: "text", textMuted: "muted" } },
        } as never}
        value={value}
        savingField={savingField}
        flip={flip}
        selectTone={selectTone}
      />
    );
  });

  return {
    dispose,
    flip,
    selectTone,
    setValue,
    setSavingField,
    dialog: () => {
      if (!lastDialogProps) {
        throw new Error("Expected DialogSelect to be rendered");
      }

      return lastDialogProps;
    },
  };
};

afterEach(() => {
  lastKeyboardHandler = undefined;
  lastDialogProps = undefined;
  vi.clearAllMocks();
});

describe("SettingsDialog", () => {
  it("renders both Tone enabled and Active tone rows", () => {
    const dialog = mountDialog({
      initialValue: { roastEnabled: true, activeTone: "roast" },
    });

    expect(dialog.dialog()).toMatchObject({
      title: "Roast Tone settings",
      placeholder: "Filter settings",
      current: "roastEnabled",
    });
    expect(dialog.dialog().options).toEqual([
      expect.objectContaining({
        title: "Tone enabled",
        value: "roastEnabled",
        description: "Apply roast tone to future messages.",
        category: "Tone",
        footer: "ON",
      }),
      expect.objectContaining({
        title: "Active tone",
        value: "activeTone",
        description: "Choose which preset to inject.",
        category: "Tone",
        footer: "Roast",
      }),
    ]);

    dialog.dispose();
  });

  it("routes Enter through DialogSelect onSelect", async () => {
    const dialog = mountDialog();

    await dialog.dialog().onSelect?.(dialog.dialog().options[0]!);

    expect(dialog.flip).toHaveBeenCalledWith("roastEnabled");

    dialog.dispose();
  });

  it("opens the tone picker when Active tone is selected", async () => {
    const dialog = mountDialog({
      initialValue: { roastEnabled: false, activeTone: "mentor" },
    });

    await dialog.dialog().onSelect?.(dialog.dialog().options[1]!);

    expect(dialog.dialog()).toMatchObject({
      title: "Select tone",
      current: "mentor",
    });
    expect(dialog.dialog().options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "Roast", value: "roast" }),
        expect.objectContaining({ title: "Dry", value: "dry" }),
        expect.objectContaining({ title: "Deadpan", value: "deadpan" }),
        expect.objectContaining({ title: "Mentor", value: "mentor" }),
      ]),
    );

    dialog.dispose();
  });

  it("selects a tone from the tone picker", async () => {
    const dialog = mountDialog();

    await dialog.dialog().onSelect?.(dialog.dialog().options[1]!);
    await dialog.dialog().onSelect?.(
      dialog.dialog().options.find((option) => option.value === "deadpan")!,
    );

    expect(dialog.selectTone).toHaveBeenCalledWith("deadpan");

    dialog.dispose();
  });

  it("routes Space and arrow keys through useKeyboard", () => {
    const dialog = mountDialog();

    const event = {
      name: "space",
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } satisfies KeyboardEventLike;

    lastKeyboardHandler?.(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    expect(dialog.flip).toHaveBeenCalledWith("roastEnabled");

    event.name = "left";
    lastKeyboardHandler?.(event);
    event.name = "right";
    lastKeyboardHandler?.(event);

    expect(dialog.flip).toHaveBeenNthCalledWith(2, "roastEnabled");
    expect(dialog.flip).toHaveBeenNthCalledWith(3, "roastEnabled");

    dialog.dispose();
  });

  it("shows Saving... and disables all rows while a save is in flight", () => {
    const dialog = mountDialog({ initialSavingField: "roastEnabled" });

    expect(dialog.dialog().options).toEqual([
      expect.objectContaining({
        value: "roastEnabled",
        footer: "Saving...",
        disabled: true,
      }),
      expect.objectContaining({
        value: "activeTone",
        footer: "Roast",
        disabled: true,
      }),
    ]);

    dialog.dispose();
  });

  it("clears current when filtering hides every row", () => {
    const dialog = mountDialog();

    dialog.dialog().onFilter?.("zzz");

    expect(dialog.dialog().current).toBeUndefined();
    expect(dialog.dialog().options).toEqual([]);

    const event = {
      name: "space",
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } satisfies KeyboardEventLike;

    lastKeyboardHandler?.(event);

    expect(dialog.flip).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();

    dialog.dispose();
  });
});
