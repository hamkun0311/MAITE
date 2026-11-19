"use client";
import { useEffect, useRef, useState, type ImgHTMLAttributes } from "react";
import { loadAccountImage } from "@/lib/platform/image-loader";
import { imageViews } from "@/lib/platform/image-views";
import { useAccount } from "./AccountProvider";

const EMPTY_IMAGE = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";

export default function CachedImage({ src, cacheKey, fallbackSrc, onBlob, ...props }: Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & { src: string; cacheKey?: string; fallbackSrc?: string; onBlob?: (blob: Blob) => void }) {
  const { user } = useAccount(); const scope = user?.id || "demo";
  const identity = cacheKey || src;
  const [loaded, setLoaded] = useState<{ key: string; scope: string; url: string }>();
  const [decoded, setDecoded] = useState<{ url: string; scope: string }>();
  const callback = useRef(onBlob); callback.current = onBlob;
  const element = useRef<HTMLImageElement>(null);
  const [visible, setVisible] = useState(false);
  const direct = /^(blob:|data:)/.test(src);
  const shared = !direct ? imageViews.peek(scope, identity) : undefined;
  const lazy = props.loading === "lazy";
  useEffect(() => {
    if (!lazy || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: "300px" });
    if (element.current) observer.observe(element.current);
    return () => observer.disconnect();
  }, [lazy]);
  useEffect(() => {
    if (!identity || direct || (lazy && !visible)) return;
    let active = true; let release: (() => void) | undefined;
    const revision = imageViews.revision;
    const accept = (blob: Blob) => {
      if (!active || revision !== imageViews.revision) return;
      const lease = imageViews.acquire(scope, identity, blob); release = lease.release;
      setLoaded({ key: identity, scope, url: lease.entry.url }); callback.current?.(blob);
    };
    const existing = imageViews.peek(scope, identity);
    if (existing) accept(existing.blob);
    else void loadAccountImage(scope, identity, src).catch(error => {
      if (!fallbackSrc) throw error;
      return loadAccountImage(scope, (cacheKey || src).replace(/:thumbnail$/, ":original"), fallbackSrc);
    }).then(accept).catch(() => { /* Keep the image slot and accessible description; never cache a failed response. */ });
    return () => { active = false; release?.(); };
  }, [src, identity, fallbackSrc, scope, direct, lazy, visible]);
  const imageSrc = direct ? src : shared?.url || (loaded?.key === identity && loaded.scope === scope ? loaded.url : undefined);
  const ready = !!imageSrc && (shared?.decoded || (decoded?.url === imageSrc && decoded.scope === scope));
  return <img {...props} ref={element} src={imageSrc || EMPTY_IMAGE} aria-busy={!ready}
    style={{ ...props.style, ...(!ready ? { visibility: "hidden" as const } : {}) }}
    onLoad={event => {
      props.onLoad?.(event);
      const img = event.currentTarget;
      if (!imageSrc || img.getAttribute("src") !== imageSrc) return;
      if (imageViews.peek(scope, identity)?.decoded && shared?.url === imageSrc) return;
      void img.decode().then(() => {
        if (img.isConnected && img.getAttribute("src") === imageSrc) {
          const entry = imageViews.peek(scope, identity);
          if (entry?.url === imageSrc) entry.decoded = true;
          setDecoded({ url: imageSrc, scope });
        }
      }).catch(() => { /* A failed decode keeps the reserved image area hidden. */ });
    }}
    onError={event => { setDecoded(undefined); props.onError?.(event); }} />;
}
