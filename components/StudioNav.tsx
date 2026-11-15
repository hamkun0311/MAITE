"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Images, Sparkles } from "lucide-react";

export default function StudioNav() {
  const path = usePathname();
  return (
    <nav className="studio-nav" aria-label="스튜디오 메뉴">
      <Link href="/ideal" aria-current={path === "/ideal" ? "page" : undefined}>
        <Sparkles size={16} />
        캐릭터 생성
      </Link>
      <Link href="/ideal/gallery" aria-current={path === "/ideal/gallery" ? "page" : undefined}>
        <Images size={16} />
        갤러리
      </Link>
    </nav>
  );
}
