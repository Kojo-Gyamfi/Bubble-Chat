import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthProvider } from "@/components/AuthProvider";
import { ServiceWorker } from "@/components/ServiceWorker";
import { iosStartupImages } from "@/lib/ios-splash";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Bubble Chat",
  description: "A private AI chat, built by Nana Kojo",
  authors: [{ name: "Kwadwo Gyamfi (Nana Kojo)" }],
  creator: "Kwadwo Gyamfi (Nana Kojo)",
  appleWebApp: { capable: true, title: "Bubble Chat", statusBarStyle: "default", startupImage: iosStartupImages },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Shrink the layout viewport when the on-screen keyboard opens, so a
  // 100dvh layout keeps the composer above the keyboard.
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#212121" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="h-full">
        <ServiceWorker>
          <AuthProvider>{children}</AuthProvider>
        </ServiceWorker>
      </body>
    </html>
  );
}
