import type { PluginInput } from "@opencode-ai/plugin";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import createPlugin from "../src/server.js";
import { TONE, TONE_REGISTRY } from "../src/tone.js";

type PluginInstance = Awaited<ReturnType<typeof createPlugin>>;
type Transform = NonNullable<PluginInstance["experimental.chat.messages.transform"]>;
type TransformOutput = Parameters<Transform>[1];
type TransformMessage = TransformOutput["messages"][number];
type TransformInfo = TransformMessage["info"];
type TransformPart = TransformMessage["parts"][number];
type UserInfo = Extract<TransformInfo, { role: "user" }>;
type AssistantInfo = Extract<TransformInfo, { role: "assistant" }>;
type TextPart = Extract<TransformPart, { type: "text" }>;
type InjectedTonePart = Pick<TextPart, "type" | "text">;
type TestTransformMessage = Omit<TransformMessage, "parts"> & {
  parts: Array<TransformPart | InjectedTonePart>;
};

const originalOpencodeConfigDir = process.env.OPENCODE_CONFIG_DIR;
const tempDirs = new Set<string>();
const STATE_FILE_PARTS = ["plugin-data", "opencode-roast-tone-plugin", "state.json"] as const;
const TRANSFORM_INPUT: Parameters<Transform>[0] = {};

let nextID = 0;

const trackTempDir = async (prefix: string) => {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.add(directory);
  return directory;
};

const createID = (prefix: string) => `${prefix}-${++nextID}`;

const createUserInfo = (overrides: Partial<UserInfo> = {}): UserInfo => ({
  id: createID("user"),
  sessionID: "session-1",
  role: "user",
  time: { created: 0 },
  agent: "test-agent",
  model: {
    providerID: "test-provider",
    modelID: "test-model",
  },
  ...overrides,
});

const createAssistantInfo = (overrides: Partial<AssistantInfo> = {}): AssistantInfo => ({
  id: createID("assistant"),
  sessionID: "session-1",
  role: "assistant",
  time: { created: 0 },
  parentID: "parent-1",
  modelID: "test-model",
  providerID: "test-provider",
  mode: "chat",
  path: {
    cwd: "/tmp",
    root: "/tmp",
  },
  cost: 0,
  tokens: {
    input: 0,
    output: 0,
    reasoning: 0,
    cache: {
      read: 0,
      write: 0,
    },
  },
  ...overrides,
});

const createTextPart = (text: string, overrides: Partial<TextPart> = {}): TextPart => ({
  id: createID("part"),
  sessionID: "session-1",
  messageID: "message-1",
  type: "text",
  text,
  ...overrides,
});

const createInjectedTonePart = (text: string): InjectedTonePart => ({ type: "text", text });

const createOutput = (messages: TestTransformMessage[]): TransformOutput => {
  return { messages: messages as TransformOutput["messages"] };
};

const restoreEnv = () => {
  if (originalOpencodeConfigDir === undefined) {
    delete process.env.OPENCODE_CONFIG_DIR;
    return;
  }

  process.env.OPENCODE_CONFIG_DIR = originalOpencodeConfigDir;
};

const writeStateFile = async (configDir: string, contents: string) => {
  const stateFile = join(configDir, ...STATE_FILE_PARTS);

  await mkdir(dirname(stateFile), { recursive: true });
  await writeFile(stateFile, contents, "utf8");

  return stateFile;
};

const createPluginInput = (worktree: string): PluginInput => ({
  client: {} as PluginInput["client"],
  project: {} as PluginInput["project"],
  directory: worktree,
  worktree,
  experimental_workspace: {
    register() {
      // no-op for tests
    },
  },
  serverUrl: new URL("http://localhost"),
  $: {} as PluginInput["$"],
});

const createTransform = async (): Promise<Transform> => {
  const worktree = await trackTempDir("server-worktree-");
  const plugin = await createPlugin(createPluginInput(worktree));
  const transform = plugin["experimental.chat.messages.transform"];

  if (!transform) {
    throw new Error("experimental.chat.messages.transform is not defined");
  }

  return transform;
};

