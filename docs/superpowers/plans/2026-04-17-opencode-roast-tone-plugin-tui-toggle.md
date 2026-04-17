# OpenCode Roast Tone Plugin TUI Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a TUI target for `opencode-roast-tone-plugin` so OpenCode's built-in Plugin Manager can enable or disable the plugin, and make that toggle persistently control the server-side roast-tone injection behavior.

**Architecture:** Keep the package dual-target but simple: `src/server.ts` remains the only place that injects roast tone, `src/tui.ts` exists only to mirror Plugin Manager enable/disable state into a tiny shared JSON file, and `src/enabled-state.ts` is the only module allowed to resolve, read, or write that state file. The server hook reads the state file on every transform so the next message reflects the latest toggle without extra cache invalidation machinery.

**Tech Stack:** TypeScript, Vitest, Node built-ins (`fs/promises`, `path`, `os`), OpenCode plugin types from `@opencode-ai/plugin`

**Git note:** Do not create commits unless the user explicitly asks for one.

---

## File map

- Create: `src/enabled-state.ts`
  - Resolve the shared state file path
  - Read `enabled` with safe fallback
  - Write `enabled` and create parent directories as needed
- Create: `src/tui.ts`
  - Minimal TUI plugin entrypoint
  - Write `enabled: true` on load
  - Write `enabled: false` on dispose only when the plugin was actually disabled from Plugin Manager
- Create: `test/enabled-state.test.ts`
  - Unit tests for path resolution and safe fallback behavior
- Create: `test/tui.test.ts`
  - Minimal runtime-style tests for TUI enable/disable synchronization
- Modify: `src/server.ts`
  - Read shared enabled state before injecting roast tone
- Modify: `test/server.test.ts`
  - Add `enabled: false`, `enabled: true`, and malformed-state coverage
- Modify: `package.json`
  - Export `./tui`
  - Add compile-time dependencies for Node types and OpenCode plugin types
- Modify: `tsconfig.json`
  - Add Node type definitions for `fs/promises`, `path`, and `os`
- Modify: `README.md`
  - Document Plugin Manager toggle behavior and persistence

### Task 1: Shared enabled-state helper and server guard

**Files:**
- Create: `test/enabled-state.test.ts`
- Create: `src/enabled-state.ts`
- Modify: `src/server.ts`
- Modify: `test/server.test.ts`
- Modify: `tsconfig.json`
- Modify: `package.json`

- [ ] **Step 1: Write the failing enabled-state helper tests**

Create `test/enabled-state.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { readEnabledState, resolveStateFile, writeEnabledState } from "../src/enabled-state";

const dirs: string[] = [];

const tempDir = async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "roast-tone-state-"));
  dirs.push(dir);
  return dir;
};

afterEach(async () => {
  delete process.env.OPENCODE_CONFIG_DIR;
  delete process.env.XDG_CONFIG_HOME;
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("enabled state helper", () => {
  it("uses OPENCODE_CONFIG_DIR before local .opencode or XDG fallback", async () => {
    const root = await tempDir();
    const directory = await tempDir();
    process.env.OPENCODE_CONFIG_DIR = root;

    const file = await resolveStateFile({ directory, worktree: directory });

    expect(file).toBe(path.join(root, "plugin-data", "opencode-roast-tone-plugin", "state.json"));
  });

  it("uses the nearest .opencode directory when no explicit config dir is set", async () => {
    const worktree = await tempDir();
    const localRoot = path.join(worktree, ".opencode");
    const directory = path.join(worktree, "packages", "demo");
    await mkdir(localRoot, { recursive: true });
    await mkdir(directory, { recursive: true });

    const file = await resolveStateFile({ directory, worktree });

    expect(file).toBe(path.join(localRoot, "plugin-data", "opencode-roast-tone-plugin", "state.json"));
  });

  it("falls back to XDG config when no explicit or local root exists", async () => {
    const xdg = await tempDir();
    const directory = await tempDir();
    process.env.XDG_CONFIG_HOME = xdg;

    const file = await resolveStateFile({ directory, worktree: directory });

    expect(file).toBe(path.join(xdg, "opencode", "plugin-data", "opencode-roast-tone-plugin", "state.json"));
  });

  it("falls back to enabled when the state file is missing", async () => {
    const directory = await tempDir();

    await expect(readEnabledState({ directory, worktree: directory })).resolves.toBe(true);
  });

  it("writes enabled state as JSON", async () => {
    const directory = await tempDir();

    await writeEnabledState({ directory, worktree: directory }, false);

    const file = await resolveStateFile({ directory, worktree: directory });
    await expect(readFile(file, "utf8")).resolves.toContain('"enabled": false');
  });

  it("falls back to enabled when the JSON is malformed", async () => {
    const directory = await tempDir();
    const file = await resolveStateFile({ directory, worktree: directory });
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "{ not-json }", "utf8");

    await expect(readEnabledState({ directory, worktree: directory })).resolves.toBe(true);
  });
});
```

