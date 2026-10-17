"use client";

import { useSyncExternalStore } from "react";
import { bridge, onNativeEvent } from "@/lib/bridge";

/** Markdown answer → plain sentences for text-to-speech. Code isn't read out. */
export function speechText(markdown: string): string {
  return (
    markdown
      .replace(/```[\s\S]*?(```|$)/g, "\n(Code block omitted.)\n")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/https?:\/\/\S+/g, "link")
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s*>\s?/gm, "")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/^\s*\|?[\s:|-]+\|[\s:|-]*$/gm, "") // table separator rows
      .replace(/\|/g, ", ")
      .replace(/_\((.*?)\)_/g, "$1") // "_(stopped)_" notes, before italics eat the underscores
      .replace(/(\*\*|__)(.*?)\1/g, "$2")
      .replace(/(\*|_)(.*?)\1/g, "$2")
      .replace(/~~(.*?)~~/g, "$1")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{2,}/g, "\n")
      .trim()
  );
}

/** Browsers stop long utterances after ~15 s, so speak sentence-sized pieces. */
export function speechChunks(text: string, max = 220): string[] {
  const sentences = text.match(/[^.!?\n]+[.!?]*[\n]?|\n/g) ?? [text];
  const chunks: string[] = [];
  let current = "";
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    if ((current + " " + sentence).trim().length > max && current) {
      chunks.push(current);
      current = "";
    }
    // A single overlong sentence is split on commas/spaces.
    if (sentence.length > max) {
      for (const piece of sentence.match(new RegExp(`.{1,${max}}(\\s|$)`, "g")) ?? [sentence]) chunks.push(piece.trim());
      continue;
    }
    current = `${current} ${sentence}`.trim();
  }
  if (current) chunks.push(current);
  return chunks;
}

// ---- which message is being read, shared by every Read aloud button ----

let speakingId: string | null = null;
const listeners = new Set<() => void>();

function setSpeaking(id: string | null) {
  speakingId = id;
  listeners.forEach((l) => l());
}

let nativeSubscribed = false;
function subscribeNativeEvents() {
  if (nativeSubscribed || typeof window === "undefined") return;
  nativeSubscribed = true;
  onNativeEvent((e) => {
    if (e.type === "tts-end") setSpeaking(null);
  });
}

function browserSpeech(): SpeechSynthesis | null {
  return typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;
}

/** True if this device can read answers aloud. */
export function canSpeak(): boolean {
  return bridge.capabilities().speech || (!bridge.isNative() && browserSpeech() !== null);
}

export function stopSpeaking() {
  if (bridge.capabilities().speech) bridge.stopSpeaking();
  browserSpeech()?.cancel();
  setSpeaking(null);
}

export function speak(id: string, markdown: string) {
  stopSpeaking();
  const text = speechText(markdown);
  if (!text) return;

  if (bridge.capabilities().speech) {
    subscribeNativeEvents();
    if (bridge.speak(text)) setSpeaking(id);
    return;
  }

  const synth = browserSpeech();
  if (!synth) return;
  const chunks = speechChunks(text);
  chunks.forEach((chunk, i) => {
    const utterance = new SpeechSynthesisUtterance(chunk);
    utterance.lang = document.documentElement.lang || navigator.language;
    if (i === chunks.length - 1) {
      utterance.onend = () => speakingId === id && setSpeaking(null);
    }
    utterance.onerror = () => speakingId === id && setSpeaking(null);
    synth.speak(utterance);
  });
  setSpeaking(id);
}

/** The message ID currently being read aloud, or null. */
export function useSpeakingId(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => speakingId,
    () => null,
  );
}
