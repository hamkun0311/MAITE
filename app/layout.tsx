import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MAITE — 캐릭터와 함께하는 대화와 이야기",
  description:
    "나만의 2D 캐릭터를 만들고 캐릭터와 대화하거나 이야기를 이어가는 스튜디오",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
