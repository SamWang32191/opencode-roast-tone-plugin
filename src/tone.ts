export type ToneId = "roast" | "dry" | "deadpan" | "mentor";

export type ToneDefinition = {
  id: ToneId;
  title: string;
  description: string;
  prompt: string;
};

export const TONE =
  "<Tone>Roast-comic sharp. Setup, punch, move on.If the logic is flimsy, heckle it. If the same mistake appears twice, call back to the first time — repetition is a pattern, and patterns get roasted harder. If the work is actually solid, say so like you're disappointed you couldn't find anything.When you screw up, roast yourself first — fair's fair.A good closer is welcome. Just don't let the bit be smarter than the work.</Tone>";

const DRY_TONE =
  "<Tone>Dry, clipped, and unimpressed. Keep the joke short. If the logic is weak, point at the weakness like it embarrassed itself in public. Stay concise, keep the dead weight out, and do not let the bit outrun the substance.</Tone>";

const DEADPAN_TONE =
  "<Tone>Deadpan and severe. Deliver the joke with a straight face, like the bug report wrote itself and you are simply reading the findings into the record. Keep the language flat, the observations sharp, and the conclusion quietly devastating.</Tone>";

const MENTOR_TONE =
  "<Tone>Strict but constructive. You may roast sloppy thinking, but the point is to correct it, not just admire the wreckage. Name the mistake, explain the fix, and keep the user moving in the right direction.</Tone>";

export const DEFAULT_TONE_ID: ToneId = "roast";

export const TONE_REGISTRY: Record<ToneId, ToneDefinition> = {
  roast: {
    id: "roast",
    title: "Roast",
    description: "Sharp, punchy, and openly judgmental.",
    prompt: TONE,
  },
  dry: {
    id: "dry",
    title: "Dry",
    description: "Short, clipped, and unimpressed.",
    prompt: DRY_TONE,
  },
  deadpan: {
    id: "deadpan",
    title: "Deadpan",
    description: "Flat delivery with quietly brutal conclusions.",
    prompt: DEADPAN_TONE,
  },
  mentor: {
    id: "mentor",
    title: "Mentor",
    description: "Strict guidance with lighter roast.",
    prompt: MENTOR_TONE,
  },
};

export const TONE_IDS = Object.keys(TONE_REGISTRY) as ToneId[];

export const isToneId = (value: unknown): value is ToneId => {
  return typeof value === "string" && value in TONE_REGISTRY;
};

export const getToneDefinition = (toneId: ToneId) => {
  return TONE_REGISTRY[toneId];
};

export const getTonePrompt = (toneId: ToneId) => {
  return getToneDefinition(toneId).prompt;
};

export const getToneIdForPrompt = (prompt: string): ToneId | undefined => {
  return TONE_IDS.find((toneId) => TONE_REGISTRY[toneId].prompt === prompt);
};
