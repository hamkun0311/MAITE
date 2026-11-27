"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { trackAnalyticsScreen } from "@/lib/platform/analytics";

export default function Analytics() {
  const path = usePathname();
  useEffect(() => { if (path) trackAnalyticsScreen(path); }, [path]);
  return null;
}
