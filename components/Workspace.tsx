"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Box,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Code2,
  Cuboid,
  FileBox,
  History,
  LoaderCircle,
  Maximize2,
  PanelLeftClose,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import {
  DEFAULT_PLATE,
  makeSpecification,
  plateSchema,
  type CadResult,
  type PlateParameters,
  type WorkerMessage,
} from "@/lib/cad/schema";

const CadViewer = dynamic(() => import("./CadViewer"), {
  ssr: false,
  loading: () => (
    <div className="viewport loading-view">
      <LoaderCircle className="spin" />
      뷰어 준비 중
    </div>
  ),
});
type Entry = {
  id: string;
  name: string;
  parameters: PlateParameters;
  createdAt: string;
};
const presets = [
  {
    name: "마운팅 플레이트",
    description: "100 × 60 × 5 mm · 관통 구멍 4개",
    parameters: DEFAULT_PLATE,
  },
  {
    name: "컴팩트 베이스",
    description: "60 × 40 × 4 mm · 소형 장착판",
    parameters: {
      width: 60,
      height: 40,
      thickness: 4,
      holeDiameter: 4,
      edgeOffset: 8,
      holes: true,
    },
  },
  {
    name: "솔리드 블록",
    description: "80 × 50 × 20 mm · 기본 솔리드",
    parameters: {
      width: 80,
      height: 50,
      thickness: 20,
      holeDiameter: 6,
      edgeOffset: 10,
      holes: false,
    },
  },
];
const STORAGE_KEY = "maite-history-v1";

