"use client";
import Link from "next/link";
import { Heart } from "lucide-react";
import { useAccount } from "./AccountProvider";

export default function AccountMenu() {
  const { account } = useAccount();
  return <Link className="account-trigger" href="/ideal/store" aria-label="하트 스토어"><Heart size={16}/><span>{account ? (account.wallet.transferable + account.wallet.bonus).toLocaleString() : "0"}</span></Link>;
}
