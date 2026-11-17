import CharacterStudio from "@/components/CharacterStudio";
import AccountProvider from "@/components/AccountProvider";
import ActionConfirmProvider from "@/components/ActionConfirm";
import "@/app/native.css";

export default function CharacterLayout({ children }: { children: React.ReactNode }) {
  return <AccountProvider><ActionConfirmProvider><CharacterStudio>{children}</CharacterStudio></ActionConfirmProvider></AccountProvider>;
}
