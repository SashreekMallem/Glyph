import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Glyph — Every document carries its own truth.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Auto-served at /opengraph-image and embedded as og:image when the page
 * is unfurled (Twitter, Slack, iMessage, LinkedIn, etc.). Renders the
 * landing-page hero in a frame designed for social previews.
 */
export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          backgroundColor: "#fafafa",
          backgroundImage:
            "radial-gradient(at 85% 15%, rgba(16,185,129,0.18) 0px, transparent 50%), radial-gradient(at 15% 85%, rgba(251,191,36,0.10) 0px, transparent 45%)",
          padding: "64px 80px",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 56,
            left: 80,
            fontFamily: "Georgia, serif",
            fontSize: 32,
            color: "#0a0a0a",
            letterSpacing: "-0.02em",
          }}
        >
          Glyph
        </div>
        <div
          style={{
            position: "absolute",
            top: 120,
            left: 80,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 16px",
            border: "1px solid rgba(0,0,0,0.08)",
            borderRadius: 999,
            background: "rgba(255,255,255,0.7)",
            fontSize: 16,
            fontFamily: "ui-monospace, SFMono-Regular, monospace",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "#525252",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: "#10b981",
              display: "inline-block",
            }}
          />
          Author free · Consumer pays
        </div>
        <div
          style={{
            position: "absolute",
            top: 200,
            left: 80,
            fontFamily: "Georgia, serif",
            fontSize: 92,
            lineHeight: 1.02,
            color: "#0a0a0a",
            letterSpacing: "-0.02em",
            maxWidth: 720,
          }}
        >
          Every document carries its own truth.
        </div>
        <div
          style={{
            position: "absolute",
            bottom: 56,
            left: 80,
            display: "flex",
            gap: 32,
            fontSize: 18,
            fontFamily: "ui-monospace, SFMono-Regular, monospace",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "#737373",
          }}
        >
          <span>AES-256-GCM</span>
          <span>Ed25519</span>
          <span>MCP-NATIVE</span>
        </div>
        <div
          style={{
            position: "absolute",
            top: 110,
            right: 80,
            width: 360,
            height: 460,
            background: "#fdfcfa",
            borderRadius: 16,
            boxShadow:
              "0 30px 60px -20px rgba(0,0,0,0.25), 0 18px 36px -18px rgba(0,0,0,0.18)",
            transform: "rotate(3deg)",
            padding: "36px 32px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              fontFamily: "ui-monospace, monospace",
              fontSize: 11,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: "#a3a3a3",
            }}
          >
            Resume · Ada Lovelace
          </div>
          <div
            style={{
              marginTop: 12,
              fontFamily: "Georgia, serif",
              fontSize: 40,
              color: "#0a0a0a",
              letterSpacing: "-0.02em",
              lineHeight: 1.05,
            }}
          >
            Ada Lovelace
          </div>
          <div
            style={{
              marginTop: 4,
              fontSize: 16,
              color: "#737373",
              fontFamily: "Georgia, serif",
            }}
          >
            Lead Algorithmist · 1843–1852
          </div>
          <div
            style={{
              marginTop: 24,
              borderTop: "1px solid #e5e5e5",
              paddingTop: 16,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {[300, 240, 280, 200, 260].map((w, i) => (
              <div
                key={i}
                style={{
                  width: w,
                  height: 6,
                  background: "#262626",
                  borderRadius: 3,
                }}
              />
            ))}
          </div>
          <div
            style={{
              marginTop: "auto",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontFamily: "ui-monospace, monospace",
              fontSize: 11,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              paddingTop: 12,
            }}
          >
            <span style={{ color: "#a3a3a3" }}>glyph stamp</span>
            <span style={{ color: "#10b981" }}>✓ signed</span>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