- [ ] **Step 2: Run the helper test file and confirm it fails because the module does not exist yet**

Run:

```bash
npm test -- test/enabled-state.test.ts
```

Expected: FAIL with a module resolution error for `../src/enabled-state`.

- [ ] **Step 3: Add Node type support and implement the shared helper**

Update `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": "src",
    "outDir": "dist",
    "strict": true,
    "skipLibCheck": true,
    "noEmitOnError": true,
    "types": ["node"]
  },
  "include": [
    "src/**/*.ts"
  ]
}
```

Update `package.json` dependencies section to include compile-time support:

```json
{
  "devDependencies": {
    "@opencode-ai/plugin": "*",
    "@types/node": "^24.0.0",
    "typescript": "^5.9.3",
    "vitest": "^3.2.4"
  }
}
```

Create `src/enabled-state.ts`:

```ts
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type EnabledStateContext = {
  directory: string;
  worktree: string;
};

const STATE_FILE = path.join("plugin-data", "opencode-roast-tone-plugin", "state.json");

const exists = async (filePath: string) => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

const globalConfigRoot = () => {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) return path.join(xdg, "opencode");
  return path.join(os.homedir(), ".config", "opencode");
};

const findLocalConfigRoot = async (context: EnabledStateContext) => {
  let current = context.directory;
  const stop = context.worktree;

  while (true) {
    const candidate = path.join(current, ".opencode");
    if (await exists(candidate)) return candidate;
    if (current === stop) return;
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
};

export const resolveStateFile = async (context: EnabledStateContext) => {
  const explicit = process.env.OPENCODE_CONFIG_DIR;
  if (explicit) return path.join(explicit, STATE_FILE);

  const local = await findLocalConfigRoot(context);
  if (local) return path.join(local, STATE_FILE);

  return path.join(globalConfigRoot(), STATE_FILE);
};

export const readEnabledState = async (context: EnabledStateContext) => {
  try {
    const file = await resolveStateFile(context);
    const raw = JSON.parse(await readFile(file, "utf8")) as { enabled?: unknown };
    return typeof raw.enabled === "boolean" ? raw.enabled : true;
  } catch {
    return true;
  }
};

export const writeEnabledState = async (context: EnabledStateContext, enabled: boolean) => {
  try {
    const file = await resolveStateFile(context);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify({ enabled }, null, 2)}\n`, "utf8");
  } catch {
    // Best effort only: a state sync failure must not break TUI or server runtime.
  }
};
```

- [ ] **Step 4: Run the helper tests and confirm they pass**

Run:

```bash
npm test -- test/enabled-state.test.ts
```

Expected: PASS for all tests in `test/enabled-state.test.ts`.

- [ ] **Step 5: Extend server tests to prove enabled-state gating**

Replace `test/server.test.ts` with:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import createPlugin from "../src/server";
import { TONE } from "../src/tone";
import { resolveStateFile } from "../src/enabled-state";

let directory = "";

const createInput = () => ({
  directory,
  worktree: directory,
  client: {} as never,
  project: {} as never,
  experimental_workspace: { register() {} },
  serverUrl: new URL("http://localhost"),
  $: {} as never,
});

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "roast-tone-server-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const writeStateFile = async (contents: string) => {
  const file = await resolveStateFile({ directory, worktree: directory });
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, contents, "utf8");
};

describe("server plugin", () => {
  it("injects the tone before the first user part when enabled state is missing", async () => {
    const plugin = await createPlugin(createInput());
    const transform = plugin["experimental.chat.messages.transform"];
    const output = {
      messages: [
        { info: { role: "user" }, parts: [{ type: "text", text: "hello" }] },
      ],
    };

    await transform(undefined, output);

    expect(output.messages[0].parts).toEqual([
      { type: "text", text: TONE },
      { type: "text", text: "hello" },
    ]);
  });

  it("injects the tone when enabled state is explicitly true", async () => {
    await writeStateFile('{\n  "enabled": true\n}\n');

    const plugin = await createPlugin(createInput());
    const transform = plugin["experimental.chat.messages.transform"];
    const output = {
      messages: [
        { info: { role: "user" }, parts: [{ type: "text", text: "hello" }] },
      ],
    };

    await transform(undefined, output);

    expect(output.messages[0].parts).toEqual([
      { type: "text", text: TONE },
      { type: "text", text: "hello" },
    ]);
  });

  it("does not inject the tone when enabled state is false", async () => {
    await writeStateFile('{\n  "enabled": false\n}\n');

    const plugin = await createPlugin(createInput());
    const transform = plugin["experimental.chat.messages.transform"];
    const output = {
      messages: [
        { info: { role: "user" }, parts: [{ type: "text", text: "hello" }] },
      ],
    };

    await transform(undefined, output);

    expect(output.messages[0].parts).toEqual([{ type: "text", text: "hello" }]);
  });

  it("falls back to injecting the tone when state JSON is malformed", async () => {
    await writeStateFile("{ nope }");

    const plugin = await createPlugin(createInput());
    const transform = plugin["experimental.chat.messages.transform"];
    const output = {
      messages: [
        { info: { role: "user" }, parts: [{ type: "text", text: "hello" }] },
      ],
    };

    await transform(undefined, output);

    expect(output.messages[0].parts[0]).toEqual({ type: "text", text: TONE });
  });

  it("does not inject the tone twice", async () => {
    const plugin = await createPlugin(createInput());
    const transform = plugin["experimental.chat.messages.transform"];
    const output = {
      messages: [
        {
          info: { role: "user" },
          parts: [
            { type: "text", text: TONE },
            { type: "text", text: "hello" },
          ],
        },
      ],
    };

    await transform(undefined, output);

    expect(output.messages[0].parts).toEqual([
      { type: "text", text: TONE },
      { type: "text", text: "hello" },
    ]);
  });

  it("does not mistake user content containing TONE for an existing injection", async () => {
    const plugin = await createPlugin(createInput());
    const transform = plugin["experimental.chat.messages.transform"];
    const output = {
      messages: [
        {
          info: { role: "user" },
          parts: [{ type: "text", text: `user quoted this: ${TONE}` }],
        },
      ],
    };

    await transform(undefined, output);

    expect(output.messages[0].parts).toEqual([
      { type: "text", text: TONE },
      { type: "text", text: `user quoted this: ${TONE}` },
    ]);
  });

  it("inserts a clean tone part without copying extra fields", async () => {
    const plugin = await createPlugin(createInput());
    const transform = plugin["experimental.chat.messages.transform"];
    const output = {
      messages: [
        {
          info: { role: "user" },
          parts: [{ type: "text", text: "hello", metadata: { source: "user" } }],
        },
      ],
    };

    await transform(undefined, output);

    expect(output.messages[0].parts[0]).toEqual({ type: "text", text: TONE });
    expect(output.messages[0].parts[0]).not.toHaveProperty("metadata");
  });

  it("returns safely when there is no user message", async () => {
    const plugin = await createPlugin(createInput());
    const transform = plugin["experimental.chat.messages.transform"];
    const output = {
      messages: [
        {
          info: { role: "system" },
          parts: [{ type: "text", text: "system prompt" }],
        },
      ],
    };

    await expect(transform(undefined, output)).resolves.toBeUndefined();
    expect(output.messages[0].parts).toEqual([{ type: "text", text: "system prompt" }]);
  });

  it("returns safely when the first user message has no parts", async () => {
    const plugin = await createPlugin(createInput());
    const transform = plugin["experimental.chat.messages.transform"];
    const output = {
      messages: [
        {
          info: { role: "user" },
          parts: [],
        },
      ],
    };

    await expect(transform(undefined, output)).resolves.toBeUndefined();
    expect(output.messages[0].parts).toEqual([]);
  });
});
```

