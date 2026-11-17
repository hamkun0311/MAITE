import { createRoot } from "react-dom/client";
import { useEffect } from "react";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import CharacterStudio, { CharacterCreationScreen, CharacterActivityScreen, CharacterGalleryScreen } from "../../../components/CharacterStudio";
import { usePathname, navigate } from "./navigation";
import "../../../app/globals.css";
import "../../../app/native.css";
import ActionConfirmProvider from "../../../components/ActionConfirm";
import { CharactersScreen, HeartStoreScreen, StudioHomeScreen } from "../../../components/NativePages";
import AccountProvider from "../../../components/AccountProvider";
import { MyPageScreen, StoreScreen, LibraryDetailScreen } from "../../../components/AccountPages";
function MobileApp() {
  const path = usePathname();
  useEffect(() => {
    if (!path.startsWith("/ideal")) navigate("/ideal", true);
    if (!Capacitor.isNativePlatform()) return;
    const state = App.addListener("appStateChange", ({ isActive }) => { window.dispatchEvent(new Event(isActive ? "maite-foreground" : "maite-background")); });
    const back = App.addListener("backButton", () => {
      const dialog = document.activeElement?.closest<HTMLDialogElement>("dialog[open]") || Array.from(document.querySelectorAll<HTMLDialogElement>("dialog[open]")).at(-1);
      if (dialog) { if (dialog.dispatchEvent(new Event("cancel", { cancelable: true }))) dialog.close(); return; }
      const close = document.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label*="닫기"]');
      if (close) close.click(); else if (location.pathname !== "/ideal") navigate("/ideal"); else void App.minimizeApp();
    });
    return () => { void state.then(listener => listener.remove()); void back.then(listener => listener.remove()); };
  }, []);
  return <AccountProvider><ActionConfirmProvider><CharacterStudio>{path === "/ideal/mypage" ? <MyPageScreen/> : path === "/ideal/store" ? <HeartStoreScreen/> : path === "/ideal/bookshop" ? <StoreScreen/> : path === "/ideal/characters" ? <CharactersScreen/> : path.startsWith("/ideal/characters/") ? <LibraryDetailScreen kind="character"/> : path.startsWith("/ideal/novels/") ? <LibraryDetailScreen kind="novel"/> : path === "/ideal/chat" ? <CharacterActivityScreen mode="chat" /> : path === "/ideal/story" ? <CharacterActivityScreen mode="story" /> : path === "/ideal/gallery" ? <CharacterGalleryScreen /> : path === "/ideal/new" ? <CharacterCreationScreen/> : <StudioHomeScreen/>}</CharacterStudio></ActionConfirmProvider></AccountProvider>;
}
createRoot(document.getElementById("root")!).render(<MobileApp />);
