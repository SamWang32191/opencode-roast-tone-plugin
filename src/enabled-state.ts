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

type PersistedEnabledState = {
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
  return typeof value === "object" && value !== null;
};

const hasNewEnabledStateFields = (state: PersistedEnabledState) => {
  return "pluginEnabled" in state || "roastEnabled" in state;
};

const parsePersistedEnabledState = (contents: string): PersistedEnabledState | undefined => {
  try {
    const parsed = JSON.parse(contents) as unknown;

    return isPersistedEnabledState(parsed) ? parsed : undefined;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return undefined;
    }

    throw error;
  }
};

const parseEnabledState = (contents: string): EnabledState => {
  try {
    const parsed = parsePersistedEnabledState(contents);

    if (!parsed) {
      return createDefaultEnabledState();
    }

    if (hasNewEnabledStateFields(parsed)) {
      return {
        pluginEnabled:
          typeof parsed.pluginEnabled === "boolean"
            ? parsed.pluginEnabled
            : DEFAULT_ENABLED_STATE.pluginEnabled,
        roastEnabled:
          typeof parsed.roastEnabled === "boolean"
            ? parsed.roastEnabled
            : DEFAULT_ENABLED_STATE.roastEnabled,
      };
    }

    if (typeof parsed.enabled === "boolean") {
      return {
        pluginEnabled: parsed.enabled,
        roastEnabled: parsed.enabled,
      };
    }

    return createDefaultEnabledState();
  } catch (error) {
    if (error instanceof SyntaxError) {
      return createDefaultEnabledState();
    }

    throw error;
  }
};

export const readEnabledState = async (context: EnabledStateContext) => {
  const stateFile = resolveStateFile(context);

  try {
    const contents = await readFile(stateFile, "utf8");

    return parseEnabledState(contents);
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return createDefaultEnabledState();
    }

    // Non-ENOENT read failures are still non-fatal by product decision,
    // but we handle them separately so the expected fallback paths stay explicit.
    return createDefaultEnabledState();
  }
};

export const readEffectiveEnabledState = async (context: EnabledStateContext) => {
  const state = await readEnabledState(context);

  return state.pluginEnabled && state.roastEnabled;
};

const writeStateFile = async (context: EnabledStateContext, state: object) => {
  const stateFile = resolveStateFile(context);

  await mkdir(dirname(stateFile), { recursive: true });
  await writeFile(stateFile, JSON.stringify(state), "utf8");
};

const writeMergedEnabledState = async (
  context: EnabledStateContext,
  nextState: Partial<EnabledState>,
) => {
  try {
    const currentState = await readEnabledState(context);

    await writeStateFile(context, {
      ...currentState,
      ...nextState,
    });
  } catch {
    // best-effort only
  }
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
  try {
    const stateFile = resolveStateFile(context);
    const contents = await readFile(stateFile, "utf8").catch((error: unknown) => {
      if (isFileNotFoundError(error)) {
        return undefined;
      }

      throw error;
    });

    const parsedState = typeof contents === "string" ? parsePersistedEnabledState(contents) : undefined;

    if (parsedState && hasNewEnabledStateFields(parsedState)) {
      await writeStateFile(context, {
        pluginEnabled: enabled,
        roastEnabled: enabled,
      });
      return;
    }

    await writeStateFile(context, { enabled });
  } catch {
    // best-effort only
  }
};