export default function Workspace() {
  const [parameters, setParameters] = useState<PlateParameters>({
    ...DEFAULT_PLATE,
  });
  const [result, setResult] = useState<CadResult>();
  const [generatedParameters, setGeneratedParameters] =
    useState<PlateParameters>();
  const [name, setName] = useState("마운팅 플레이트");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState(
    "치수를 설정하고 첫 모델을 만들어보세요.",
  );
  const [error, setError] = useState("");
  const [view, setView] = useState<"3d" | "top" | "front">("3d");
  const [tab, setTab] = useState<"preview" | "json">("preview");
  const [history, setHistory] = useState<Entry[]>([]);
  const [help, setHelp] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [full, setFull] = useState(false);
  const [storageWarning, setStorageWarning] = useState("");
  const worker = useRef<Worker | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(
        localStorage.getItem(STORAGE_KEY) || "[]",
      );
      if (Array.isArray(saved))
        setHistory(
          saved
            .filter((e): e is Entry =>
              Boolean(
                e &&
                typeof e.id === "string" &&
                typeof e.name === "string" &&
                typeof e.createdAt === "string" &&
                plateSchema.safeParse(e.parameters).success,
              ),
            )
            .slice(0, 8),
        );
    } catch {
      /* Unavailable or invalid local history never blocks CAD. */
    }
    return () => {
      worker.current?.terminate();
      if (timeout.current) clearTimeout(timeout.current);
    };
  }, []);

  useEffect(() => {
    if (!help && !historyOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setHelp(false);
        setHistoryOpen(false);
      }
      if (event.key !== "Tab") return;
      const focusable = document
        .querySelector('[role="dialog"]')
        ?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex="0"]',
        );
      if (!focusable?.length) return;
      const first = focusable[0],
        last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKey);
      previousFocus?.focus();
    };
  }, [help, historyOpen]);

  function stopWorker() {
    if (worker.current) { worker.current.onmessage = null; worker.current.onerror = null; worker.current.terminate(); }
    worker.current = null;
    if (timeout.current) clearTimeout(timeout.current);
    timeout.current = null;
  }
  function cancel() {
    stopWorker();
    setBusy(false);
    setProgress(0);
    setMessage("작업을 취소했습니다. 다시 생성할 수 있습니다.");
  }
  function fresh() {
    cancel();
    setResult(undefined);
    setGeneratedParameters(undefined);
    setParameters({ ...DEFAULT_PLATE });
    setName("마운팅 플레이트");
    setError("");
    setTab("preview");
    setHistoryOpen(false);
  }
  function loadPreset(index: number) {
    const preset = presets[index];
    setParameters({ ...preset.parameters });
    setName(preset.name);
    setError("");
  }

  function generate() {
    if (busy) return;
    const parsed = plateSchema.safeParse(parameters);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    stopWorker();
    setBusy(true);
    setError("");
    setResult(undefined);
    setGeneratedParameters(undefined);
    setProgress(2);
    setMessage("CAD 작업 준비 중");
    setTab("preview");
    const snapshot = parsed.data;
    let cadWorker: Worker;
    try {
      cadWorker = new Worker(
        new URL("../workers/cad.worker.ts", import.meta.url),
      );
    } catch {
      setBusy(false);
      setError(
        "Web Worker를 시작할 수 없습니다. 최신 브라우저에서 다시 시도해주세요.",
      );
      return;
    }
    worker.current = cadWorker;
    const fail = (text: string) => {
      if (worker.current !== cadWorker) return;
      stopWorker();
      setBusy(false);
      setError(text);
      setMessage("생성에 실패했습니다. 설정을 확인하고 다시 시도해주세요.");
    };
    timeout.current = setTimeout(
      () =>
        fail(
          "CAD 작업이 120초를 초과했습니다. 네트워크 상태를 확인하고 다시 시도해주세요.",
        ),
      120000,
    );
    cadWorker.onerror = () =>
      fail(
        "CAD 엔진을 불러오지 못했습니다. 네트워크 연결과 WASM 파일을 확인해주세요.",
      );
    cadWorker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      if (worker.current !== cadWorker) return;
      const data = event.data;
      if (data.type === "progress") {
        setProgress(data.progress);
        setMessage(data.message);
      } else if (data.type === "error") fail(data.message);
      else {
        stopWorker();
        setResult(data.result);
        setGeneratedParameters(snapshot);
        setBusy(false);
        setProgress(100);
        setMessage("STEP 재검증 완료 · 다운로드할 수 있습니다.");
        const entry: Entry = {
          id: crypto.randomUUID(),
          name: name.trim() || "이름 없는 모델",
          parameters: snapshot,
          createdAt: new Date().toISOString(),
        };
        setHistory((previous) => {
          const next = [entry, ...previous].slice(0, 8);
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
          } catch {
            setStorageWarning(
              "이 브라우저에 이력을 저장할 수 없습니다. 다운로드는 가능합니다.",
            );
          }
          return next;
        });
      }
    };
    cadWorker.postMessage(snapshot);
  }

  function download(format: "step" | "json") {
    if (!result || !generatedParameters) return;
    const blob =
      format === "step"
        ? new Blob([result.step], { type: "application/step" })
        : new Blob(
            [JSON.stringify(makeSpecification(generatedParameters), null, 2)],
            { type: "application/json" },
          );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(name.trim() || "maite-model").replace(/[^\p{L}\p{N}_-]/gu, "_").slice(0, 60)}.${format}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const checked = plateSchema.safeParse(parameters);
  const changed =
    result &&
    generatedParameters &&
    JSON.stringify(parameters) !== JSON.stringify(generatedParameters);
  const specification = makeSpecification(
    checked.success ? parameters : DEFAULT_PLATE,
  );
  const selectedPreset = presets.findIndex(
    (preset) =>
      JSON.stringify(preset.parameters) === JSON.stringify(parameters),
  );

  return (
    <div className={`app-shell ${full ? "focus-mode" : ""}`}>
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="MAITE 홈">
          <span className="brand-symbol">
            <Cuboid size={25} strokeWidth={1.7} />
          </span>
          <span>
            maite<span className="brand-period">.</span>
          </span>
        </a>
        <button className="new-button" onClick={fresh} disabled={busy}>
          <Plus size={17} />
          새로운 디자인<span>NEW</span>
        </button>
        <div className="nav-caption">WORKSPACE</div>
        <button
          className="nav-item selected"
          onClick={() => setHistoryOpen(false)}
        >
          <Box size={17} />
          디자인 스튜디오
          <span className="nav-dot" />
        </button>
        <button
          className={`nav-item ${historyOpen ? "selected" : ""}`}
          onClick={() => setHistoryOpen(!historyOpen)}
        >
          <History size={17} />
          최근 디자인<span className="nav-count">{history.length}</span>
        </button>
        <div className="sidebar-divider" />
        <div className="nav-caption recent-caption">
          최근 작업<span>이 기기</span>
        </div>
        <div className="recent-list">
          {history.length === 0 ? (
            <p className="no-history">
              아직 생성한 디자인이 없어요.
              <br />첫 아이디어를 만들어보세요.
            </p>
          ) : (
            history.slice(0, 5).map((entry) => (
              <button
                key={entry.id}
                disabled={busy}
                onClick={() => {
                  setParameters(entry.parameters);
                  setName(entry.name);
                  setHistoryOpen(false);
                  setError("");
                }}
              >
                <FileBox size={16} />
                <span>
                  {entry.name}
                  <small>
                    {entry.parameters.width} × {entry.parameters.height} mm
                  </small>
                </span>
                <ChevronRight size={13} />
              </button>
            ))
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="local-card">
            <ShieldCheck size={18} />
            <strong>
              당신의 브라우저에서<small>설계와 연산은 이 기기 안에서.</small>
            </strong>
          </div>
          <button className="nav-item" onClick={() => setHelp(true)}>
            <CircleHelp size={17} />
            가이드 & 도움말
            <ArrowRight size={15} />
          </button>
          <div className="profile">
            <div className="avatar">M</div>
            <span>
              로컬 워크스페이스<small>PHASE 0 · 기술 검증</small>
            </span>
            <span className="online-dot" />
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb">
            <span>워크스페이스</span>
            <ChevronRight size={14} />
            <strong>디자인 스튜디오</strong>
          </div>
          <div className="topbar-right">
            <span className="mvp-badge">MVP PREVIEW</span>
            <button
              className="icon-button mobile-history"
              aria-label="최근 디자인 열기"
              onClick={() => setHistoryOpen(true)}
            >
              <History size={18} />
            </button>
            <button
              className="icon-button help-button"
              aria-label="도움말"
              onClick={() => setHelp(true)}
            >
              <CircleHelp size={18} />
            </button>
            <div className="avatar small">M</div>
          </div>
        </header>
        <section className="page-heading">
          <div>
            <div className="eyebrow">
              <span />
              FROM IDEA TO OBJECT
            </div>
            <h1>
              아이디어를, 형태로<span>.</span>
            </h1>
            <p>
              치수를 정하고, 가능성을 확인하세요. 정밀한 3D 설계가 시작됩니다.
            </p>
          </div>
          <span className="engine-pill">
            <span className="status-dot" />
            브라우저 CAD 엔진
          </span>
        </section>

        <div className="studio-grid">
          <section className="design-panel">
            <div className="panel-title">
              <span className="title-icon">
                <SlidersHorizontal size={17} />
              </span>
              <h2>디자인 설정</h2>
              <span className="step-number">01</span>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                generate();
              }}
            >
              <label className="field-label" htmlFor="model-name">
                디자인 이름
              </label>
              <input
                id="model-name"
                className="name-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
                disabled={busy}
              />
              <div className="label-row">
                <label className="field-label" htmlFor="preset">
                  시작할 형태
                </label>
                <span>기계 부품</span>
              </div>
              <div className="select-wrap">
                <Box size={18} />
                <select
                  id="preset"
                  value={selectedPreset < 0 ? "custom" : String(selectedPreset)}
                  disabled={busy}
                  onChange={(e) => loadPreset(Number(e.target.value))}
                >
                  <option value="custom" disabled>
                    사용자 설정
                  </option>
                  {presets.map((p, i) => (
                    <option value={i} key={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} />
              </div>
              <div className="section-divider" />
              <div className="label-row">
                <h3>판재 치수</h3>
                <span className="mm-badge">mm</span>
              </div>
              <div className="dimensions-row">
                {(
                  [
                    ["width", "가로", "X"],
                    ["height", "세로", "Y"],
                    ["thickness", "두께", "Z"],
                  ] as const
                ).map(([key, label, axis]) => (
                  <label className="dimension-field" key={key}>
                    <span>
                      {label}
                      <b className={`axis-${axis}`}>{axis}</b>
                    </span>
                    <input
                      aria-label={`${label} (mm)`}
                      type="number"
                      min={key === "thickness" ? 1 : 20}
                      max={key === "thickness" ? 30 : 300}
                      step="0.1"
                      value={
                        Number.isNaN(parameters[key]) ? "" : parameters[key]
                      }
                      disabled={busy}
                      onChange={(e) =>
                        setParameters({
                          ...parameters,
                          [key]: e.target.valueAsNumber,
                        })
                      }
                    />
                  </label>
                ))}
              </div>
              <div className="section-divider" />
              <div className="label-row hole-label">
                <h3>
                  관통 구멍 <span className="count-badge">4</span>
                </h3>
                <button
                  type="button"
                  className={`toggle ${parameters.holes ? "on" : ""}`}
                  role="switch"
                  aria-checked={parameters.holes}
                  aria-label="관통 구멍 사용"
                  disabled={busy}
                  onClick={() =>
                    setParameters({ ...parameters, holes: !parameters.holes })
                  }
                >
                  <span />
                </button>
              </div>
              <div
                className={`hole-settings ${!parameters.holes ? "disabled-fields" : ""}`}
              >
                <label>
                  <span>구멍 지름</span>
                  <div className="unit-input">
                    <span>⌀</span>
                    <input
                      aria-label="구멍 지름 (mm)"
                      type="number"
                      min="1"
                      max="40"
                      step="0.1"
                      value={
                        Number.isNaN(parameters.holeDiameter)
                          ? ""
                          : parameters.holeDiameter
                      }
                      disabled={busy || !parameters.holes}
                      onChange={(e) =>
                        setParameters({
                          ...parameters,
                          holeDiameter: e.target.valueAsNumber,
                        })
                      }
                    />
                    <span>mm</span>
                  </div>
                </label>
                <label>
                  <span>모서리에서 중심까지</span>
                  <div className="unit-input">
                    <input
                      aria-label="모서리 간격 (mm)"
                      type="number"
                      min="2"
                      max="100"
                      step="0.1"
                      value={
                        Number.isNaN(parameters.edgeOffset)
                          ? ""
                          : parameters.edgeOffset
                      }
                      disabled={busy || !parameters.holes}
                      onChange={(e) =>
                        setParameters({
                          ...parameters,
                          edgeOffset: e.target.valueAsNumber,
                        })
                      }
                    />
                    <span>mm</span>
                  </div>
                </label>
                <p>
                  <ShieldCheck size={12} />
                  Z축 방향 · 판재를 완전히 관통합니다.
                </p>
              </div>
              <div className="output-row">
                <span>
                  <FileBox size={16} />
                  출력 형식
                </span>
                <strong>
                  STEP <Check size={13} />
                </strong>
              </div>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              {!checked.success && !error && (
                <p className="form-error" role="alert">
                  {checked.error.issues[0].message}
                </p>
              )}
              <button
                className="generate-button"
                type="submit"
                disabled={busy || !checked.success}
              >
                {busy ? (
                  <LoaderCircle size={17} className="spin" />
                ) : (
                  <Sparkles size={17} />
                )}
                {busy ? "형태를 만드는 중…" : "3D 모델 생성"}
                {!busy && <ArrowRight size={17} />}
              </button>
              {busy && (
                <button
                  type="button"
                  className="cancel-button"
                  onClick={cancel}
                >
                  <X size={14} />
                  생성 취소
                </button>
              )}
              <p className="generation-note">
                <ShieldCheck size={12} />
                서버 전송 없이, 브라우저에서 안전하게 생성
              </p>
            </form>
            <div className="next-feature">
              <span className="next-icon">
                <Sparkles size={17} />
              </span>
              <div>
                <strong>다음은, 말로 하는 설계</strong>
                <p>자연어로 만드는 CAD를 준비하고 있어요.</p>
              </div>
              <span className="soon-badge">SOON</span>
            </div>
          </section>

          <section className="preview-panel">
            <div className="preview-header">
              <div className="preview-tabs">
                <button
                  onClick={() => setTab("preview")}
                  className={tab === "preview" ? "active" : ""}
                >
                  <Box size={16} />
                  3D 미리보기
                </button>
                <button
                  onClick={() => setTab("json")}
                  className={tab === "json" ? "active" : ""}
                >
                  <Code2 size={16} />
                  CAD 명세
                </button>
              </div>
              <button
                className="icon-button"
                title={full ? "기본 화면" : "넓게 보기"}
                aria-label={full ? "기본 화면" : "넓게 보기"}
                onClick={() => setFull(!full)}
              >
                {full ? <PanelLeftClose size={16} /> : <Maximize2 size={16} />}
              </button>
            </div>
            {tab === "preview" ? (
              <CadViewer
                mesh={result?.mesh}
                dimensions={
                  generatedParameters
                    ? [
                        generatedParameters.width,
                        generatedParameters.height,
                        generatedParameters.thickness,
                      ]
                    : [100, 60, 5]
                }
                view={view}
                onViewChange={setView}
              />
            ) : (
              <div className="json-view">
                <div>
                  <span>
                    {changed || !result
                      ? "현재 입력의 설계 명세"
                      : "생성된 모델의 설계 명세"}
                  </span>
                  <button
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          JSON.stringify(specification, null, 2),
                        );
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      } catch {
                        setError(
                          "복사 권한이 없습니다. JSON 다운로드를 사용해주세요.",
                        );
                      }
                    }}
                  >
                    {copied ? "복사됨" : "JSON 복사"}
                  </button>
                </div>
                <pre>
                  {checked.success
                    ? JSON.stringify(specification, null, 2)
                    : "유효한 치수를 입력하면 명세가 표시됩니다."}
                </pre>
              </div>
            )}
            <div className="model-status">
              <div className="status-main">
                {busy ? (
                  <LoaderCircle className="spin" size={15} />
                ) : result ? (
                  <CheckCheck size={17} />
                ) : (
                  <span className="idle-dot" />
                )}
                <span aria-live="polite">{message}</span>
              </div>
              <span>
                {result
                  ? `${(result.elapsed / 1000).toFixed(1)}s`
                  : "OpenCascade / WASM"}
              </span>
              {busy && (
                <div
                  className="progress-track"
                  role="progressbar"
                  aria-label="CAD 생성 진행률"
                  aria-valuenow={progress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <span style={{ width: `${progress}%` }} />
                </div>
              )}
            </div>
            <div className="result-panel">
              <div className="result-description">
                <div className="file-icon">
                  <FileBox size={23} />
                </div>
                <div>
                  <h3>
                    {result
                      ? "제작을 위한 준비 완료"
                      : "정밀함을 파일에 담으세요"}
                  </h3>
                  <p>
                    {result
                      ? `${(result.step.byteLength / 1024).toFixed(1)} KB · STEP AP214 · mm`
                      : "다른 CAD 도구에서도 편집 가능한 STEP 파일"}
                  </p>
                </div>
              </div>
              <button
                className="download-button"
                disabled={!result || busy}
                onClick={() => download("step")}
              >
                <ArrowDownToLine size={16} />
                STEP 다운로드
              </button>
            </div>
            {result && (
              <div className="model-metrics">
                <span>
                  <Check size={13} />
                  STEP 다시 읽기 통과
                </span>
                <span>
                  {result.bounds.map((v) => v.toFixed(1)).join(" × ")} mm
                </span>
                <span>{result.volume.toFixed(1)} mm³</span>
                <button onClick={() => download("json")}>
                  <Code2 size={13} />
                  명세 저장
                </button>
              </div>
            )}
            {changed && (
              <p className="changed-note">
                치수가 변경되었습니다. 다시 생성하면 미리보기와 다운로드에
                반영됩니다.
              </p>
            )}
          </section>
        </div>

        <section className="starter-section">
          <div className="starter-heading">
            <h2>작은 아이디어에서 시작해보세요</h2>
            <span>
              클릭하면 설정을 불러옵니다 <ArrowRight size={13} />
            </span>
          </div>
          <div className="starter-cards">
            {presets.map((preset, i) => (
              <button
                key={preset.name}
                className={`starter-card preset-${i}`}
                disabled={busy}
                onClick={() => loadPreset(i)}
              >
                <div className="preset-illustration">
                  <div className={`mini-plate ${i === 2 ? "block" : ""}`}>
                    {i !== 2 && (
                      <>
                        <i />
                        <i />
                        <i />
                        <i />
                      </>
                    )}
                  </div>
                </div>
                <div>
                  <strong>{preset.name}</strong>
                  <p>{preset.description}</p>
                </div>
                <ArrowRight size={16} />
              </button>
            ))}
          </div>
        </section>
        <footer className="page-footer">
          <span>
            MAITE STUDIO <i />
            생각과 제작 사이, 더 가까이.
          </span>
          <span>로컬 작업 · 탭을 닫으면 생성이 중단됩니다.</span>
        </footer>
        {storageWarning && (
          <p className="storage-warning" role="status">
            {storageWarning}
          </p>
        )}
      </main>

      {help && (
        <div className="modal-overlay" onClick={() => setHelp(false)}>
          <section
            className="help-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              aria-label="가이드 닫기"
              onClick={() => setHelp(false)}
              autoFocus
            >
              <X size={20} />
            </button>
            <span className="eyebrow">QUICK GUIDE</span>
            <h2 id="help-title">첫 번째 설계를 시작하세요.</h2>
            <ol>
              <li>프리셋을 선택하거나 판재와 구멍 치수를 입력하세요.</li>
              <li>
                3D 모델 생성 버튼을 누르세요. 처음에는 약 23 MB의 CAD 엔진을
                불러옵니다.
              </li>
              <li>드래그로 회전하고 휠로 확대해 형태를 확인하세요.</li>
              <li>검증이 끝나면 STEP 파일을 다운로드하세요.</li>
            </ol>
            <p>
              이 버전은 Phase 0 기술 검증용입니다. 자연어 AI, 로그인, 클라우드
              저장은 아직 제공하지 않습니다. 최근 작업은 이 브라우저에 치수만
              저장하며, 불러온 뒤 다시 생성해야 합니다.
            </p>
            <p>
              최신 데스크톱 Chrome / Edge를 권장합니다. 모바일에서는 메모리와
              로딩 시간이 더 필요할 수 있습니다.
            </p>
            <button className="generate-button" onClick={() => setHelp(false)}>
              설계 시작하기
              <ArrowRight size={16} />
            </button>
          </section>
        </div>
      )}
      {historyOpen && (
        <div className="modal-overlay" onClick={() => setHistoryOpen(false)}>
          <section
            className="help-modal history-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="history-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              aria-label="이력 닫기"
              onClick={() => setHistoryOpen(false)}
              autoFocus
            >
              <X size={20} />
            </button>
            <span className="eyebrow">ON THIS DEVICE</span>
            <h2 id="history-title">최근 디자인</h2>
            <p>
              최근 8개 작업의 치수를 이 기기에 보관합니다. 선택 후 다시
              생성하세요.
            </p>
            {history.length === 0 ? (
              <p>아직 저장된 디자인이 없습니다.</p>
            ) : (
              history.map((entry) => (
                <button
                  className="history-entry"
                  disabled={busy}
                  key={entry.id}
                  onClick={() => {
                    setParameters(entry.parameters);
                    setName(entry.name);
                    setHistoryOpen(false);
                    setError("");
                  }}
                >
                  <FileBox size={20} />
                  <span>
                    <strong>{entry.name}</strong>
                    <small>
                      {entry.parameters.width} × {entry.parameters.height} ×{" "}
                      {entry.parameters.thickness} mm ·{" "}
                      {new Date(entry.createdAt).toLocaleDateString("ko-KR")}
                    </small>
                  </span>
                  <ChevronRight size={16} />
                </button>
              ))
            )}
          </section>
        </div>
      )}
    </div>
  );
}
