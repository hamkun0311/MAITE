"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Library, ShoppingBag, UserRound, UsersRound, BookOpen } from "lucide-react";
export default function AppFooter() {
  const path = usePathname();
  return <nav className="app-footer-nav" aria-label="하단 메뉴">
    <Link href="/ideal/characters" aria-current={path.startsWith("/ideal/characters") || path === "/ideal/new" || path === "/ideal" || ["/ideal/chat", "/ideal/story", "/ideal/gallery"].includes(path) ? "page" : undefined}><UsersRound size={22}/>캐릭터</Link>
    <Link href="/ideal/library" aria-current={path.startsWith("/ideal/library") || path.startsWith("/ideal/novels/") ? "page" : undefined}><Library size={22}/>서고</Link>
    <Link href="/ideal/bookshop" aria-current={path.startsWith("/ideal/bookshop") ? "page" : undefined}><BookOpen size={22}/>서점</Link>
    <Link href="/ideal/store" aria-current={path.startsWith("/ideal/store") ? "page" : undefined}><ShoppingBag size={22}/>스토어</Link>
    <Link href="/ideal/mypage" aria-current={path === "/ideal/mypage" || path === "/ideal/rewards" ? "page" : undefined}><UserRound size={22}/>마이페이지</Link>
  </nav>;
}
