"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sparkles, ShoppingBag, UserRound, UsersRound, BookOpen } from "lucide-react";
import { accountEnabled } from "@/lib/account/client";
export default function AppFooter() {
  const path = usePathname();
  return <nav className="app-footer-nav" aria-label="하단 메뉴">
    <Link href="/ideal/characters" aria-current={path.startsWith("/ideal/characters") || path.startsWith("/ideal/novels/") || (path === "/ideal" && accountEnabled()) || ["/ideal/chat", "/ideal/story", "/ideal/gallery"].includes(path) ? "page" : undefined}><UsersRound size={22}/>캐릭터</Link>
    <Link href="/ideal/new" aria-current={path === "/ideal/new" || (path === "/ideal" && !accountEnabled()) ? "page" : undefined}><Sparkles size={22}/>뉴페이스</Link>
    <Link href="/ideal/bookshop" aria-current={path.startsWith("/ideal/bookshop") ? "page" : undefined}><BookOpen size={22}/>서점</Link>
    <Link href="/ideal/store" aria-current={path.startsWith("/ideal/store") ? "page" : undefined}><ShoppingBag size={22}/>스토어</Link>
    <Link href="/ideal/mypage" aria-current={path === "/ideal/mypage" ? "page" : undefined}><UserRound size={22}/>마이페이지</Link>
  </nav>;
}
