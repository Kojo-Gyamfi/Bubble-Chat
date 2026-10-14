"use client";

import { useAuth } from "@/components/AuthProvider";
import { ChatApp } from "@/components/chat/ChatApp";

export default function ChatPage() {
  const { user } = useAuth();
  // The (app) layout only renders children once a user is signed in.
  return user ? <ChatApp user={user} /> : null;
}
