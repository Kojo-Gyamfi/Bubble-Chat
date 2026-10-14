export const metadata = { title: "Offline · Bubble Chat" };

export default function OfflinePage() {
  return (
    <main className="safe-area flex h-dvh items-center justify-center p-6 text-center">
      <div className="max-w-sm space-y-2">
        <h1 className="text-lg font-semibold">You&apos;re offline</h1>
        <p className="text-sm opacity-70">Reconnect to keep chatting. Your history is safe.</p>
      </div>
    </main>
  );
}
