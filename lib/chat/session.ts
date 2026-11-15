import type { StoryState } from "../novel/state.ts";
import type { SpeechStyle } from "./speech.ts";
import type { ChatMemory } from "./memory.ts";
export type ChatMessage = { role: "user" | "assistant"; content: string };
export type ChatSession = {
  messages: ChatMessage[];
  committed: ChatMessage[];
  input: string;
  notice: string;
  started: boolean;
  storyState?: StoryState;
  speechStyle?: SpeechStyle;
  chatMemory?: ChatMemory;
  clothingDetected?: boolean;
  latestClothingMentioned?: boolean;
};

export function createChatSession(): ChatSession {
  return { messages: [], committed: [], input: "", notice: "", started: false };
}
