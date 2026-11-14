"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sparkles } from "lucide-react";

export default function StudioNav() {
  const path = usePathname();
  return (
    <nav className="studio-nav" aria-label="스튜디오 메뉴">
      <Link href="/ideal" aria-current={path === "/ideal" ? "page" : undefined}>
        <Sparkles size={16} />
        캐릭터 생성
      </Link>
    </nav>
  );
}
