"use client";
import type { UsageRecord } from "./usage.ts";
import { apiFetch } from "./platform/api.ts";

export type UsageTask = { id: string; label: string; startedAt: string; status: "running" | "completed" | "failed" | "cancelled"; records: UsageRecord[] };
const storageKey = "maite-token-usage-v1";
const limit = 300;
let tasks: UsageTask[] = [];
let loaded = false;
const listeners = new Set<() => void>();
const empty: UsageTask[] = [];
export const usageSnapshot = () => tasks;
export const usageServerSnapshot = () => empty;
export const subscribeUsage = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

function recordValid(record: unknown): record is UsageRecord {
  if (!record || typeof record !== "object") return false;
  const r = record as UsageRecord;
  return typeof r.id === "string" && typeof r.feature === "string" && typeof r.model === "string" && typeof r.startedAt === "string" &&
    ["running", "completed", "failed", "unknown"].includes(r.status) && typeof r.durationMs === "number" &&
    [r.inputTokens, r.outputTokens, r.totalTokens, r.cachedTokens, r.reasoningTokens].every(n => n === null || (typeof n === "number" && Number.isSafeInteger(n) && n >= 0));
}
function publish() {
  try { sessionStorage.setItem(storageKey, JSON.stringify(tasks)); } catch { /* In-memory tracking still works. */ }
  listeners.forEach(listener => listener());
}
export function loadUsage() {
  if (loaded) return;
  loaded = true;
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? "[]");
    if (Array.isArray(saved)) tasks = saved.filter((task): task is UsageTask => task && typeof task.id === "string" && typeof task.label === "string" &&
      typeof task.startedAt === "string" && ["running", "completed", "failed", "cancelled"].includes(task.status) && Array.isArray(task.records) && task.records.every(recordValid))
      .slice(0, limit).map(task => ({ ...task, status: task.status === "running" ? "cancelled" : task.status,
        records: task.records.map(record => record.status === "running" ? { ...record, status: "unknown" } : record) }));
  } catch { /* Storage is optional. */ }
  publish();
}
export function startUsageTask(label: string) {
  loadUsage();
  const id = crypto.randomUUID();
  const task: UsageTask = { id, label, startedAt: new Date().toISOString(), status: "running", records: [] };
  tasks = [task, ...tasks].slice(0, limit);
  publish();
  return id;
}
export function addUsageRecord(taskId: string, value: unknown) {
  if (!recordValid(value)) return;
  tasks = tasks.map(task => task.id !== taskId ? task : { ...task,
    records: [...task.records.filter(record => record.id !== value.id), value] });
  publish();
}
export function readUsageHeaders(taskId: string, response: Response) {
  try {
    const records: unknown = JSON.parse(response.headers.get("X-Token-Usage") ?? "[]");
    if (Array.isArray(records)) records.forEach(record => addUsageRecord(taskId, record));
  } catch { /* A missing metric must never fail generation. */ }
}
export function finishUsageTask(id: string, status: UsageTask["status"]) {
  tasks = tasks.map(task => task.id !== id ? task : { ...task, status,
    records: task.records.map(record => record.status === "running" ? { ...record, status: "unknown" } : record) });
  publish();
}
export function clearUsage() { tasks = tasks.filter(task => task.status === "running"); publish(); }
export function sumUsage(records: UsageRecord[], field: "inputTokens" | "outputTokens" | "totalTokens" | "cachedTokens" | "reasoningTokens") {
  return records.reduce((sum, record) => sum + (record[field] ?? 0), 0);
}

// Image endpoints return the existing JPEG plus numeric metrics in response headers.
export async function usageImageFetch(label: string, url: string, init: RequestInit) {
  const id = startUsageTask(label);
  try {
    const response = await apiFetch(url, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), "X-Track-Usage": "1" } });
    readUsageHeaders(id, response);
    finishUsageTask(id, response.ok ? "completed" : "failed");
    return response;
  } catch (error) {
    finishUsageTask(id, init.signal?.aborted ? "cancelled" : "failed");
    throw error;
  }
}
