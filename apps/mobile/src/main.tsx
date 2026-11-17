import { createRoot } from "react-dom/client";
import { useEffect } from "react";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import CharacterStudio, { CharacterCreationScreen, CharacterActivityScreen, CharacterGalleryScreen } from "../../../components/CharacterStudio";
import { usePathname, navigate } from "./navigation";
import "../../../app/globals.css";
function MobileApp() {
  const path = usePathname();
  useEffect(() => {
    if (!path.startsWith("/ideal")) navigate("/ideal", true);
    if (!Capacitor.isNativePlatform()) return;
    const state = App.addListener("appStateChange", ({ isActive }) => { window.dispatchEvent(new Event(isActive ? "maite-foreground" : "maite-background")); });
    const back = App.addListener("backButton", () => {
      const dialog = document.querySelector<HTMLDialogElement>("dialog[open]");
      if (dialog) { dialog.close(); return; }
      const close = document.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label*="닫기"]');
      if (close) close.click(); else if (location.pathname !== "/ideal") navigate("/ideal"); else void App.minimizeApp();
    });
    return () => { void state.then(listener => listener.remove()); void back.then(listener => listener.remove()); };
  }, []);
  return <CharacterStudio>{path === "/ideal/chat" ? <CharacterActivityScreen mode="chat" /> : path === "/ideal/story" ? <CharacterActivityScreen mode="story" /> : path === "/ideal/gallery" ? <CharacterGalleryScreen /> : <CharacterCreationScreen />}</CharacterStudio>;
}
createRoot(document.getElementById("root")!).render(<MobileApp />);
