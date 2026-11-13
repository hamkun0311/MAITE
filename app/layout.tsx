import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MAITE — 아이디어를 형태로",
  description:
    "채팅으로 모양을 설명하면 OpenAI가 설계하고 브라우저에서 3D 미리보기와 STEP을 만드는 스튜디오",
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
