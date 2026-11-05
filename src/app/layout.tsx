import type { Metadata } from "next";
import type { Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

const inter = localFont({
  variable: "--font-inter",
  src: [
    { path: "./fonts/inter-400.woff", weight: "400", style: "normal" },
    { path: "./fonts/inter-600.woff", weight: "600", style: "normal" },
  ],
  display: "swap",
});

const spaceGrotesk = localFont({
  variable: "--font-space-grotesk",
  src: [
    { path: "./fonts/space-grotesk-400.ttf", weight: "400", style: "normal" },
    { path: "./fonts/space-grotesk-600.ttf", weight: "600", style: "normal" },
  ],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Clip Panel",
  description: "Панель управления заявками на клипы.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ru"
      className={`${inter.variable} ${spaceGrotesk.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
