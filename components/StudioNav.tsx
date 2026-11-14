"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Box, Sparkles } from "lucide-react";

export default function StudioNav() {
  const path = usePathname();
  return (
    <nav className="studio-nav" aria-label="스튜디오 메뉴">
      <Link href="/" aria-current={path === "/" ? "page" : undefined}>
        <Box size={16} />
        모양
      </Link>
      <Link href="/ideal" aria-current={path === "/ideal" ? "page" : undefined}>
        <Sparkles size={16} />
        이상형
      </Link>
    </nav>
  );
}
