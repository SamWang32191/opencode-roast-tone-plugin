import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  readEffectiveEnabledState,
  readEnabledState,
  readEnabledStateResult,
  resolveStateFile,
  writeActiveToneState,
  writeEnabledState,
  writePluginEnabledState,
  writeRoastEnabledState,
} from "../src/enabled-state.js";
import { DEFAULT_TONE_ID } from "../src/tone.js";

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

  it("returns both flags enabled when the state file is missing", async () => {
    const configDir = await trackTempDir("enabled-config-");

    process.env.OPENCODE_CONFIG_DIR = configDir;

    await expect(
      readEnabledState({ directory: configDir, worktree: configDir }),
    ).resolves.toEqual({
      pluginEnabled: true,
      roastEnabled: true,
      activeTone: DEFAULT_TONE_ID,
    });
  });

  it("returns both flags enabled when reading the state file hits a non-ENOENT filesystem error", async () => {
    const blockedPath = join(await trackTempDir("enabled-blocked-"), "blocked-file");

    await writeFile(blockedPath, "", "utf8");
    process.env.OPENCODE_CONFIG_DIR = blockedPath;

    await expect(
      readEnabledState({ directory: blockedPath, worktree: blockedPath }),
    ).resolves.toEqual({
      pluginEnabled: true,
      roastEnabled: true,
      activeTone: DEFAULT_TONE_ID,
    });
  });

  it("returns both flags enabled when the state JSON is malformed", async () => {
    const configDir = await trackTempDir("enabled-config-");

    process.env.OPENCODE_CONFIG_DIR = configDir;
    await writeRawStateFile(configDir, "not-json-at-all");

    await expect(
      readEnabledState({ directory: configDir, worktree: configDir }),
    ).resolves.toEqual({
      pluginEnabled: true,
      roastEnabled: true,
      activeTone: DEFAULT_TONE_ID,
    });
  });

  it("reads the new dual-state format", async () => {
    const configDir = await trackTempDir("enabled-config-");

    process.env.OPENCODE_CONFIG_DIR = configDir;
    await writeRawStateFile(
      configDir,
      JSON.stringify({ pluginEnabled: false, roastEnabled: true }),
    );

    await expect(
      readEnabledState({ directory: configDir, worktree: configDir }),
    ).resolves.toEqual({
      pluginEnabled: false,
      roastEnabled: true,
      activeTone: DEFAULT_TONE_ID,
    });
  });

  it("falls back activeTone to roast when the new format omits it", async () => {
    const configDir = await trackTempDir("enabled-config-");

    process.env.OPENCODE_CONFIG_DIR = configDir;
    await writeRawStateFile(
      configDir,
      JSON.stringify({ pluginEnabled: true, roastEnabled: false }),
    );

    await expect(
      readEnabledState({ directory: configDir, worktree: configDir }),
    ).resolves.toEqual({
      pluginEnabled: true,
      roastEnabled: false,
      activeTone: DEFAULT_TONE_ID,
    });
  });

  it("supports the legacy enabled format", async () => {
    const configDir = await trackTempDir("enabled-config-");

    process.env.OPENCODE_CONFIG_DIR = configDir;
    await writeRawStateFile(configDir, JSON.stringify({ enabled: false }));

    await expect(
      readEnabledState({ directory: configDir, worktree: configDir }),
    ).resolves.toEqual({
      pluginEnabled: false,
      roastEnabled: false,
      activeTone: DEFAULT_TONE_ID,
    });
  });

  it("prefers new-format fields over legacy enabled when both formats appear", async () => {
    const configDir = await trackTempDir("enabled-config-");

    process.env.OPENCODE_CONFIG_DIR = configDir;
    await writeRawStateFile(
      configDir,
      JSON.stringify({ enabled: false, roastEnabled: true }),
    );

    await expect(
      readEnabledState({ directory: configDir, worktree: configDir }),
    ).resolves.toEqual({
      pluginEnabled: true,
      roastEnabled: true,
      activeTone: DEFAULT_TONE_ID,
    });
  });

  it("falls back each invalid new-format field independently", async () => {
    const configDir = await trackTempDir("enabled-config-");

    process.env.OPENCODE_CONFIG_DIR = configDir;
    await writeRawStateFile(
      configDir,
      JSON.stringify({ pluginEnabled: false, roastEnabled: "yeah totally" }),
    );

    await expect(
      readEnabledState({ directory: configDir, worktree: configDir }),
    ).resolves.toEqual({
      pluginEnabled: false,
      roastEnabled: true,
      activeTone: DEFAULT_TONE_ID,
    });
  });

  it("falls back invalid activeTone independently", async () => {
    const configDir = await trackTempDir("enabled-config-");

    process.env.OPENCODE_CONFIG_DIR = configDir;
    await writeRawStateFile(
      configDir,
      JSON.stringify({
        pluginEnabled: false,
        roastEnabled: true,
        activeTone: "chaotic",
        futureSetting: true,
      }),
    );

    await expect(
      readEnabledStateResult({ directory: configDir, worktree: configDir }),
    ).resolves.toMatchObject({
      kind: "partial-invalid-fields",
      warning: "partial-invalid-fields",
      state: {
        pluginEnabled: false,
        roastEnabled: true,
        activeTone: DEFAULT_TONE_ID,
      },
      raw: {
        pluginEnabled: false,
        roastEnabled: true,
        activeTone: "chaotic",
        futureSetting: true,
      },
    });
  });

  it("computes the effective enabled state from both flags", async () => {
    const configDir = await trackTempDir("enabled-config-");
    const context = { directory: configDir, worktree: configDir };

    process.env.OPENCODE_CONFIG_DIR = configDir;
    await writeRawStateFile(
      configDir,
      JSON.stringify({ pluginEnabled: true, roastEnabled: false }),
    );

    await expect(readEffectiveEnabledState(context)).resolves.toBe(false);
  });

  it("writes the enabled state JSON to the resolved file", async () => {
    const configDir = await trackTempDir("enabled-config-");
    const context = { directory: configDir, worktree: configDir };

    process.env.OPENCODE_CONFIG_DIR = configDir;
    await writeEnabledState(context, false);

    const stateFile = resolveStateFile(context);
    const contents = await readFile(stateFile, "utf8");

    expect(JSON.parse(contents)).toEqual({
      pluginEnabled: false,
      roastEnabled: false,
      activeTone: DEFAULT_TONE_ID,
    });
  });

  it("writeEnabledState keeps dual-state shape when the existing file uses the new format", async () => {
    const configDir = await trackTempDir("enabled-config-");
    const context = { directory: configDir, worktree: configDir };

    process.env.OPENCODE_CONFIG_DIR = configDir;
    await writeRawStateFile(
      configDir,
      JSON.stringify({ pluginEnabled: true, roastEnabled: false }),
    );

    await writeEnabledState(context, false);

    const contents = await readFile(resolveStateFile(context), "utf8");

    expect(JSON.parse(contents)).toEqual({
      pluginEnabled: false,
      roastEnabled: false,
      activeTone: DEFAULT_TONE_ID,
    });
  });

  it("writePluginEnabledState merges without overwriting roastEnabled", async () => {
    const configDir = await trackTempDir("enabled-config-");
    const context = { directory: configDir, worktree: configDir };

    process.env.OPENCODE_CONFIG_DIR = configDir;
    await writeRawStateFile(
      configDir,
      JSON.stringify({ pluginEnabled: true, roastEnabled: false }),
    );

    await writePluginEnabledState(context, false);

    const contents = await readFile(resolveStateFile(context), "utf8");

    expect(JSON.parse(contents)).toEqual({
      pluginEnabled: false,
      roastEnabled: false,
      activeTone: DEFAULT_TONE_ID,
    });
  });

  it("writeRoastEnabledState only changes roastEnabled", async () => {
    const configDir = await trackTempDir("enabled-config-");
    const context = { directory: configDir, worktree: configDir };

    process.env.OPENCODE_CONFIG_DIR = configDir;
    await writeRawStateFile(
      configDir,
      JSON.stringify({ pluginEnabled: false, roastEnabled: true }),
    );

    await writeRoastEnabledState(context, false);

    const contents = await readFile(resolveStateFile(context), "utf8");

    expect(JSON.parse(contents)).toEqual({
      pluginEnabled: false,
      roastEnabled: false,
      activeTone: DEFAULT_TONE_ID,
    });
  });

  it("writeActiveToneState preserves booleans and unknown top-level fields", async () => {
    const configDir = await trackTempDir("enabled-config-");
    const context = { directory: configDir, worktree: configDir };

    process.env.OPENCODE_CONFIG_DIR = configDir;
    await writeRawStateFile(
      configDir,
      JSON.stringify({
        pluginEnabled: false,
        roastEnabled: true,
        activeTone: "roast",
        futureSetting: "keep-me",
      }),
    );

    await writeActiveToneState(context, "deadpan");

    const contents = await readFile(resolveStateFile(context), "utf8");

    expect(JSON.parse(contents)).toEqual({
      pluginEnabled: false,
      roastEnabled: true,
      activeTone: "deadpan",
      futureSetting: "keep-me",
    });
  });

  it("reports legacy state without warning", async () => {
    const configDir = await trackTempDir("enabled-config-");

    process.env.OPENCODE_CONFIG_DIR = configDir;
    await writeRawStateFile(configDir, JSON.stringify({ enabled: false }));

    await expect(
      readEnabledStateResult({ directory: configDir, worktree: configDir }),
    ).resolves.toEqual({
      kind: "legacy",
      state: {
        pluginEnabled: false,
        roastEnabled: false,
        activeTone: DEFAULT_TONE_ID,
      },
      raw: { enabled: false },
    });
  });

  it("reports malformed JSON as an invalid-file warning", async () => {
    const configDir = await trackTempDir("enabled-config-");

    process.env.OPENCODE_CONFIG_DIR = configDir;
    await writeRawStateFile(configDir, "not-json-at-all");

    await expect(
      readEnabledStateResult({ directory: configDir, worktree: configDir }),
    ).resolves.toEqual({
      kind: "invalid-file",
      warning: "invalid-file",
      state: {
        pluginEnabled: true,
        roastEnabled: true,
        activeTone: DEFAULT_TONE_ID,
      },
    });
  });

  it("preserves raw unknown fields when parseable JSON has no known keys", async () => {
    const configDir = await trackTempDir("enabled-config-");

    process.env.OPENCODE_CONFIG_DIR = configDir;
    await writeRawStateFile(configDir, JSON.stringify({ futureSetting: true }));

    await expect(
      readEnabledStateResult({ directory: configDir, worktree: configDir }),
    ).resolves.toEqual({
      kind: "invalid-file",
      warning: "invalid-file",
      state: {
        pluginEnabled: true,
        roastEnabled: true,
        activeTone: DEFAULT_TONE_ID,
      },
      raw: { futureSetting: true },
    });
  });

  it("reports unreadable files as an unreadable-file warning", async () => {
    const blockedPath = join(await trackTempDir("enabled-blocked-"), "blocked-file");

    await writeFile(blockedPath, "", "utf8");
    process.env.OPENCODE_CONFIG_DIR = blockedPath;

    await expect(
      readEnabledStateResult({ directory: blockedPath, worktree: blockedPath }),
    ).resolves.toMatchObject({
      kind: "unreadable-file",
      warning: "unreadable-file",
      state: { pluginEnabled: true, roastEnabled: true },
    });
  });

  it("reports partial-invalid-fields when new-format values need fallback", async () => {
    const configDir = await trackTempDir("enabled-config-");

    process.env.OPENCODE_CONFIG_DIR = configDir;
    await writeRawStateFile(
      configDir,
      JSON.stringify({ pluginEnabled: false, roastEnabled: "broken", futureSetting: true }),
    );

    await expect(
      readEnabledStateResult({ directory: configDir, worktree: configDir }),
    ).resolves.toMatchObject({
      kind: "partial-invalid-fields",
      warning: "partial-invalid-fields",
      state: { pluginEnabled: false, roastEnabled: true },
      raw: { pluginEnabled: false, roastEnabled: "broken", futureSetting: true },
    });
  });

  it("writeEnabledState normalizes legacy files and preserves parseable unknown fields", async () => {
    const configDir = await trackTempDir("enabled-config-");
    const context = { directory: configDir, worktree: configDir };

    process.env.OPENCODE_CONFIG_DIR = configDir;
    await writeRawStateFile(configDir, JSON.stringify({ enabled: false, futureSetting: true }));

    await writeEnabledState(context, true);

    const contents = await readFile(resolveStateFile(context), "utf8");

    expect(JSON.parse(contents)).toEqual({
      futureSetting: true,
      pluginEnabled: true,
      roastEnabled: true,
      activeTone: DEFAULT_TONE_ID,
    });
  });

  it("writeEnabledState preserves activeTone when normalizing legacy files", async () => {
    const configDir = await trackTempDir("enabled-config-");
    const context = { directory: configDir, worktree: configDir };

    process.env.OPENCODE_CONFIG_DIR = configDir;
    await writeRawStateFile(
      configDir,
      JSON.stringify({ enabled: false, activeTone: "mentor", futureSetting: true }),
    );

    await writeEnabledState(context, true);

    const contents = await readFile(resolveStateFile(context), "utf8");

    expect(JSON.parse(contents)).toEqual({
      pluginEnabled: true,
      roastEnabled: true,
      activeTone: "mentor",
      futureSetting: true,
    });
  });

  it("writeRoastEnabledState preserves unknown top-level fields from parseable JSON", async () => {
    const configDir = await trackTempDir("enabled-config-");
    const context = { directory: configDir, worktree: configDir };

    process.env.OPENCODE_CONFIG_DIR = configDir;
    await writeRawStateFile(
      configDir,
      JSON.stringify({ pluginEnabled: true, roastEnabled: true, futureSetting: "keep-me" }),
    );

    await writeRoastEnabledState(context, false);

    const contents = await readFile(resolveStateFile(context), "utf8");

    expect(JSON.parse(contents)).toEqual({
      pluginEnabled: true,
      roastEnabled: false,
      activeTone: DEFAULT_TONE_ID,
      futureSetting: "keep-me",
    });
  });

  it("writeRoastEnabledState preserves unknown top-level fields when they are the only parseable keys", async () => {
    const configDir = await trackTempDir("enabled-config-");
    const context = { directory: configDir, worktree: configDir };

    process.env.OPENCODE_CONFIG_DIR = configDir;
    await writeRawStateFile(configDir, JSON.stringify({ futureSetting: true }));

    await writeRoastEnabledState(context, false);

    const contents = await readFile(resolveStateFile(context), "utf8");

    expect(JSON.parse(contents)).toEqual({
      futureSetting: true,
      pluginEnabled: true,
      roastEnabled: false,
      activeTone: DEFAULT_TONE_ID,
    });
  });

  it("writeRoastEnabledState self-heals malformed JSON into the new format", async () => {
    const configDir = await trackTempDir("enabled-config-");
    const context = { directory: configDir, worktree: configDir };

    process.env.OPENCODE_CONFIG_DIR = configDir;
    await writeRawStateFile(configDir, "not-json-at-all");

    await writeRoastEnabledState(context, false);

    const contents = await readFile(resolveStateFile(context), "utf8");

    expect(JSON.parse(contents)).toEqual({
      pluginEnabled: true,
      roastEnabled: false,
      activeTone: DEFAULT_TONE_ID,
    });
  });

  it("throws write errors instead of swallowing them", async () => {
    const blockedPath = join(await trackTempDir("enabled-blocked-"), "blocked-file");

    await writeFile(blockedPath, "", "utf8");
    process.env.OPENCODE_CONFIG_DIR = blockedPath;

    await expect(
      writeRoastEnabledState({ directory: blockedPath, worktree: blockedPath }, false),
    ).rejects.toBeDefined();
  });
});
