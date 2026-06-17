import {
  messageAsksLengthRequirement,
  userProvidedExplicitLengthRequirement,
} from "@/lib/brainstorm/length-requirement";

export type BrainstormPromptPhase =
  | "gathering"
  | "direction"
  | "mode_select"
  | "section_refine"
  | "ready_to_generate"
  | "ready";

interface BrainstormMessageLike {
  role?: string;
  content: string;
}

const OPTION_REPLY_PATTERN = /^[ABCD](?:[\s,，.。:：]|$)/i;

function answeredPreviousLengthQuestion(
  current: BrainstormMessageLike | undefined,
  previous: BrainstormMessageLike | undefined,
): boolean {
  if (!current || current.role !== "user") return false;
  if (!previous || previous.role !== "ai") return false;
  if (!messageAsksLengthRequirement(previous.content)) return false;

  return userProvidedExplicitLengthRequirement(current)
    || OPTION_REPLY_PATTERN.test(current.content.trim());
}

export function resolveBrainstormPromptPhase(
  phase: BrainstormPromptPhase,
  messages: BrainstormMessageLike[],
): BrainstormPromptPhase {
  if (phase !== "gathering") return phase;

  const current = messages[messages.length - 1];
  const previous = messages[messages.length - 2];
  if (answeredPreviousLengthQuestion(current, previous)) return "direction";

  return phase;
}
