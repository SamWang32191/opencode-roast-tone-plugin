import { describe, expect, it } from "vitest";

import createPlugin from "../src/server";
import { TONE } from "../src/tone";

describe("server plugin", () => {
  it("injects the tone before the first user part", async () => {
    const plugin = createPlugin();
    const transform = plugin["experimental.chat.messages.transform"];
    const output = {
      messages: [
        {
          info: { role: "system" },
          parts: [{ type: "text", text: "system prompt" }],
        },
        {
          info: { role: "user" },
          parts: [{ type: "text", text: "hello" }],
        },
      ],
    };

    await transform(undefined, output);

    expect(output.messages[1].parts).toEqual([
      { type: "text", text: TONE },
      { type: "text", text: "hello" },
    ]);
  });

  it("does not inject the tone twice", async () => {
    const plugin = createPlugin();
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
    const plugin = createPlugin();
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
    const plugin = createPlugin();
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
    const plugin = createPlugin();
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
    const plugin = createPlugin();
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
