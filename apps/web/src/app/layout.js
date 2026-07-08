import { Outfit, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-sans",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata = {
  title: "HandoffKit // Visual Agent Workspaces",
  description: "Dynamic multi-agent state verification, execution tracing, and report galleries.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${outfit.variable} ${jetbrainsMono.variable}`}>
      <body style={{ minHeight: "100vh", position: "relative" }}>
        {children}
      </body>
    </html>
  );
}
