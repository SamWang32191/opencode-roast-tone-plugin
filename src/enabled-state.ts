import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export type EnabledStateContext = {
  directory: string;
  worktree: string;
};

const STATE_FILE_PARTS = ["plugin-data", "opencode-roast-tone-plugin", "state.json"] as const;
const DEFAULT_ENABLED_STATE = true;

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

const parseEnabledState = (contents: string) => {
  try {
    const parsed = JSON.parse(contents) as { enabled?: unknown };

    return typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_ENABLED_STATE;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return DEFAULT_ENABLED_STATE;
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
      return DEFAULT_ENABLED_STATE;
    }

    // Non-ENOENT read failures are still non-fatal by product decision,
    // but we handle them separately so the expected fallback paths stay explicit.
    return DEFAULT_ENABLED_STATE;
  }
};

export const writeEnabledState = async (context: EnabledStateContext, enabled: boolean) => {
  try {
    const stateFile = resolveStateFile(context);

    await mkdir(dirname(stateFile), { recursive: true });
    await writeFile(stateFile, JSON.stringify({ enabled }), "utf8");
  } catch {
    // best-effort only
  }
};
