import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "千面故事 · AI 互动小说",
  description: "一句话生成可玩的互动故事，每个选择都会改变结局",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
