"use client";
import Link from "next/link";
import { Heart } from "lucide-react";
import { useAccount } from "./AccountProvider";

export default function AccountMenu() {
  const { account } = useAccount();
  const red = (account?.wallet.transferable ?? 0).toLocaleString();
  const blue = (account?.wallet.bonus ?? 0).toLocaleString();
  return <Link className="account-trigger" href="/ideal/store" aria-label="하트 스토어" aria-description={`빨간 하트 ${red}개, 파란 하트 ${blue}개`}>
    <span title="정산 가능한 잔액"><Heart size={16} aria-hidden="true"/>{red}</span>
    <span className="blue-heart" title="정산에서 제외되는 보상 잔액"><Heart size={16} aria-hidden="true"/>{blue}</span>
  </Link>;
}
