"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { bridge } from "@/lib/bridge";

// The Web Speech API isn't in TypeScript's DOM types yet; this is the part we use.
interface RecognitionResultEvent {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: RecognitionResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function browserRecognition(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const noSubscribe = () => () => {};

/**
 * Speech-to-text for the composer. In the bubble app it opens Android's
 * "Speak now" screen (the result arrives via the pending channel, handled by
 * the overlay); in browsers it uses the Web Speech API and calls `onText`.
 */
export function useVoiceInput(onText: (text: string) => void) {
  const native = useSyncExternalStore(noSubscribe, () => bridge.capabilities().voice, () => false);
  const browser = useSyncExternalStore(
    noSubscribe,
    () => !bridge.isNative() && browserRecognition() !== null,
    () => false,
  );
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const callback = useRef(onText);
  useEffect(() => {
    callback.current = onText;
  });

  useEffect(() => () => recognition.current?.abort(), []);

  function start() {
    setError(null);
    if (native) {
      bridge.startVoiceInput();
      return;
    }
    const Ctor = browserRecognition();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = document.documentElement.lang || navigator.language;
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (e) => {
      let text = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) text += e.results[i][0].transcript;
      }
      if (text.trim()) callback.current(text.trim());
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setError("Allow microphone access to talk to Bubble.");
      } else if (e.error !== "no-speech" && e.error !== "aborted") {
        setError("Couldn't hear that. Try again.");
      }
    };
    rec.onend = () => {
      setListening(false);
      recognition.current = null;
    };
    recognition.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }

  function stop() {
    recognition.current?.stop();
  }

  return { supported: native || browser, listening, start, stop, error };
}
