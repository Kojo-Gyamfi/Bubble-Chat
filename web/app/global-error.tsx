"use client";

// Last-resort boundary when the root layout itself fails; it replaces the
// whole document, so it can't rely on app styles or providers.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#212121",
          color: "#ececec",
          textAlign: "center",
          padding: 24,
        }}
      >
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Something went wrong</h1>
          <p style={{ fontSize: 14, opacity: 0.7, margin: "8px 0 20px" }}>Your conversations are safe.</p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              height: 40,
              padding: "0 20px",
              borderRadius: 999,
              border: 0,
              background: "#ececec",
              color: "#0d0d0d",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
