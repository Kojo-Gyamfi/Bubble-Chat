export function FullScreenSpinner() {
  return (
    <div className="flex h-dvh items-center justify-center" role="status" aria-label="Loading">
      <div className="size-6 animate-spin rounded-full border-2 border-current border-t-transparent opacity-50" />
    </div>
  );
}
