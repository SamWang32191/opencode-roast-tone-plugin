import type { Plugin } from "@opencode-ai/plugin";

import { readEnabledState } from "./enabled-state.js";
import { getToneIdForPrompt, getTonePrompt } from "./tone.js";

const createTonePart = (text: string) => {
  return { type: "text", text } as const;
};

const isLikelyInjectedTonePart = (part: unknown, partsLength: number) => {
  if (
    partsLength < 2 ||
    typeof part !== "object" ||
    part === null ||
    !("type" in part) ||
    !("text" in part) ||
    part.type !== "text" ||
    typeof part.text !== "string"
  ) {
    return false;
  }

  return Object.keys(part).every((key) => key === "type" || key === "text");
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
    const canTreatFirstPartAsInjected =
      injectedToneId !== undefined && isLikelyInjectedTonePart(firstPart, firstUser.parts.length);

    if (!state.pluginEnabled || !state.roastEnabled) {
      if (canTreatFirstPartAsInjected) {
        parts.shift();
      }

      return;
    }

    const nextPrompt = getTonePrompt(state.activeTone);

    if (firstPart?.type === "text" && firstPart.text === nextPrompt) {
      return;
    }

    if (canTreatFirstPartAsInjected) {
      parts[0] = createTonePart(nextPrompt);
      return;
    }

    parts.unshift(createTonePart(nextPrompt));
  },
});

export default RoastTonePlugin;
