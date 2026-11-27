import { Capacitor, registerPlugin } from "@capacitor/core";

const screens: Readonly<Record<string, string>> = {
  "/ideal": "home",
  "/ideal/characters": "characters",
  "/ideal/new": "character_creation",
  "/ideal/chat": "chat",
  "/ideal/story": "story",
  "/ideal/gallery": "gallery",
  "/ideal/library": "library",
  "/ideal/bookshop": "bookshop",
  "/ideal/store": "heart_store",
  "/ideal/mypage": "account",
  "/ideal/rewards": "rewards",
  "/ideal/notices": "notices",
  "/ideal/support": "support",
  "/ideal/settlements": "settlements",
};

export function analyticsScreen(path: string) {
  if (Object.hasOwn(screens, path)) return screens[path];
  if (/^\/ideal\/characters\/[^/]+$/.test(path)) return "character_detail";
  if (/^\/ideal\/novels\/[^/]+$/.test(path)) return "novel_detail";
  if (/^\/ideal\/library\/gallery\/[^/]+$/.test(path)) return "purchased_gallery";
  if (/^\/ideal\/library\/[^/]+$/.test(path)) return "purchased_novel";
}

type EventName = "character_created" | "chat_message_completed" | "chapter_created" | "chat_image_created"
  | "illustration_created" | "heart_purchase_completed" | "rewarded_ad_granted" | "attendance_claimed"
  | "pass_reward_claimed" | "character_purchased" | "chapter_purchased";
const native = registerPlugin<{ record(input: { name: string; screen?: string }): Promise<void> }>("MaiteAnalytics");
let previousPath: string | undefined;
let webTag: ((...args: unknown[]) => void) | undefined;

function webAnalytics() {
  const id = process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID?.trim();
  if (!id || !/^G-[A-Z0-9]+$/.test(id)) return;
  if (!webTag) {
    const target = window as Window & { dataLayer?: unknown[] };
    const queue = target.dataLayer ??= [];
    webTag = function (..._args: unknown[]) { queue.push(arguments); };
    webTag("js", new Date());
    webTag("config", id, {
      send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false,
      page_location: location.origin + "/ideal", page_referrer: "", page_title: "MAITE",
    });
    const script = document.createElement("script");
    script.async = true;
    script.referrerPolicy = "no-referrer";
    script.src = "https://www.googletagmanager.com/gtag/js?id=" + id;
    document.head.append(script);
  }
  return webTag;
}

export function trackAnalyticsScreen(path: string) {
  if (typeof window === "undefined" || path === previousPath) return;
  previousPath = path;
  const screen = analyticsScreen(path);
  if (!screen) return;
  if (Capacitor.isNativePlatform()) {
    void native.record({ name: "screen_view", screen }).catch(() => {});
    return;
  }
  const tag = webAnalytics();
  const page = { page_location: location.origin + "/ideal/" + screen, page_referrer: "", page_title: screen };
  tag?.("set", page);
  tag?.("event", "page_view", page);
}

export function trackAnalyticsEvent(name: EventName) {
  if (typeof window === "undefined") return;
  if (Capacitor.isNativePlatform()) {
    void native.record({ name }).catch(() => {});
    return;
  }
  webAnalytics()?.("event", name);
}
