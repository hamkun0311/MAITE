"use client";
import {useCheckinInbox} from "./CheckinInbox";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Library, ShoppingBag, UserRound, UsersRound, BookOpen } from "lucide-react";
export default function AppFooter() {
  const path = usePathname(),unread=useCheckinInbox();
  const count=Object.values(unread).reduce((sum,n)=>sum+n,0);
  return <nav className="app-footer-nav" aria-label="하단 메뉴">
    <Link aria-label="캐릭터" href="/ideal/characters" aria-current={path.startsWith("/ideal/characters") || path === "/ideal/new" || path === "/ideal" || ["/ideal/chat", "/ideal/story", "/ideal/gallery"].includes(path) ? "page" : undefined}><span className="footer-character-icon"><UsersRound size={22}/>{count>0&&<i className="checkin-footer-dot" aria-label="읽지 않은 안부 도착" role="img"/>}</span>캐릭터</Link>
    <Link href="/ideal/library" aria-current={path.startsWith("/ideal/library") || path.startsWith("/ideal/novels/") ? "page" : undefined}><Library size={22}/>서고</Link>
    <Link href="/ideal/bookshop" aria-current={path.startsWith("/ideal/bookshop") ? "page" : undefined}><BookOpen size={22}/>서점</Link>
    <Link href="/ideal/store" aria-current={path.startsWith("/ideal/store") ? "page" : undefined}><ShoppingBag size={22}/>스토어</Link>
    <Link href="/ideal/mypage" aria-current={["/ideal/mypage", "/ideal/rewards", "/ideal/support", "/ideal/settlements", "/ideal/notices"].includes(path) ? "page" : undefined}><UserRound size={22}/>내 정보</Link>
  </nav>;
}
