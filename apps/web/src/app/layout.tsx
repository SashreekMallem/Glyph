import type { Metadata } from "next";
import { GOOGLE_FONTS } from "@glyph/style-profile";
import "./globals.css";
import { Providers } from "./providers";

// Build a single Google Fonts URL covering every family the style-profile
// picker can offer. Loaded once at the document root so the live preview
// pane (and any document that picks one of these) renders without an
// in-flight font-fetch flicker. We request the regular weight only —
// preview text doesn't need the full 100..900 spectrum and the bigger
// request quickly blows past Google's URL-length cap.
const GOOGLE_FONTS_HREF = `https://fonts.googleapis.com/css2?${GOOGLE_FONTS.map(
  (family) => `family=${family.replace(/ /g, "+")}`,
).join("&")}&display=swap`;

export const metadata: Metadata = {
  metadataBase: new URL("https://glyph.dev"),
  title: {
    default: "Glyph — Every document carries its own truth.",
    template: "%s · Glyph",
  },
  description:
    "Glyph extracts structured data once at creation and embeds it inside the document — encrypted, signed, self-healing. Authors publish for free. Consumers read in 2 ms.",
  openGraph: {
    title: "Glyph — Every document carries its own truth.",
    description:
      "Author-free, consumer-pays document extraction. Self-healing sync. MCP-native.",
    url: "https://glyph.dev",
    siteName: "Glyph",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Glyph — Every document carries its own truth.",
    description:
      "Author-free, consumer-pays document extraction. Self-healing sync. MCP-native.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link rel="stylesheet" href={GOOGLE_FONTS_HREF} />
      </head>
      <body className="min-h-screen font-sans antialiased bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
