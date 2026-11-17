"use client";
import { useState, useEffect, useRef, type FormEvent } from "react";
import { Sparkles, UserRound } from "lucide-react";
import { userProfileSchema, type UserProfile } from "@/lib/account/profile";
export function ProfileEditModal({ initial, onSave, onCancel }: { initial?: Partial<UserProfile>; onSave: (profile: UserProfile) => Promise<void>; onCancel: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  return <dialog ref={dialog} className="profile-edit-dialog" aria-label="프로필 수정" onCancel={onCancel}><ProfileSetup initial={initial} onSave={onSave} onCancel={onCancel}/></dialog>;
}
export default function ProfileSetup({ initial, onSave, onCancel }: { initial?: Partial<UserProfile>; onSave: (profile: UserProfile) => Promise<void>; onCancel?: () => void }) {
  const [nickname, setNickname] = useState(initial?.nickname ?? ""), [gender, setGender] = useState(initial?.gender ?? "선택 안 함"), [age, setAge] = useState(initial?.age ? String(initial.age) : "");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: FormEvent) { event.preventDefault(); const parsed = userProfileSchema.safeParse({ nickname, gender, age: Number(age) }); if (!parsed.success) { setError("닉네임, 성별, 나이를 확인해주세요."); return; } setBusy(true); setError(""); try { await onSave(parsed.data); } catch (error) { setError(error instanceof Error ? error.message : "프로필을 저장하지 못했습니다."); } finally { setBusy(false); } }
  return <main className="profile-setup native-standalone"><div className="native-wordmark">maite<span>.</span></div><div className="setup-avatar"><UserRound size={46}/><Sparkles size={20}/></div><h1>{onCancel ? "프로필 수정" : "당신을 알려주세요"}</h1><p>캐릭터와 함께할 당신의 프로필이에요.</p><form onSubmit={event => void submit(event)}>
    <label>닉네임<input aria-label="사용자 닉네임" required maxLength={32} value={nickname} placeholder="어떻게 불러드릴까요?" onChange={event => setNickname(event.target.value)} disabled={busy}/></label>
    <label>성별<select aria-label="사용자 성별" value={gender} onChange={event => setGender(event.target.value as UserProfile["gender"])} disabled={busy}><option>여성</option><option>남성</option><option>선택 안 함</option></select></label>
    <label>나이<input aria-label="사용자 나이" type="number" required min={1} max={120} value={age} placeholder="나이를 입력해주세요" onChange={event => setAge(event.target.value)} disabled={busy}/></label>
    {error && <p role="alert">{error}</p>}<button className="native-primary" disabled={busy}>{busy ? "저장 중…" : onCancel ? "프로필 저장" : "시작하기"}</button>{onCancel && <button type="button" disabled={busy} onClick={onCancel}>취소</button>}
  </form></main>;
}
