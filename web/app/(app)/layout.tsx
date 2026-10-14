"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/components/AuthProvider";
import { FullScreenSpinner } from "@/components/Spinner";

export default function AppLayout({ children }: LayoutProps<"/">) {
  const { user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (user === null) router.replace("/login");
  }, [user, router]);

  if (!user) return <FullScreenSpinner />;
  return children;
}
