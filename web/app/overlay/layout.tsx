import type { Metadata } from "next";

// No app chrome: the bubble's panel is ~320×480. viewport-fit=cover and the
// keyboard-resize behaviour come from the root layout's viewport export.
export const metadata: Metadata = {
  title: "Bubble",
};

export default function OverlayLayout({ children }: LayoutProps<"/overlay">) {
  return children;
}