- [ ] **Step 6: Run the server test file and confirm the new cases fail**

Run:

```bash
npm test -- test/server.test.ts
```

Expected: FAIL because `src/server.ts` still ignores the shared enabled state and its factory signature does not yet accept `PluginInput`.

- [ ] **Step 7: Update the server plugin to respect the shared enabled state**

Replace `src/server.ts` with:

```ts
import type { Plugin } from "@opencode-ai/plugin";

import { readEnabledState } from "./enabled-state.js";
import { TONE } from "./tone.js";

type MessagePart = {
  type: string;
  text: string;
};

type Message = {
  info: {
    role: string;
  };
  parts: MessagePart[];
};

type Output = {
  messages: Message[];
};

const plugin: Plugin = async (input) => ({
  "experimental.chat.messages.transform": async (_event: unknown, output: Output) => {
    const enabled = await readEnabledState({
      directory: input.directory,
      worktree: input.worktree,
    });

    if (!enabled || !output.messages.length) {
      return;
    }

    const firstUser = output.messages.find((message) => message.info.role === "user");

    if (!firstUser || !firstUser.parts.length) {
      return;
    }

    const firstPart = firstUser.parts[0];

    if (firstPart?.type === "text" && firstPart.text === TONE) {
      return;
    }

    firstUser.parts.unshift({ type: "text", text: TONE });
  },
});

export default plugin;
```

