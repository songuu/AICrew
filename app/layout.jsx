import "../src/styles.css";

export const metadata = {
  title: "AICrew Studio",
  description: "AI creative operating system for commerce, social media, and video storytelling"
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
