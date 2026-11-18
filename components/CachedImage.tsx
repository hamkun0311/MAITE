"use client";
import { useEffect, useRef, useState, type ImgHTMLAttributes } from "react";
import { loadAccountImage } from "@/lib/platform/image-loader";
import { useAccount } from "./AccountProvider";

const EMPTY_IMAGE = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";

export default function CachedImage({ src, cacheKey, fallbackSrc, onBlob, ...props }: Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & { src: string; cacheKey?: string; fallbackSrc?: string; onBlob?: (blob: Blob) => void }) {
  const { user } = useAccount(); const scope = user?.id || "demo";
  const [loaded, setLoaded] = useState<{ source: string; scope: string; url: string }>();
  const [decoded, setDecoded] = useState<{ url: string; scope: string }>();
  const callback = useRef(onBlob); callback.current = onBlob;
  const element = useRef<HTMLImageElement>(null);
  const [visible, setVisible] = useState(false);
  const direct = /^(blob:|data:)/.test(src);
  const lazy = props.loading === "lazy";
  useEffect(() => {
    if (!lazy || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: "300px" });
    if (element.current) observer.observe(element.current);
    return () => observer.disconnect();
  }, [lazy]);
  useEffect(() => {
    if (!src || direct || (lazy && !visible)) return;
    let active = true; let ownedUrl: string | undefined;
    void loadAccountImage(scope, cacheKey || src, src).catch(error => {
      if (!fallbackSrc) throw error;
      return loadAccountImage(scope, (cacheKey || src).replace(/:thumbnail$/, ":original"), fallbackSrc);
    }).then(blob => {
      if (!active) return;
      ownedUrl = URL.createObjectURL(blob); setLoaded({ source: src, scope, url: ownedUrl }); callback.current?.(blob);
    }).catch(() => { /* Keep the image slot and accessible description; never cache a failed response. */ });
    return () => { active = false; if (ownedUrl) URL.revokeObjectURL(ownedUrl); };
  }, [src, cacheKey, fallbackSrc, scope, direct, lazy, visible]);
  const imageSrc = direct ? src : loaded?.source === src && loaded.scope === scope ? loaded.url : undefined;
  const ready = !!imageSrc && decoded?.url === imageSrc && decoded.scope === scope;
  return <img {...props} ref={element} src={imageSrc || EMPTY_IMAGE} aria-busy={!ready}
    style={{ ...props.style, ...(!ready ? { visibility: "hidden" as const } : {}) }}
    onLoad={event => {
      props.onLoad?.(event);
      const img = event.currentTarget;
      if (!imageSrc || img.getAttribute("src") !== imageSrc) return;
      void img.decode().then(() => {
        if (img.isConnected && img.getAttribute("src") === imageSrc) setDecoded({ url: imageSrc, scope });
      }).catch(() => { /* A failed decode keeps the reserved image area hidden. */ });
    }}
    onError={event => { setDecoded(undefined); props.onError?.(event); }} />;
}
