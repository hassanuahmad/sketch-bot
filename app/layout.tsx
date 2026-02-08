import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SketchBot | Robot-Drawn Sketches",
  description: "Design in pixels, then a robot draws it on paper for real.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
