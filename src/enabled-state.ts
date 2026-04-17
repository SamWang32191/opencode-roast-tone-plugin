import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export type EnabledStateContext = {
  directory: string;
  worktree: string;
};

export type EnabledState = {
  pluginEnabled: boolean;
  roastEnabled: boolean;
};

export type ReadWarning = "invalid-file" | "unreadable-file" | "partial-invalid-fields";

export type ReadStateKind =
  | "missing"
  | "legacy"
  | "new-format-ok"
  | "invalid-file"
  | "unreadable-file"
  | "partial-invalid-fields";

export type ReadEnabledStateResult = {
  state: EnabledState;
  kind: ReadStateKind;
  warning?: ReadWarning;
  raw?: Record<string, unknown>;
};

type PersistedEnabledState = Record<string, unknown> & {
  enabled?: unknown;
  pluginEnabled?: unknown;
  roastEnabled?: unknown;
};

const STATE_FILE_PARTS = ["plugin-data", "opencode-roast-tone-plugin", "state.json"] as const;
const DEFAULT_ENABLED_STATE: EnabledState = {
  pluginEnabled: true,
  roastEnabled: true,
};

const isWithinDirectory = (child: string, parent: string) => {
  const relativePath = relative(parent, child);

  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
};

const findWorkspaceConfigRoot = ({ directory, worktree }: EnabledStateContext) => {
  const resolvedWorktree = resolve(worktree);
  let currentDirectory = resolve(directory);

  if (!isWithinDirectory(currentDirectory, resolvedWorktree)) {
    currentDirectory = resolvedWorktree;
  }

  while (true) {
    const candidate = join(currentDirectory, ".opencode");

    if (existsSync(candidate)) {
      return candidate;
    }

    if (currentDirectory === resolvedWorktree) {
      return undefined;
    }

    currentDirectory = dirname(currentDirectory);

    if (!isWithinDirectory(currentDirectory, resolvedWorktree)) {
      return undefined;
    }
  }
};

const resolveStateRoot = (context: EnabledStateContext) => {
  if (process.env.OPENCODE_CONFIG_DIR) {
    return process.env.OPENCODE_CONFIG_DIR;
  }

  const workspaceConfigRoot = findWorkspaceConfigRoot(context);

  if (workspaceConfigRoot) {
    return workspaceConfigRoot;
  }

  if (process.env.XDG_CONFIG_HOME) {
    return join(process.env.XDG_CONFIG_HOME, "opencode");
  }

  return join(homedir(), ".config", "opencode");
};

export const resolveStateFile = (context: EnabledStateContext) => {
  return join(resolveStateRoot(context), ...STATE_FILE_PARTS);
};

const isFileNotFoundError = (error: unknown): error is NodeJS.ErrnoException => {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
};

const createDefaultEnabledState = (): EnabledState => ({
  pluginEnabled: DEFAULT_ENABLED_STATE.pluginEnabled,
  roastEnabled: DEFAULT_ENABLED_STATE.roastEnabled,
});

const isPersistedEnabledState = (value: unknown): value is PersistedEnabledState => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const hasNewEnabledStateFields = (state: PersistedEnabledState) => {
  return "pluginEnabled" in state || "roastEnabled" in state;
};

const parsePersistedEnabledState = (contents: string): PersistedEnabledState | undefined => {
  const parsed = JSON.parse(contents) as unknown;

  return isPersistedEnabledState(parsed) ? parsed : undefined;
};

const createResultFromParsedState = (raw: PersistedEnabledState): ReadEnabledStateResult => {
  if (hasNewEnabledStateFields(raw)) {
    const pluginEnabledValid = typeof raw.pluginEnabled === "boolean";
    const roastEnabledValid = typeof raw.roastEnabled === "boolean";
    const state = {
      pluginEnabled: pluginEnabledValid
        ? (raw.pluginEnabled as boolean)
        : DEFAULT_ENABLED_STATE.pluginEnabled,
      roastEnabled: roastEnabledValid
        ? (raw.roastEnabled as boolean)
        : DEFAULT_ENABLED_STATE.roastEnabled,
    } satisfies EnabledState;

    if (pluginEnabledValid && roastEnabledValid) {
      return { state, kind: "new-format-ok", raw };
    }

    return {
      state,
      kind: "partial-invalid-fields",
      warning: "partial-invalid-fields",
      raw,
    };
  }

  if (typeof raw.enabled === "boolean") {
      return {
        state: {
          pluginEnabled: raw.enabled as boolean,
          roastEnabled: raw.enabled as boolean,
        },
        kind: "legacy",
        raw,
      };
  }

  return {
    state: createDefaultEnabledState(),
    kind: "invalid-file",
    warning: "invalid-file",
  };
};

export const readEnabledStateResult = async (
  context: EnabledStateContext,
): Promise<ReadEnabledStateResult> => {
  const stateFile = resolveStateFile(context);

  try {
    const contents = await readFile(stateFile, "utf8");

    try {
      const parsed = parsePersistedEnabledState(contents);

      if (!parsed) {
        return {
          state: createDefaultEnabledState(),
          kind: "invalid-file",
          warning: "invalid-file",
        };
      }

      return createResultFromParsedState(parsed);
    } catch (error) {
      if (error instanceof SyntaxError) {
        return {
          state: createDefaultEnabledState(),
          kind: "invalid-file",
          warning: "invalid-file",
        };
      }

      throw error;
    }
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return {
        state: createDefaultEnabledState(),
        kind: "missing",
      };
    }

    return {
      state: createDefaultEnabledState(),
      kind: "unreadable-file",
      warning: "unreadable-file",
    };
  }
};

export const readEnabledState = async (context: EnabledStateContext) => {
  return (await readEnabledStateResult(context)).state;
};

export const readEffectiveEnabledState = async (context: EnabledStateContext) => {
  const state = await readEnabledState(context);

  return state.pluginEnabled && state.roastEnabled;
};

const writeStateFile = async (context: EnabledStateContext, state: Record<string, unknown>) => {
  const stateFile = resolveStateFile(context);

  await mkdir(dirname(stateFile), { recursive: true });
  await writeFile(stateFile, JSON.stringify(state), "utf8");
};

const createPersistedState = (
  result: ReadEnabledStateResult,
  state: EnabledState,
): Record<string, unknown> => {
  const persisted = result.raw ? { ...result.raw } : {};

  delete persisted.enabled;

  return {
    ...persisted,
    pluginEnabled: state.pluginEnabled,
    roastEnabled: state.roastEnabled,
  };
};

const writeMergedEnabledState = async (
  context: EnabledStateContext,
  nextState: Partial<EnabledState>,
) => {
  const current = await readEnabledStateResult(context);
  const mergedState = {
    ...current.state,
    ...nextState,
  } satisfies EnabledState;

  await writeStateFile(context, createPersistedState(current, mergedState));
};

export const writePluginEnabledState = async (
  context: EnabledStateContext,
  pluginEnabled: boolean,
) => {
  await writeMergedEnabledState(context, { pluginEnabled });
};

export const writeRoastEnabledState = async (
  context: EnabledStateContext,
  roastEnabled: boolean,
) => {
  await writeMergedEnabledState(context, { roastEnabled });
};

export const writeEnabledState = async (context: EnabledStateContext, enabled: boolean) => {
  const current = await readEnabledStateResult(context);

  await writeStateFile(
    context,
    createPersistedState(current, {
      pluginEnabled: enabled,
      roastEnabled: enabled,
    }),
  );
};
