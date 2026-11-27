import CharacterStudio from "@/components/CharacterStudio";
import AccountProvider from "@/components/AccountProvider";
import ActionConfirmProvider from "@/components/ActionConfirm";
import ScreenLoadingProvider from "@/components/ScreenLoading";
import Analytics from "@/components/Analytics";
import "@/app/native.css";

export default function CharacterLayout({ children }: { children: React.ReactNode }) {
  return <><Analytics/><ScreenLoadingProvider><AccountProvider><ActionConfirmProvider><CharacterStudio>{children}</CharacterStudio></ActionConfirmProvider></AccountProvider></ScreenLoadingProvider></>;
}
