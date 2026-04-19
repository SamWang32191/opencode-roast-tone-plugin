import type { Plugin } from "@opencode-ai/plugin";

import { readEnabledState } from "./enabled-state.js";
import { getToneIdForPrompt, getTonePrompt } from "./tone.js";

const createTonePart = (text: string) => {
  return { type: "text", text } as const;
};

const RoastTonePlugin: Plugin = async (input) => ({
  "experimental.chat.messages.transform": async (_transformInput, output) => {
    const state = await readEnabledState({
      directory: input.directory,
      worktree: input.worktree,
    });

    const firstUser = output.messages.find((message) => message.info.role === "user");

    if (!firstUser || !firstUser.parts.length) {
      return;
    }

    const parts = firstUser.parts as unknown[];
    const firstPart = firstUser.parts[0];
    const injectedToneId =
      firstPart?.type === "text" ? getToneIdForPrompt(firstPart.text) : undefined;

    if (!state.pluginEnabled || !state.roastEnabled) {
      if (injectedToneId) {
        parts.shift();
      }

      return;
    }

    const nextPrompt = getTonePrompt(state.activeTone);

    if (firstPart?.type === "text" && firstPart.text === nextPrompt) {
      return;
    }

    if (injectedToneId) {
      parts[0] = createTonePart(nextPrompt);
      return;
    }

    parts.unshift(createTonePart(nextPrompt));
  },
});

export default RoastTonePlugin;
