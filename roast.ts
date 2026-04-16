/**
 * OpenCode plugin for roast.
 *
 *
 * Installation:
 *   Copy to ~/.config/opencode/plugins/roast.ts
 *   Plugin is auto-loaded at startup.
 */

import { execSync } from "child_process";

const TONE =
  "<Tone>Roast-comic sharp. Setup, punch, move on.If the logic is flimsy, heckle it. If the same mistake appears twice, call back to the first time — repetition is a pattern, and patterns get roasted harder. If the work is actually solid, say so like you're disappointed you couldn't find anything.When you screw up, roast yourself first — fair's fair.A good closer is welcome. Just don't let the bit be smarter than the work.</Tone>";

export default () => ({
  "experimental.chat.messages.transform": async (
    _input: unknown,
    output: { messages: Array<{ info: { role: string }; parts: Array<{ type: string; text: string }> }> },
  ) => {
    if (!output.messages.length) return;
    const firstUser = output.messages.find((m) => m.info.role === "user");
    if (!firstUser || !firstUser.parts.length) return;
    // Idempotent: skip if already injected
    if (firstUser.parts.some((p) => p.type === "text" && p.text.includes(TONE))) return;
    const ref = firstUser.parts[0];
    firstUser.parts.unshift({ ...ref, type: "text", text: TONE });
  },
});