import type { Metadata } from "next";
import type { ReactNode } from "react";
import "../styles/globals.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH || "/aicrew";
const iconBasePath = configuredBasePath === "/" ? "" : configuredBasePath.replace(/\/$/, "");

export const metadata: Metadata = {
  title: "AICrew Studio",
  description: "AI creative operating system for commerce, social media, and video storytelling",
  icons: {
    icon: [
      { url: `${iconBasePath}/favicon.ico` },
      { url: `${iconBasePath}/favicon.svg`, type: "image/svg+xml" }
    ],
    shortcut: `${iconBasePath}/favicon.ico`
  }
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}