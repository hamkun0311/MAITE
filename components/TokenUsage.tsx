"use client";
import { saveFile } from "@/lib/platform/native";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { Download, X } from "lucide-react";
import { clearUsage, loadUsage, subscribeUsage, sumUsage, usageServerSnapshot, usageSnapshot } from "@/lib/usage-store";

const names: Record<string, string> = { "chat.speech": "말투 선택", "chat.reply": "대화 생성", "chat.clothing": "의상 판별",
  "novel.series_plan": "5회차 뼈대·현재 회차 설계", "novel.passage_repair": "원고 부분 수정", "novel.repair_proofread": "수정 구절 교정",
  "novel.chapter_plan": "회차 설계", "novel.prose": "원고 집필 / 재집필", "novel.write": "원고 집필", "novel.rewrite": "원고 재집필", "novel.scene_write": "회차 장면 집필", "novel.scene_metadata": "장면 정보 복구", "novel.scene_patch": "장면 부분 보정", "novel.scene_insert": "소설 장면 추가", "novel.proofread": "문맥·단어 교정", "novel.style_edit": "문체 편집", "novel.chapter_review": "전개 검증", "novel.memory_patch": "기억 추출",
  "image.description": "이미지 설명 정리", "image.generate": "이미지 생성" };
const statuses = { running: "진행 중", completed: "완료", failed: "실패", cancelled: "중단", unknown: "확인 불가" };
const number = (value: number | null) => value === null ? "확인 불가" : value.toLocaleString("ko-KR");
const seconds = (milliseconds: number) => `${(milliseconds / 1000).toFixed(1)}초`;
export default function TokenUsage() {
  const tasks = useSyncExternalStore(subscribeUsage, usageSnapshot, usageServerSnapshot);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    loadUsage();
    const open = () => { if (!dialog.current?.open) dialog.current?.showModal(); };
    window.addEventListener("maite-open-token-usage", open);
    return () => window.removeEventListener("maite-open-token-usage", open);
  }, []);
  const records = tasks.flatMap(task => task.records);
  const total = sumUsage(records, "totalTokens");
  const unknown = records.filter(record => record.totalTokens === null && record.status !== "running").length;
  function download() {
    const rows: (string | number | null | undefined)[][] = [["작업 ID", "작업", "시작 시각", "작업 상태", "호출 ID", "단계", "모델", "호출 상태", "입력", "출력", "합계", "캐시 입력(입력에 포함)", "추론(출력에 포함)", "소요 ms", "응답 ID"]];
    for (const task of tasks) {
      if (!task.records.length) rows.push([task.id, task.label, task.startedAt, statuses[task.status], "", "호출 사용량 미수신"]);
      for (const record of task.records) rows.push([task.id, task.label, task.startedAt, statuses[task.status], record.id, names[record.feature] ?? record.feature,
        record.model, statuses[record.status], record.inputTokens, record.outputTokens, record.totalTokens, record.cachedTokens, record.reasoningTokens, record.durationMs, record.responseId]);
    }
    const csv = "\uFEFF" + rows.map(row => row.map(value => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n");
    void saveFile(new Blob([csv], { type: "text/csv;charset=utf-8" }), `maite-tokens-${new Date().toISOString().replaceAll(":", "-")}.csv`).catch(() => window.alert("사용량 파일을 저장하지 못했습니다."));
  }
  return <dialog ref={dialog} className="token-usage-dialog" aria-labelledby="token-usage-title" onClick={event => { if (event.target === dialog.current) dialog.current.close(); }}>
      <div className="token-usage-panel">
        <header><h2 id="token-usage-title">토큰 사용량</h2><button type="button" aria-label="토큰 사용량 닫기" onClick={() => dialog.current?.close()}><X size={20} /></button></header>
        <p>이 탭에서 실행한 대화·이야기·이미지 작업의 기록입니다. 각 모델 호출 종료 후 실제 사용량이 갱신됩니다.</p>
        <div className="token-usage-summary" aria-live="polite"><strong>확인된 합계 {number(total)} 토큰</strong><span>입력 {number(sumUsage(records, "inputTokens"))} · 출력 {number(sumUsage(records, "outputTokens"))}</span><span>{tasks.length}개 작업 · {records.length}회 호출{unknown > 0 ? ` · 사용량 확인 불가 ${unknown}회` : ""}</span></div>
        {records.length > 0 && <div className="token-usage-models">{[...new Set(records.map(record => record.model))].map(model => <p key={model}>{model}: {number(sumUsage(records.filter(record => record.model === model), "totalTokens"))} 토큰</p>)}</div>}
        <p>캐시 입력은 입력에, 추론은 출력에 포함됩니다. 중단·통신 오류로 미수신한 사용량은 합계에서 빠지므로 실제 소비량이 더 클 수 있습니다. 이미지 토큰도 포함하며 무료 잔여량·청구액을 뜻하지 않습니다.</p>
        <div className="token-usage-actions"><button type="button" onClick={download} disabled={!tasks.length}><Download size={15} />CSV 다운로드</button><button type="button" onClick={clearUsage} disabled={!tasks.some(task => task.status !== "running")}>완료 기록 비우기</button></div>
        <p>최근 300개 작업을 이 탭에 보관합니다. 새로고침 후에도 남으며 탭을 닫으면 삭제됩니다. 보관 한도 전에 CSV로 기록해주세요. 이미지 작업은 전체 응답을 받은 뒤 표시됩니다.</p>
        {!tasks.length && <div className="token-usage-empty">아직 기록된 작업이 없습니다. 대화나 이야기를 시작하면 여기에 표시됩니다.</div>}
        {tasks.map(task => <details className="token-usage-task" key={task.id} open={task.status === "running" || undefined}>
          <summary><span>{task.label} · {new Date(task.startedAt).toLocaleTimeString("ko-KR")} · {statuses[task.status]}</span><strong>{task.records.length ? `${number(sumUsage(task.records, "totalTokens"))} 토큰${task.records.some(record => record.totalTokens === null) ? " + 미확인" : ""}` : "사용량 미수신"}</strong></summary>
          {!task.records.length ? <p>{task.status === "running" ? "호출 사용량을 기다리고 있습니다." : "호출 사용량을 받지 못했습니다. 호출 전 거절 또는 중단·통신 오류 등이 원인일 수 있습니다."}</p> : <div className="token-usage-table"><table><thead><tr><th>단계 / 모델</th><th>상태</th><th>입력</th><th>출력</th><th>합계</th><th>캐시 입력</th><th>추론</th><th>소요 시간</th></tr></thead><tbody>{task.records.map(record => <tr key={record.id}><td>{names[record.feature] ?? record.feature}<small>{record.model}</small></td><td>{statuses[record.status]}</td><td>{number(record.inputTokens)}</td><td>{number(record.outputTokens)}</td><td>{number(record.totalTokens)}</td><td>{number(record.cachedTokens)}</td><td>{number(record.reasoningTokens)}</td><td>{record.status === "running" ? "진행 중" : seconds(record.durationMs)}</td></tr>)}</tbody></table></div>}
        </details>)}
      </div>
  </dialog>;
}
