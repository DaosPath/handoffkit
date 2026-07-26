import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HandoffKit Media Studio",
  description: "Speaker-aware video translation and dubbing workflow demo.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
