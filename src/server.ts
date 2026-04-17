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

export default () => ({
  "experimental.chat.messages.transform": async (_input: unknown, output: Output) => {
    if (!output.messages.length) {
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
