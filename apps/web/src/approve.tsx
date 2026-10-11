/** VERIFY'dagi job'ni foydalanuvchi tasdiqlaydi (render'siz). Claude keyingi so'rovida bu haqda xabar oladi. */
import { CircleCheck } from "lucide-react";
import { useState } from "react";
import { post } from "./api";
import { Button, Notice } from "./ui";

export function ApproveButton({
  jobId,
  size = "md",
  onDone,
}: {
  jobId: string;
  size?: "sm" | "md";
  onDone?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const approve = async () => {
    if (
      !window.confirm(
        "Natijani After Effects'da ko'rib chiqdingizmi? Job yakunlanadi (render qilinmaydi). Keyin tuzatish kerak bo'lsa, Claude'ga yozing — job qayta ochiladi.",
      )
    )
      return;
    setBusy(true);
    setError(null);
    const res = await post(`/api/jobs/${jobId}/actions`, { action: "approve", render: false });
    setBusy(false);
    if (res.ok) onDone?.();
    else setError(res.error.message ?? res.error.hint);
  };

  return (
    <>
      <Button size={size} onClick={() => void approve()} disabled={busy}>
        <CircleCheck /> {busy ? "Tasdiqlanmoqda…" : "Tasdiqlash"}
      </Button>
      {error !== null ? (
        <div className="basis-full">
          <Notice ok={false}>{error}</Notice>
        </div>
      ) : null}
    </>
  );
}
