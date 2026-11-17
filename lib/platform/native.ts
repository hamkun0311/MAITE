"use client";
import { Capacitor } from "@capacitor/core";
export const isNative = () => Capacitor.isNativePlatform();
export async function saveFile(blob: Blob, name: string) {
  if (!isNative()) {
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); return;
  }
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([import("@capacitor/filesystem"), import("@capacitor/share")]);
  const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = reject; reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.readAsDataURL(blob); });
  const file = await Filesystem.writeFile({ path: `maite/${Date.now()}-${name.replace(/[^\p{L}\p{N}_.-]/gu, "_")}`, data, directory: Directory.Cache, recursive: true });
  await Share.share({ files: [file.uri], title: name });
}