- [ ] **Step 8: Re-run the helper and server tests and confirm both pass**

Run:

```bash
npm test -- test/enabled-state.test.ts test/server.test.ts
```

Expected: PASS for every test in both files.

### Task 2: TUI entrypoint and package exports

**Files:**
- Create: `src/tui.ts`
- Create: `test/tui.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing TUI synchronization tests**

Create `test/tui.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import plugin from "../src/tui";
import { resolveStateFile } from "../src/enabled-state";

const dirs: string[] = [];

const tempDir = async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "roast-tone-tui-"));
  dirs.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const createRuntime = async () => {
  const worktree = await tempDir();
  const directory = path.join(worktree, "packages", "demo");
  await mkdir(path.join(worktree, ".opencode"), { recursive: true });
  await mkdir(directory, { recursive: true });

  let enabled = true;
  const disposers: Array<() => void | Promise<void>> = [];

  const api = {
    state: {
      path: {
        config: path.join(worktree, ".opencode"),
        state: path.join(worktree, ".opencode"),
        worktree,
        directory,
      },
    },
    plugins: {
      list: () => [
        {
          id: "opencode-roast-tone-plugin",
          source: "npm",
          spec: "opencode-roast-tone-plugin",
          target: "tui",
          enabled,
          active: enabled,
        },
      ],
    },
    lifecycle: {
      signal: new AbortController().signal,
      onDispose(fn: () => void | Promise<void>) {
        disposers.push(fn);
        return () => {};
      },
    },
  } as any;

  return {
    api,
    worktree,
    directory,
    disable() {
      enabled = false;
    },
    async dispose() {
      for (const fn of disposers) {
        await fn();
      }
    },
  };
};

describe("tui plugin", () => {
  it("writes enabled state when loaded", async () => {
    const runtime = await createRuntime();

    await plugin.tui(runtime.api, undefined, { id: "opencode-roast-tone-plugin" } as any);

    const file = await resolveStateFile({ directory: runtime.directory, worktree: runtime.worktree });
    await expect(readFile(file, "utf8")).resolves.toContain('"enabled": true');
  });

  it("writes disabled state when disposed after a disable", async () => {
    const runtime = await createRuntime();
    await plugin.tui(runtime.api, undefined, { id: "opencode-roast-tone-plugin" } as any);

    runtime.disable();
    await runtime.dispose();

    const file = await resolveStateFile({ directory: runtime.directory, worktree: runtime.worktree });
    await expect(readFile(file, "utf8")).resolves.toContain('"enabled": false');
  });

  it("does not overwrite state to false on a normal dispose", async () => {
    const runtime = await createRuntime();
    await plugin.tui(runtime.api, undefined, { id: "opencode-roast-tone-plugin" } as any);

    await runtime.dispose();

    const file = await resolveStateFile({ directory: runtime.directory, worktree: runtime.worktree });
    await expect(readFile(file, "utf8")).resolves.toContain('"enabled": true');
  });
});
```

- [ ] **Step 2: Run the TUI test file and confirm it fails because the entrypoint does not exist yet**

Run:

```bash
npm test -- test/tui.test.ts
```

Expected: FAIL with a module resolution error for `../src/tui`.

- [ ] **Step 3: Implement the minimal TUI entrypoint that mirrors Plugin Manager state**

Create `src/tui.ts`:

```ts
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";

