import { useSyncExternalStore } from "react";
const listeners = new Set<() => void>();
function emit() { listeners.forEach(listener => listener()); }
if (typeof window !== "undefined") window.addEventListener("popstate", emit);
export function navigate(path: string, replace = false) {
  if (!/^\/ideal(?:\/(?:chat|story|new|characters|bookshop|store|mypage|library|rewards)|\/gallery(?:\?from=(?:chat|story))?|\/(?:characters|novels|library)\/[0-9a-f-]{36})?$/.test(path)) path = "/ideal";
  if (replace) history.replaceState({}, "", path); else history.pushState({}, "", path);
  emit();
}
export function usePathname() { return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => location.pathname, () => "/ideal"); }
export function useRouter() { return { push: (path: string, _options?: { scroll?: boolean }) => navigate(path), replace: (path: string) => navigate(path, true), back: () => history.back() }; }
