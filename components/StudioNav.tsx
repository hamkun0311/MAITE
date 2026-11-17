"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Images } from "lucide-react";

export default function StudioNav() {
  const path = usePathname();
  return (
    <nav className="studio-nav" aria-label="스튜디오 메뉴">
      <Link href="/ideal/gallery" aria-current={path === "/ideal/gallery" ? "page" : undefined}>
        <Images size={16} />
        갤러리
      </Link>
    </nav>
  );
}
