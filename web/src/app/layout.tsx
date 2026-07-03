import type { Metadata } from "next";
import "./globals.css";

// No next/font — LightMatch must run fully offline. The system font stack is set in
// globals.css (@theme --font-sans / --font-mono).

export const metadata: Metadata = {
  title: "LightMatch · match your render's light to any reference",
  description:
    "Drop a reference and your base render. LightMatch returns an exact, copy-able lighting recipe in your renderer's own UI vocabulary, for V-Ray 7 or Chaos Vantage 3.3.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
