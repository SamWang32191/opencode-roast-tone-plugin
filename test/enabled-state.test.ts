import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  readEnabledState,
  resolveStateFile,
  writeEnabledState,
} from "../src/enabled-state.js";

const originalOpencodeConfigDir = process.env.OPENCODE_CONFIG_DIR;
const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
const tempDirs = new Set<string>();
const STATE_FILE_PARTS = ["plugin-data", "opencode-roast-tone-plugin", "state.json"] as const;

const trackTempDir = async (prefix: string) => {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.add(directory);
  return directory;
};

const restoreEnv = () => {
  if (originalOpencodeConfigDir === undefined) {
    delete process.env.OPENCODE_CONFIG_DIR;
  } else {
    process.env.OPENCODE_CONFIG_DIR = originalOpencodeConfigDir;
  }

  if (originalXdgConfigHome === undefined) {
    delete process.env.XDG_CONFIG_HOME;
  } else {
    process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
  }
};

const writeRawStateFile = async (root: string, contents: string) => {
  const stateFile = join(root, ...STATE_FILE_PARTS);

  await mkdir(dirname(stateFile), { recursive: true });
  await writeFile(stateFile, contents, "utf8");

  return stateFile;
};

afterEach(async () => {
  restoreEnv();

  await Promise.all(
    [...tempDirs].map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );

  tempDirs.clear();
});

describe("enabled state helpers", () => {
  it("prefers OPENCODE_CONFIG_DIR over workspace and global roots", async () => {
    const configDir = await trackTempDir("enabled-config-");
    const worktree = await trackTempDir("enabled-worktree-");
    const directory = join(worktree, "packages", "app", "src");

    process.env.OPENCODE_CONFIG_DIR = configDir;
    process.env.XDG_CONFIG_HOME = await trackTempDir("enabled-xdg-");
    await mkdir(join(worktree, ".opencode"), { recursive: true });
    await mkdir(directory, { recursive: true });

    expect(resolveStateFile({ directory, worktree })).toBe(
      join(configDir, ...STATE_FILE_PARTS),
    );
  });

  it("uses the nearest workspace .opencode directory when no env override exists", async () => {
    const worktree = await trackTempDir("enabled-worktree-");
    const directory = join(worktree, "packages", "app", "src");
    const nearestConfigRoot = join(worktree, "packages", "app", ".opencode");

    delete process.env.OPENCODE_CONFIG_DIR;
    delete process.env.XDG_CONFIG_HOME;
    await mkdir(join(worktree, ".opencode"), { recursive: true });
    await mkdir(nearestConfigRoot, { recursive: true });
    await mkdir(directory, { recursive: true });

    expect(resolveStateFile({ directory, worktree })).toBe(
      join(nearestConfigRoot, ...STATE_FILE_PARTS),
    );
  });

  it("falls back to the XDG config root when workspace config is absent", async () => {
    const worktree = await trackTempDir("enabled-worktree-");
    const directory = join(worktree, "src");
    const xdgConfigHome = await trackTempDir("enabled-xdg-");

    delete process.env.OPENCODE_CONFIG_DIR;
    process.env.XDG_CONFIG_HOME = xdgConfigHome;
    await mkdir(directory, { recursive: true });

    expect(resolveStateFile({ directory, worktree })).toBe(
      join(xdgConfigHome, "opencode", ...STATE_FILE_PARTS),
    );
  });

  it("falls back to ~/.config/opencode when XDG_CONFIG_HOME is unset", async () => {
    const worktree = await trackTempDir("enabled-worktree-");
    const directory = join(worktree, "src");

    delete process.env.OPENCODE_CONFIG_DIR;
    delete process.env.XDG_CONFIG_HOME;
    await mkdir(directory, { recursive: true });

    expect(resolveStateFile({ directory, worktree })).toBe(
      join(homedir(), ".config", "opencode", ...STATE_FILE_PARTS),
    );
  });

  it("returns true when the state file is missing", async () => {
    const configDir = await trackTempDir("enabled-config-");

    process.env.OPENCODE_CONFIG_DIR = configDir;

    await expect(
      readEnabledState({ directory: configDir, worktree: configDir }),
    ).resolves.toBe(true);
  });

  it("returns true when reading the state file hits a non-ENOENT filesystem error", async () => {
    const blockedPath = join(await trackTempDir("enabled-blocked-"), "blocked-file");

    await writeFile(blockedPath, "", "utf8");
    process.env.OPENCODE_CONFIG_DIR = blockedPath;

    await expect(
      readEnabledState({ directory: blockedPath, worktree: blockedPath }),
    ).resolves.toBe(true);
  });

  it("returns true when the state JSON is malformed", async () => {
    const configDir = await trackTempDir("enabled-config-");

    process.env.OPENCODE_CONFIG_DIR = configDir;
    await writeRawStateFile(configDir, "not-json-at-all");

    await expect(
      readEnabledState({ directory: configDir, worktree: configDir }),
    ).resolves.toBe(true);
  });

  it("returns true when enabled is not a boolean", async () => {
    const configDir = await trackTempDir("enabled-config-");

    process.env.OPENCODE_CONFIG_DIR = configDir;
    await writeRawStateFile(configDir, JSON.stringify({ enabled: "yeah totally" }));

    await expect(
      readEnabledState({ directory: configDir, worktree: configDir }),
    ).resolves.toBe(true);
  });

  it("writes the enabled state JSON to the resolved file", async () => {
    const configDir = await trackTempDir("enabled-config-");
    const context = { directory: configDir, worktree: configDir };

    process.env.OPENCODE_CONFIG_DIR = configDir;
    await writeEnabledState(context, false);

    const stateFile = resolveStateFile(context);
    const contents = await readFile(stateFile, "utf8");

    expect(JSON.parse(contents)).toEqual({ enabled: false });
  });

  it("swallows write errors because runtime drama is not a feature", async () => {
    const blockedPath = join(await trackTempDir("enabled-blocked-"), "blocked-file");

    await writeFile(blockedPath, "", "utf8");
    process.env.OPENCODE_CONFIG_DIR = blockedPath;

    await expect(
      writeEnabledState({ directory: blockedPath, worktree: blockedPath }, true),
    ).resolves.toBeUndefined();
  });
});
