import type { Metadata } from "next";
import type { ReactNode } from "react";
import "../styles/globals.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "AICrew Studio",
  description: "AI creative operating system for commerce, social media, and video storytelling"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}