import { writeEnabledState } from "./enabled-state.js";

const tui: TuiPlugin = async (api, _options, meta) => {
  const context = {
    directory: api.state.path.directory,
    worktree: api.state.path.worktree,
  };

  await writeEnabledState(context, true);

  api.lifecycle.onDispose(async () => {
    const current = api.plugins.list().find((item) => item.id === meta.id);
    if (current?.enabled === false) {
      await writeEnabledState(context, false);
    }
  });
};

const plugin: TuiPluginModule = {
  tui,
};

export default plugin;
```

- [ ] **Step 4: Export the TUI target from the package**

Update `package.json`:

```json
{
  "name": "opencode-roast-tone-plugin",
  "version": "0.1.0",
  "description": "Roast-tone server plugin for OpenCode",
  "license": "MIT",
  "type": "module",
  "main": "./dist/server.js",
  "exports": {
    "./server": "./dist/server.js",
    "./tui": "./dist/tui.js"
  },
  "files": [
    "dist",
    "README.md",
    "LICENSE"
  ],
  "engines": {
    "opencode": ">=1.4.6 <2"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "devDependencies": {
    "@opencode-ai/plugin": "*",
    "@types/node": "^24.0.0",
    "typescript": "^5.9.3",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 5: Re-run the TUI tests and confirm they pass**

Run:

```bash
npm test -- test/tui.test.ts
```

Expected: PASS for every test in `test/tui.test.ts`.

### Task 3: README updates and full verification

**Files:**
- Modify: `README.md`
- Verify: `test/enabled-state.test.ts`
- Verify: `test/server.test.ts`
- Verify: `test/tui.test.ts`

- [ ] **Step 1: Document the Plugin Manager toggle flow in README**

Update `README.md` to this content:

````md
# opencode-roast-tone-plugin

Roast-tone plugin for OpenCode. It injects a roast-comic tone instruction into the first user message so the assistant stays sharp, fast, and a little judgmental — like good tooling with worse bedside manner.

## Install in current project

```sh
opencode plugin opencode-roast-tone-plugin@latest
```

## Global install

```sh
opencode plugin opencode-roast-tone-plugin@latest --global
```

## Toggle in TUI

After installation, open OpenCode's built-in **Plugins** dialog and toggle `opencode-roast-tone-plugin` there.

- When enabled, new user messages receive the roast tone instruction.
- When disabled, new user messages are left alone.
- The toggle is persisted, so restarting OpenCode keeps the same state.

## Config alternative

If you would rather configure plugins directly, use:

```json
{ "plugin": ["opencode-roast-tone-plugin@latest"] }
```

## Local development

From the repository root, build first, then install the local plugin with a path spec:

```sh
npm run build
opencode plugin "$(pwd)" --force
```

After changing code, run `npm run build` again and then reinstall or refresh the local plugin so OpenCode picks up the updated `dist/` output.

## Development

```sh
npm install
npm test
npm run build
```

## Publish

```sh
npm run build
npm publish --dry-run
npm publish
```
````

- [ ] **Step 2: Run the full test suite**

Run:

```bash
npm test
```

Expected: PASS for `test/enabled-state.test.ts`, `test/server.test.ts`, and `test/tui.test.ts`.

- [ ] **Step 3: Run the build and confirm both entrypoints are emitted**

Run:

```bash
npm run build
```

Expected: PASS and `dist/server.js` plus `dist/tui.js` exist.

- [ ] **Step 4: Dry-run the package publish output**

Run:

```bash
npm publish --dry-run
```

Expected: output includes `dist/server.js`, `dist/tui.js`, `README.md`, and `LICENSE` in the packed tarball summary.

## Self-review notes

- Spec coverage check:
  - Plugin Manager integration → Task 2
  - Shared enabled-state bridge → Task 1 and Task 2
  - Server toggle enforcement → Task 1
  - Persistence and docs → Task 3
- Placeholder scan:
  - No `TODO`, `TBD`, or “similar to above” shortcuts remain.
- Type consistency:
  - Shared context is consistently `directory` + `worktree`
  - Shared state file remains `plugin-data/opencode-roast-tone-plugin/state.json`
  - `readEnabledState` is the only server-side gate
