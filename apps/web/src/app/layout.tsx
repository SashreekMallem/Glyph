import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

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
      <body className="min-h-screen font-sans antialiased bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
