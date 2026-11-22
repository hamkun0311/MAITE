import { X } from "lucide-react";

export default function GenerationFeedback({ message, onDismiss, className, role = "alert" }: {
  message: string; onDismiss: () => void; className: string; role?: "alert" | "status";
}) {
  if (!message) return null;
  return <div className={className} role={role}>
    <button type="button" className="generation-feedback-dismiss" onClick={onDismiss} aria-label={`${message} 알림 닫기`}>
      <span>{message}</span><X size={14} aria-hidden="true" />
    </button>
  </div>;
}