afterEach(async () => {
  restoreEnv();

  await Promise.all(
    [...tempDirs].map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );

  tempDirs.clear();
  nextID = 0;
});

describe("server plugin", () => {
  it("injects the tone before the first user part", async () => {
    process.env.OPENCODE_CONFIG_DIR = await trackTempDir("server-config-");
    const transform = await createTransform();
    const output = createOutput([
      {
        info: createAssistantInfo(),
        parts: [createTextPart("assistant prompt")],
      },
      {
        info: createUserInfo(),
        parts: [createTextPart("hello")],
      },
    ]);

    await transform(TRANSFORM_INPUT, output);

    expect(output.messages[1].parts[0]).toEqual({ type: "text", text: TONE });
    expect(output.messages[1].parts[1]).toMatchObject({ type: "text", text: "hello" });
  });

  it("does not inject the tone twice", async () => {
    process.env.OPENCODE_CONFIG_DIR = await trackTempDir("server-config-");
    const transform = await createTransform();
    const output = createOutput([
      {
        info: createUserInfo(),
        parts: [createTextPart(TONE), createTextPart("hello")],
      },
    ]);

    await transform(TRANSFORM_INPUT, output);

    expect(output.messages[0].parts).toHaveLength(2);
    expect(output.messages[0].parts[0]).toMatchObject({ type: "text", text: TONE });
    expect(output.messages[0].parts[1]).toMatchObject({ type: "text", text: "hello" });
  });

  it("does not mistake user content containing TONE for an existing injection", async () => {
    process.env.OPENCODE_CONFIG_DIR = await trackTempDir("server-config-");
    const transform = await createTransform();
    const output = createOutput([
      {
        info: createUserInfo(),
        parts: [createTextPart(`user quoted this: ${TONE}`)],
      },
    ]);

    await transform(TRANSFORM_INPUT, output);

    expect(output.messages[0].parts[0]).toEqual({ type: "text", text: TONE });
    expect(output.messages[0].parts[1]).toMatchObject({
      type: "text",
      text: `user quoted this: ${TONE}`,
    });
  });

  it("inserts a clean tone part without copying extra fields", async () => {
    process.env.OPENCODE_CONFIG_DIR = await trackTempDir("server-config-");
    const transform = await createTransform();
    const output = createOutput([
      {
        info: createUserInfo(),
        parts: [createTextPart("hello", { metadata: { source: "user" } })],
      },
    ]);

    await transform(TRANSFORM_INPUT, output);

    expect(output.messages[0].parts[0]).toEqual({ type: "text", text: TONE });
    expect(output.messages[0].parts[0]).not.toHaveProperty("metadata");
  });

  it("returns safely when there is no user message", async () => {
    process.env.OPENCODE_CONFIG_DIR = await trackTempDir("server-config-");
    const transform = await createTransform();
    const output = createOutput([
      {
        info: createAssistantInfo(),
        parts: [createTextPart("assistant prompt")],
      },
    ]);

    await expect(transform(TRANSFORM_INPUT, output)).resolves.toBeUndefined();
    expect(output.messages[0].parts).toHaveLength(1);
    expect(output.messages[0].parts[0]).toMatchObject({ type: "text", text: "assistant prompt" });
  });

  it("returns safely when the first user message has no parts", async () => {
    process.env.OPENCODE_CONFIG_DIR = await trackTempDir("server-config-");
    const transform = await createTransform();
    const output = createOutput([
      {
        info: createUserInfo(),
        parts: [],
      },
    ]);

    await expect(transform(TRANSFORM_INPUT, output)).resolves.toBeUndefined();
    expect(output.messages[0].parts).toEqual([]);
  });

  it("injects when enabled state is missing", async () => {
    process.env.OPENCODE_CONFIG_DIR = await trackTempDir("server-config-");
    const transform = await createTransform();
    const output = createOutput([
      {
        info: createUserInfo(),
        parts: [createTextPart("hello")],
      },
    ]);

    await transform(TRANSFORM_INPUT, output);

    expect(output.messages[0].parts[0]).toEqual({ type: "text", text: TONE });
  });

  it("injects when enabled state is explicitly true", async () => {
    const configDir = await trackTempDir("server-config-");
    process.env.OPENCODE_CONFIG_DIR = configDir;
    await writeStateFile(configDir, JSON.stringify({ enabled: true }));

    const transform = await createTransform();
    const output = createOutput([
      {
        info: createUserInfo(),
        parts: [createTextPart("hello")],
      },
    ]);

    await transform(TRANSFORM_INPUT, output);

    expect(output.messages[0].parts[0]).toEqual({ type: "text", text: TONE });
  });

  it("does not inject when legacy enabled state is false", async () => {
    const configDir = await trackTempDir("server-config-");
    process.env.OPENCODE_CONFIG_DIR = configDir;
    await writeStateFile(configDir, JSON.stringify({ enabled: false }));

    const transform = await createTransform();
    const output = createOutput([
      {
        info: createUserInfo(),
        parts: [createTextPart("hello")],
      },
    ]);

    await transform(TRANSFORM_INPUT, output);

    expect(output.messages[0].parts).toHaveLength(1);
    expect(output.messages[0].parts[0]).toMatchObject({ type: "text", text: "hello" });
  });

  it("does not inject when pluginEnabled is false", async () => {
    const configDir = await trackTempDir("server-config-");
    process.env.OPENCODE_CONFIG_DIR = configDir;
    await writeStateFile(
      configDir,
      JSON.stringify({ pluginEnabled: false, roastEnabled: true }),
    );

    const transform = await createTransform();
    const output = createOutput([
      {
        info: createUserInfo(),
        parts: [createTextPart("hello")],
      },
    ]);

    await transform(TRANSFORM_INPUT, output);

    expect(output.messages[0].parts).toHaveLength(1);
    expect(output.messages[0].parts[0]).toMatchObject({ type: "text", text: "hello" });
  });

  it("does not inject when roastEnabled is false", async () => {
    const configDir = await trackTempDir("server-config-");
    process.env.OPENCODE_CONFIG_DIR = configDir;
    await writeStateFile(
      configDir,
      JSON.stringify({ pluginEnabled: true, roastEnabled: false }),
    );

    const transform = await createTransform();
    const output = createOutput([
      {
        info: createUserInfo(),
        parts: [createTextPart("hello")],
      },
    ]);

    await transform(TRANSFORM_INPUT, output);

    expect(output.messages[0].parts).toHaveLength(1);
    expect(output.messages[0].parts[0]).toMatchObject({ type: "text", text: "hello" });
  });

  it("injects the selected preset prompt instead of always using roast", async () => {
    const configDir = await trackTempDir("server-config-");
    process.env.OPENCODE_CONFIG_DIR = configDir;
    await writeStateFile(
      configDir,
      JSON.stringify({
        pluginEnabled: true,
        roastEnabled: true,
        activeTone: "dry",
      }),
    );

    const transform = await createTransform();
    const output = createOutput([
      {
        info: createUserInfo(),
        parts: [createTextPart("hello")],
      },
    ]);

    await transform(TRANSFORM_INPUT, output);

    expect(output.messages[0].parts[0]).toEqual({
      type: "text",
      text: TONE_REGISTRY.dry.prompt,
    });
  });

  it("falls back to the roast prompt when the new format omits activeTone", async () => {
    const configDir = await trackTempDir("server-config-");
    process.env.OPENCODE_CONFIG_DIR = configDir;
    await writeStateFile(
      configDir,
      JSON.stringify({
        pluginEnabled: true,
        roastEnabled: true,
      }),
    );

    const transform = await createTransform();
    const output = createOutput([
      {
        info: createUserInfo(),
        parts: [createTextPart("hello")],
      },
    ]);

    await transform(TRANSFORM_INPUT, output);

    expect(output.messages[0].parts[0]).toEqual({
      type: "text",
      text: TONE_REGISTRY.roast.prompt,
    });
  });

  it("replaces an older injected preset when activeTone changes", async () => {
    const configDir = await trackTempDir("server-config-");
    process.env.OPENCODE_CONFIG_DIR = configDir;
    await writeStateFile(
      configDir,
      JSON.stringify({
        pluginEnabled: true,
        roastEnabled: true,
        activeTone: "mentor",
      }),
    );

    const transform = await createTransform();
    const output = createOutput([
      {
        info: createUserInfo(),
        parts: [createInjectedTonePart(TONE_REGISTRY.roast.prompt), createTextPart("hello")],
      },
    ]);

    await transform(TRANSFORM_INPUT, output);

    expect(output.messages[0].parts).toHaveLength(2);
    expect(output.messages[0].parts[0]).toEqual({
      type: "text",
      text: TONE_REGISTRY.mentor.prompt,
    });
  });

  it("removes an injected preset when roastEnabled is false", async () => {
    const configDir = await trackTempDir("server-config-");
    process.env.OPENCODE_CONFIG_DIR = configDir;
    await writeStateFile(
      configDir,
      JSON.stringify({
        pluginEnabled: true,
        roastEnabled: false,
        activeTone: "dry",
      }),
    );

    const transform = await createTransform();
    const output = createOutput([
      {
        info: createUserInfo(),
        parts: [createInjectedTonePart(TONE_REGISTRY.dry.prompt), createTextPart("hello")],
      },
    ]);

    await transform(TRANSFORM_INPUT, output);

    expect(output.messages[0].parts).toHaveLength(1);
    expect(output.messages[0].parts[0]).toMatchObject({ type: "text", text: "hello" });
  });

  it("keeps matching user text when disabled and there is no clear prior injection", async () => {
    const configDir = await trackTempDir("server-config-");
    process.env.OPENCODE_CONFIG_DIR = configDir;
    await writeStateFile(
      configDir,
      JSON.stringify({
        pluginEnabled: true,
        roastEnabled: false,
        activeTone: "dry",
      }),
    );

    const transform = await createTransform();
    const output = createOutput([
      {
        info: createUserInfo(),
        parts: [createTextPart(TONE_REGISTRY.dry.prompt)],
      },
    ]);

    await transform(TRANSFORM_INPUT, output);

    expect(output.messages[0].parts).toHaveLength(1);
    expect(output.messages[0].parts[0]).toMatchObject({
      type: "text",
      text: TONE_REGISTRY.dry.prompt,
    });
  });

  it("falls back to injecting when state JSON is malformed", async () => {
    const configDir = await trackTempDir("server-config-");
    process.env.OPENCODE_CONFIG_DIR = configDir;
    await writeStateFile(configDir, "definitely-not-json");

    const transform = await createTransform();
    const output = createOutput([
      {
        info: createUserInfo(),
        parts: [createTextPart("hello")],
      },
    ]);

    await transform(TRANSFORM_INPUT, output);

    expect(output.messages[0].parts[0]).toEqual({ type: "text", text: TONE });
  });

  it("re-reads enabled state on every transform call", async () => {
    const configDir = await trackTempDir("server-config-");
    process.env.OPENCODE_CONFIG_DIR = configDir;

    const transform = await createTransform();
    const disabledOutput = createOutput([
      {
        info: createUserInfo(),
        parts: [createTextPart("first")],
      },
    ]);

    await writeStateFile(configDir, JSON.stringify({ enabled: false }));
    await transform(TRANSFORM_INPUT, disabledOutput);

    expect(disabledOutput.messages[0].parts).toHaveLength(1);
    expect(disabledOutput.messages[0].parts[0]).toMatchObject({ type: "text", text: "first" });

    const enabledOutput = createOutput([
      {
        info: createUserInfo(),
        parts: [createTextPart("second")],
      },
    ]);

    await writeStateFile(configDir, JSON.stringify({ enabled: true }));
    await transform(TRANSFORM_INPUT, enabledOutput);

    expect(enabledOutput.messages[0].parts[0]).toEqual({ type: "text", text: TONE });
  });
});
