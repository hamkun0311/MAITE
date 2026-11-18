"use client";
import { useState, useEffect, useRef, type FormEvent } from "react";
import { Sparkles, UserRound } from "lucide-react";
import { userProfileSchema, type UserProfile } from "@/lib/account/profile";
type ProfileProps = { initial?: Partial<UserProfile>; avatarUrl?: string | null; onSave: (profile: UserProfile, photo?: File | null) => Promise<void>; onCancel?: () => void };
export function ProfileEditModal({ initial, avatarUrl, onSave, onCancel }: ProfileProps & { onCancel: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  return <dialog ref={dialog} className="profile-edit-dialog" aria-label="프로필 수정" onCancel={onCancel}><ProfileSetup initial={initial} avatarUrl={avatarUrl} onSave={onSave} onCancel={onCancel}/></dialog>;
}
export default function ProfileSetup({ initial, avatarUrl, onSave, onCancel }: ProfileProps) {
  const photoInput = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<File | null>();
  const [preview, setPreview] = useState<string>();
  useEffect(() => { if (!photo) { setPreview(undefined); return; } const url = URL.createObjectURL(photo); setPreview(url); return () => URL.revokeObjectURL(url); }, [photo]);
  const [nickname, setNickname] = useState(initial?.nickname ?? ""), [gender, setGender] = useState(initial?.gender ?? "선택 안 함"), [age, setAge] = useState(initial?.age ? String(initial.age) : "");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: FormEvent) { event.preventDefault(); const parsed = userProfileSchema.safeParse({ nickname, gender, age: Number(age) }); if (!parsed.success) { setError("닉네임, 성별, 나이를 확인해주세요."); return; } setBusy(true); setError(""); try { await onSave(parsed.data, photo); } catch (error) { setError(error instanceof Error ? error.message : "프로필을 저장하지 못했습니다."); } finally { setBusy(false); } }
  return <main className="profile-setup native-standalone"><div className="native-wordmark">maite<span>.</span></div><div className="setup-avatar"><UserRound size={46}/><Sparkles size={20}/></div><h1>{onCancel ? "프로필 수정" : "당신을 알려주세요"}</h1><p>캐릭터와 함께할 당신의 프로필이에요.</p><form onSubmit={event => void submit(event)}>
    <div className="profile-photo-editor"><button type="button" className="native-avatar large profile-photo-trigger" aria-label="프로필 사진 변경" title="사진을 눌러 변경" disabled={busy} onClick={() => photoInput.current?.click()}>{(preview || (photo !== null && avatarUrl)) ? <img src={preview || avatarUrl || undefined} alt="프로필 사진 미리보기"/> : <UserRound size={36}/>}</button><input ref={photoInput} hidden aria-label="프로필 사진 선택" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 5_000_000 || !["image/jpeg","image/png","image/webp"].includes(file.type)) { setError("JPG, PNG, WebP 사진을 5MB 이하로 선택해주세요."); event.target.value = ""; return; } setError(""); setPhoto(file); event.target.value = ""; }}/>{(photo || (photo !== null && avatarUrl)) && <button type="button" className="native-outline" disabled={busy} onClick={() => setPhoto(null)}>사진 삭제</button>}</div>
    <label>닉네임<input aria-label="사용자 닉네임" required maxLength={32} value={nickname} placeholder="어떻게 불러드릴까요?" onChange={event => setNickname(event.target.value)} disabled={busy}/></label>
    <label>성별<select aria-label="사용자 성별" value={gender} onChange={event => setGender(event.target.value as UserProfile["gender"])} disabled={busy}><option>여성</option><option>남성</option><option>선택 안 함</option></select></label>
    <label>나이<input aria-label="사용자 나이" type="number" required min={1} max={120} value={age} placeholder="나이를 입력해주세요" onChange={event => setAge(event.target.value)} disabled={busy}/></label>
    {error && <p role="alert">{error}</p>}<button className="native-primary" disabled={busy}>{busy ? "저장 중…" : onCancel ? "프로필 저장" : "시작하기"}</button>{onCancel && <button type="button" disabled={busy} onClick={onCancel}>취소</button>}
  </form></main>;
}
