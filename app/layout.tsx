import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MAITE — 모양과 이상형을 그리는 스튜디오",
  description:
    "채팅으로 3D 모양을 설계하고 취향에 맞는 2D 애니메이션 캐릭터를 만드는 스튜디오",
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
