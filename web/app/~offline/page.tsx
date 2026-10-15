"use client";

import { WifiOff } from "lucide-react";
import { Notice, PrimaryButton } from "@/components/ui";

export default function OfflinePage() {
  return (
    <Notice
      icon={WifiOff}
      title="You're offline"
      action={<PrimaryButton onClick={() => window.location.reload()}>Try again</PrimaryButton>}
    >
      Reconnect to keep chatting. Your conversations are saved.
    </Notice>
  );
}
