import { Heart } from "lucide-react";

export default function WalletBalance({ wallet }: { wallet?: { transferable: number; bonus: number } }) {
  return <dl className="wallet-balances">
    <div className="wallet-balance wallet-balance-red">
      <dt>빨간 하트</dt>
      <dd><Heart fill="currentColor" size={24} aria-hidden="true"/><strong>{(wallet?.transferable ?? 0).toLocaleString()}</strong></dd>
      <small>정산 가능</small>
    </div>
    <div className="wallet-balance wallet-balance-blue">
      <dt>파란 하트</dt>
      <dd><Heart fill="currentColor" size={24} aria-hidden="true"/><strong>{(wallet?.bonus ?? 0).toLocaleString()}</strong></dd>
      <small>정산 제외</small>
    </div>
  </dl>;
}
