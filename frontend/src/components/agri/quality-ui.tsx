import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, ImageOff, ShieldCheck, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { CameraCapture } from "@/components/agri/camera-capture";
import { Modal, shortDate } from "@/components/fpo/fpo-ui";
import {
  addLotPhoto,
  deleteLotPhoto,
  getFarmerReviews,
  getLotPhotos,
  getOrderQuality,
  submitGradeCheck,
  submitReview,
  type BackendLot,
  type CameraPhoto,
} from "@/services/api-client";

const GRADES = ["Grade A", "Grade B", "Grade C"] as const;
export const MAX_LOT_PHOTOS = 3;

/* ------------------------------- lot form -------------------------------- */

/** 1–3 live camera photos for a new lot. No gallery option on purpose. */
export function PhotoPicker({
  photos,
  onChange,
}: {
  photos: CameraPhoto[];
  onChange: (p: CameraPhoto[]) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="text-sm text-muted-foreground">
          {t("Crop photos")} <span className="text-destructive">*</span>
        </p>
        <span className="text-[11px] text-muted-foreground">
          {photos.length}/{MAX_LOT_PHOTOS} · {t("camera only")}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {photos.map((p, i) => (
          <div
            key={i}
            className="relative aspect-square overflow-hidden rounded-xl border border-border"
          >
            <img
              src={p.data_base64}
              alt={`${t("Crop photo")} ${i + 1}`}
              className="h-full w-full object-cover"
            />
            <button
              type="button"
              onClick={() => onChange(photos.filter((_, j) => j !== i))}
              className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white"
              aria-label={`${t("Remove photo")} ${i + 1}`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        {photos.length < MAX_LOT_PHOTOS && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border text-xs text-muted-foreground hover:border-primary hover:text-primary"
          >
            <Camera className="h-6 w-6" />
            {t("Take photo")}
          </button>
        )}
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        {t("Buyers check the grade from these photos. Show the crop clearly, in daylight.")}
      </p>
      <CameraCapture
        open={open}
        onClose={() => setOpen(false)}
        onCapture={(p) => onChange([...photos, p].slice(0, MAX_LOT_PHOTOS))}
      />
    </div>
  );
}

/** A farmer's own lot photos: add (camera only, up to 3) or remove (keeps one). */
export function OwnLotPhotos({
  lotId,
  count,
  editable,
}: {
  lotId: number;
  count: number;
  editable: boolean;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [camera, setCamera] = useState(false);
  const photos = useQuery({
    queryKey: ["lot-photos", lotId],
    queryFn: () => getLotPhotos(lotId),
    enabled: count > 0,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["lot-photos", lotId] });
    void qc.invalidateQueries({ queryKey: ["lots"] });
  };
  const add = useMutation({
    mutationFn: (p: CameraPhoto) => addLotPhoto(lotId, p),
    onSuccess: () => {
      toast.success(t("Photo added"));
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: number) => deleteLotPhoto(id),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });
  const list = photos.data ?? [];
  return (
    <div className="mt-4">
      {count === 0 && (
        <p className="mb-2 flex items-center gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-950">
          <ImageOff className="h-4 w-4" />
          {t("No photo yet. Buyers rarely offer on lots without a photo.")}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {list.map((p, i) => (
          <div
            key={p.id}
            className="relative h-20 w-20 overflow-hidden rounded-xl border border-border"
          >
            <img
              src={p.data_url}
              alt={`${t("Crop photo")} ${i + 1}`}
              className="h-full w-full object-cover"
            />
            {editable && list.length > 1 && (
              <button
                onClick={() => remove.mutate(p.id)}
                disabled={remove.isPending}
                className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white"
                aria-label={`${t("Remove photo")} ${i + 1}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
        {editable && count < MAX_LOT_PHOTOS && (
          <button
            onClick={() => setCamera(true)}
            disabled={add.isPending}
            className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border text-[11px] text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50"
          >
            <Camera className="h-5 w-5" />
            {t("Add photo")}
          </button>
        )}
      </div>
      <CameraCapture
        open={camera}
        onClose={() => setCamera(false)}
        onCapture={(p) => add.mutate(p)}
      />
    </div>
  );
}

/* ------------------------------ buyer view ------------------------------- */

/** The lot's camera photos, loaded on demand; tap to enlarge. */
export function LotPhotos({ lotId, count }: { lotId: number; count: number | undefined }) {
  const { t } = useI18n();
  const [big, setBig] = useState<string | null>(null);
  const photos = useQuery({
    queryKey: ["lot-photos", lotId],
    queryFn: () => getLotPhotos(lotId),
    enabled: (count ?? 0) > 0,
    staleTime: 5 * 60_000,
  });
  if (!count) {
    return (
      <p className="mt-4 flex items-center gap-1.5 rounded-xl bg-secondary px-3 py-2 text-xs text-muted-foreground">
        <ImageOff className="h-4 w-4" /> {t("No photo — ask the farmer for one before offering")}
      </p>
    );
  }
  return (
    <div className="mt-4">
      <div className="flex gap-2">
        {(photos.data ?? Array.from({ length: count }, () => null)).map((p, i) =>
          p ? (
            <button
              key={p.id}
              onClick={() => setBig(p.data_url)}
              className="h-20 w-20 overflow-hidden rounded-xl border border-border"
              aria-label={`${t("Open photo")} ${i + 1}`}
            >
              <img src={p.data_url} alt="" className="h-full w-full object-cover" />
            </button>
          ) : (
            <div key={i} className="h-20 w-20 animate-pulse rounded-xl bg-secondary" />
          ),
        )}
      </div>
      <p className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5 text-primary" />
        {t("Live camera photos")}
        {photos.data?.[0] ? ` · ${t("taken")} ${shortDate(photos.data[0].captured_at)}` : ""}
      </p>
      {big && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4"
          onClick={() => setBig(null)}
          role="dialog"
          aria-modal="true"
          aria-label={t("Crop photo")}
        >
          <img src={big} alt={t("Crop photo")} className="max-h-full max-w-full rounded-2xl" />
        </div>
      )}
    </div>
  );
}

export function Stars({ value, size = "h-4 w-4" }: { value: number; size?: string }) {
  return (
    <span className="inline-flex" aria-label={`${value.toFixed(1)} / 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={cn(
            size,
            i <= Math.round(value) ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40",
          )}
        />
      ))}
    </span>
  );
}

/** Rating + grade record from the lot list; opens the full reviews. */
export function FarmerRating({ lot }: { lot: BackendLot }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const checks = lot.farmer_grade_checks ?? 0;
  const pct = checks ? Math.round(((lot.farmer_grade_matched ?? 0) * 100) / checks) : null;
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="mt-3 flex flex-wrap items-center gap-2 text-left text-xs text-muted-foreground hover:text-foreground"
      >
        {lot.farmer_rating ? (
          <>
            <Stars value={lot.farmer_rating} size="h-3.5 w-3.5" />
            <span>
              {lot.farmer_rating.toFixed(1)} ({lot.farmer_review_count} {t("reviews")})
            </span>
          </>
        ) : (
          <span>{t("New farmer · no reviews yet")}</span>
        )}
        {pct !== null && (
          <span
            className={cn(
              "rounded-full px-2 py-0.5 font-medium",
              pct >= 90
                ? "bg-emerald-100 text-emerald-900"
                : pct >= 70
                  ? "bg-amber-100 text-amber-900"
                  : "bg-red-100 text-red-900",
            )}
          >
            {t("Grade as listed")}: {pct}% ({checks})
          </span>
        )}
        <span className="underline underline-offset-2">{t("See reviews")}</span>
      </button>
      {open && <FarmerReviewsModal farmerId={lot.farmer_id} onClose={() => setOpen(false)} />}
    </>
  );
}

export function FarmerReviewsModal({
  farmerId,
  onClose,
}: {
  farmerId: number;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const q = useQuery({
    queryKey: ["farmer-reviews", farmerId],
    queryFn: () => getFarmerReviews(farmerId),
  });
  return (
    <Modal open onClose={onClose} title={q.data ? q.data.farmer_name : "Reviews"}>
      <FarmerReviewsBody data={q.data} loading={q.isLoading} error={q.error} />
      <p className="mt-2 text-xs text-muted-foreground">
        {t("Only buyers who received a delivery from this farmer can review.")}
      </p>
    </Modal>
  );
}

export function FarmerReviewsBody({
  data,
  loading,
  error,
}: {
  data: Awaited<ReturnType<typeof getFarmerReviews>> | undefined;
  loading: boolean;
  error: Error | null;
}) {
  const { t } = useI18n();
  if (loading) return <p className="text-sm text-muted-foreground">{t("Loading…")}</p>;
  if (error || !data) return <p className="text-sm text-destructive">{error?.message}</p>;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-secondary p-4">
          <p className="text-xs text-muted-foreground">{t("Buyer rating")}</p>
          {data.rating ? (
            <p className="mt-1 flex items-center gap-2 text-2xl font-semibold">
              {data.rating.toFixed(1)} <Stars value={data.rating} />
            </p>
          ) : (
            <p className="mt-1 text-sm">{t("No reviews yet")}</p>
          )}
          <p className="text-xs text-muted-foreground">
            {data.review_count} {t("reviews")}
          </p>
        </div>
        <div className="rounded-2xl bg-secondary p-4">
          <p className="text-xs text-muted-foreground">{t("Grade arrived as listed")}</p>
          <p className="mt-1 text-2xl font-semibold">
            {data.grade_match_pct !== null ? `${data.grade_match_pct}%` : "—"}
          </p>
          <p className="text-xs text-muted-foreground">
            {data.grade_matched}/{data.grade_checks} {t("orders checked")}
          </p>
        </div>
      </div>
      {data.reviews.length === 0 ? null : (
        <ul className="space-y-3">
          {data.reviews.map((r, i) => (
            <li key={i} className="rounded-2xl border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Stars value={r.rating} />
                <span className="text-xs text-muted-foreground">
                  {r.buyer_name} · {t(r.crop_name)} · {shortDate(r.created_at)}
                </span>
              </div>
              {r.received_grade && (
                <p
                  className={cn(
                    "mt-2 text-xs font-medium",
                    r.grade_matched ? "text-emerald-700" : "text-red-700",
                  )}
                >
                  {r.grade_matched ? t("Received as listed") : t("Lower grade than listed")}:{" "}
                  {r.received_grade}
                </p>
              )}
              {r.comment && <p className="mt-2 text-sm">{r.comment}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* -------------------------------- orders --------------------------------- */

/** Grade check on arrival and review after delivery (buyer); outcome for the farmer. */
export function OrderQualityPanel({ txId, isBuyer }: { txId: number; isBuyer: boolean }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["order-quality", txId], queryFn: () => getOrderQuality(txId) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["order-quality", txId] });
    void qc.invalidateQueries({ queryKey: ["lots"] });
    void qc.invalidateQueries({ queryKey: ["fpo"] });
  };
  const [grade, setGrade] = useState("");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<CameraPhoto | null>(null);
  const [camera, setCamera] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");

  const check = useMutation({
    mutationFn: () =>
      submitGradeCheck(txId, {
        received_grade: grade,
        note: note.trim() || undefined,
        ...(photo ? { photo } : {}),
      }),
    onSuccess: (r) => {
      toast.success(
        r.matched
          ? t("Thanks — grade confirmed")
          : t("Grade mismatch reported. A dispute was opened for the admin."),
      );
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const rate = useMutation({
    mutationFn: () =>
      submitReview(txId, {
        rating,
        comment: comment.trim() || undefined,
        ...(q.data?.grade_check ? {} : { received_grade: grade }),
      }),
    onSuccess: () => {
      toast.success(t("Review saved"));
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const d = q.data;
  if (!d) return null;
  const lower = grade && GRADES.indexOf(grade as never) > GRADES.indexOf(d.claimed_grade as never);

  return (
    <div className="mt-4 space-y-4 rounded-2xl border border-border p-4">
      <p className="text-sm font-medium">
        {t("Crop quality")} · {t("listed as")} {d.claimed_grade}
      </p>

      {d.grade_check ? (
        <div
          className={cn(
            "rounded-xl p-3 text-sm",
            d.grade_check.matched ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900",
          )}
        >
          {d.grade_check.matched ? t("Arrived as listed") : t("Lower grade than listed")}:{" "}
          <strong>{d.grade_check.received_grade}</strong>
          {d.grade_check.dispute_id ? ` · ${t("dispute")} #${d.grade_check.dispute_id}` : ""}
          {d.grade_check.note && <p className="mt-1 opacity-80">{d.grade_check.note}</p>}
          {d.grade_check.photo_url && (
            <img
              src={d.grade_check.photo_url}
              alt={t("Photo on arrival")}
              className="mt-2 h-24 rounded-lg"
            />
          )}
        </div>
      ) : d.can_check_grade || (d.can_review && !d.grade_check) ? (
        <div className="space-y-3">
          <p className="text-sm">{t("What grade did you receive?")}</p>
          <div className="flex gap-2" role="radiogroup" aria-label={t("Grade received")}>
            {GRADES.map((g) => (
              <button
                key={g}
                type="button"
                role="radio"
                aria-checked={grade === g}
                onClick={() => setGrade(g)}
                className={cn(
                  "min-h-11 flex-1 rounded-xl border text-sm",
                  grade === g
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border",
                )}
              >
                {g}
              </button>
            ))}
          </div>
          {d.can_check_grade && (
            <>
              {lower && (
                <p className="text-xs text-red-700">
                  {t(
                    "Lower than listed: add a photo or a note. A dispute is opened for the admin.",
                  )}
                </p>
              )}
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={500}
                rows={2}
                placeholder={t("Note (optional), e.g. many soft or damaged pieces")}
                className="w-full rounded-xl border border-border bg-background p-3 text-sm"
              />
              <div className="flex flex-wrap items-center gap-3">
                {photo ? (
                  <img
                    src={photo.data_base64}
                    alt={t("Photo on arrival")}
                    className="h-16 rounded-lg"
                  />
                ) : null}
                <button
                  type="button"
                  onClick={() => setCamera(true)}
                  className="flex min-h-11 items-center gap-2 rounded-xl border border-border px-4 text-sm"
                >
                  <Camera className="h-4 w-4" />{" "}
                  {photo ? t("Retake photo") : t("Photo of what arrived")}
                </button>
                <button
                  type="button"
                  disabled={!grade || check.isPending}
                  onClick={() => check.mutate()}
                  className="min-h-11 rounded-xl bg-primary px-4 text-sm text-primary-foreground disabled:opacity-50"
                >
                  {t("Confirm grade")}
                </button>
              </div>
              <CameraCapture
                open={camera}
                title="Photo of what arrived"
                onClose={() => setCamera(false)}
                onCapture={setPhoto}
              />
            </>
          )}
        </div>
      ) : (
        !isBuyer && (
          <p className="text-sm text-muted-foreground">
            {t("The buyer has not checked the grade yet.")}
          </p>
        )
      )}

      {d.review ? (
        <div className="text-sm">
          <Stars value={d.review.rating} />{" "}
          {d.review.comment && <p className="mt-1">{d.review.comment}</p>}
        </div>
      ) : d.can_review ? (
        <div className="space-y-3 border-t border-border pt-4">
          <p className="text-sm">{t("Rate the farmer")}</p>
          <div className="flex gap-1" role="radiogroup" aria-label={t("Rating")}>
            {[1, 2, 3, 4, 5].map((i) => (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={rating === i}
                aria-label={`${i} ${t("stars")}`}
                onClick={() => setRating(i)}
                className="flex h-11 w-11 items-center justify-center"
              >
                <Star
                  className={cn(
                    "h-7 w-7",
                    i <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40",
                  )}
                />
              </button>
            ))}
          </div>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={1000}
            rows={3}
            placeholder={t("How was the quality, packing and quantity?")}
            className="w-full rounded-xl border border-border bg-background p-3 text-sm"
          />
          <button
            type="button"
            disabled={!rating || (!d.grade_check && !grade) || rate.isPending}
            onClick={() => rate.mutate()}
            className="min-h-11 rounded-xl bg-primary px-4 text-sm text-primary-foreground disabled:opacity-50"
          >
            {t("Submit review")}
          </button>
          {!d.grade_check && !grade && (
            <p className="text-xs text-muted-foreground">
              {t("Choose the grade you received above first.")}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
