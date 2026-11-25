import { emptyTimeline, type TimelineStore } from "./timeline.ts";
import type { StoryState } from "../novel/state.ts";
import type { SpeechStyle } from "./speech.ts";
import type { ChatMemory } from "./memory.ts";
import type { VisualScene } from "./visual-scene.ts";
export type ChatMessage = { role: "user" | "assistant"; content: string; checkinId?: string; readerNickname?: string | null };
export type ChatSession = {
  timeline?: TimelineStore;
  messages: ChatMessage[];
  committed: ChatMessage[];
  // Display/persistence history is independent of the compact API context.
  archive?: ChatMessage[];
  input: string;
  notice: string;
  started: boolean;
  storyState?: StoryState;
  storyPage?: number;
  storyPreview?: string;
  documentId?: string;
  lastJobId?: string;
  speechStyle?: SpeechStyle;
  speechPreference?: SpeechStyle;
  chatMemory?: ChatMemory;
  visualScene?: VisualScene;
  visualDetected?: boolean;
  latestVisualChange?: boolean;
  clothingDetected?: boolean;
  latestClothingMentioned?: boolean;
};

export function createChatSession(): ChatSession {
  return { messages: [], committed: [], input: "", notice: "", started: false };
}

export function createStudioSessions() {
  const timeline = { state: emptyTimeline() };
  return { chat: { ...createChatSession(), timeline }, story: { ...createChatSession(), timeline } };
}
