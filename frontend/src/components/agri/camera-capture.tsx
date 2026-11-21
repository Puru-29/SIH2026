import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Check, Loader2, RotateCcw, ShieldCheck, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { CameraPhoto } from "@/services/api-client";

/**
 * Live in-app camera. There is deliberately NO file input: the picture is taken
 * from the live video stream, so nothing can be picked from the gallery.
 *
 * Flow: camera → capture → photo check (not dark, blank or blurry) → use photo.
 */

const MAX_SIDE = 1280;

type Check = { ok: boolean; problems: string[] };

/** Simple on-device checks: too dark, flat/blank (e.g. covered lens), or very blurry. */
function checkPicture(ctx: CanvasRenderingContext2D, w: number, h: number): Check {
  // Sample a downscaled grid for speed.
  const step = Math.max(1, Math.floor(Math.min(w, h) / 200));
  const { data } = ctx.getImageData(0, 0, w, h);
  const lum = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
  };
  let n = 0;
  let sum = 0;
  let sumSq = 0;
  let lap = 0;
  let lapSq = 0;
  for (let y = step; y < h - step; y += step) {
    for (let x = step; x < w - step; x += step) {
      const c = lum(x, y);
      sum += c;
      sumSq += c * c;
      const l = 4 * c - lum(x - step, y) - lum(x + step, y) - lum(x, y - step) - lum(x, y + step);
      lap += l;
      lapSq += l * l;
      n++;
    }
  }
  const mean = sum / n;
  const sd = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
  const lapVar = lapSq / n - (lap / n) ** 2;
  const problems: string[] = [];
  if (mean < 35) problems.push("The photo is too dark. Move to daylight.");
  else if (mean > 240) problems.push("The photo is too bright. Avoid direct glare.");
  if (sd < 12) problems.push("The photo looks blank. Point the camera at the crop.");
  else if (lapVar < 20) problems.push("The photo is blurry. Hold the phone steady.");
  return { ok: problems.length === 0, problems };
}

function getPosition(): Promise<{ latitude: number; longitude: number } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) =>
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 300_000 },
    ),
  );
}

export function CameraCapture({
  open,
  onClose,
  onCapture,
  title = "Take a photo of your crop",
}: {
  open: boolean;
  onClose: () => void;
  onCapture: (photo: CameraPhoto) => void;
  title?: string;
}) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [shot, setShot] = useState<{ url: string; check: Check } | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setShot(null);
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setError("The camera only works on a secure (https) connection.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser cannot open the camera. Try Chrome on your phone.");
      return;
    }
    setStarting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      setError(
        name === "NotAllowedError"
          ? "Camera permission was denied. Allow camera access in your browser settings and try again."
          : name === "NotFoundError"
            ? "No camera was found on this device."
            : "Could not open the camera. Close other apps using it and try again.",
      );
    } finally {
      setStarting(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void start();
    return stop;
  }, [open, start, stop]);

  if (!open) return null;

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    setChecking(true);
    const scale = Math.min(1, MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
    const w = Math.round(video.videoWidth * scale);
    const h = Math.round(video.videoHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      setChecking(false);
      return;
    }
    ctx.drawImage(video, 0, 0, w, h);
    const check = checkPicture(ctx, w, h);
    setShot({ url: canvas.toDataURL("image/jpeg", 0.82), check });
    setChecking(false);
  };

  const use = async () => {
    if (!shot?.check.ok) return;
    setSaving(true);
    const pos = await getPosition();
    onCapture({ data_base64: shot.url, latitude: pos?.latitude, longitude: pos?.longitude });
    setSaving(false);
    stop();
    onClose();
  };

  const close = () => {
    stop();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-3"
      role="dialog"
      aria-modal="true"
      aria-label={t(title)}
    >
      <div className="w-full max-w-lg overflow-hidden rounded-3xl bg-card">
        <div className="flex items-center justify-between px-5 py-3">
          <p className="font-medium">{t(title)}</p>
          <button
            onClick={close}
            className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-secondary"
            aria-label={t("Close camera")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="relative aspect-[4/3] bg-black">
          {/* Live preview stays mounted so the stream survives a retake. */}
          <video
            ref={videoRef}
            playsInline
            muted
            className={cn("h-full w-full object-cover", shot && "invisible")}
          />
          {shot && (
            <img
              src={shot.url}
              alt={t("Captured crop photo")}
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}
          {(starting || checking) && (
            <div className="absolute inset-0 flex items-center justify-center text-white">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white">
              {t(error)}
            </div>
          )}
        </div>

        <div className="space-y-3 p-5">
          {shot ? (
            <>
              <div
                className={cn(
                  "rounded-2xl p-3 text-sm",
                  shot.check.ok ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-950",
                )}
                role="status"
              >
                {shot.check.ok ? (
                  <p className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 shrink-0" />
                    {t("Photo check passed: live camera photo, clear and well lit.")}
                  </p>
                ) : (
                  shot.check.problems.map((p) => <p key={p}>{t(p)}</p>)
                )}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShot(null)}
                  className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-border text-sm"
                >
                  <RotateCcw className="h-4 w-4" /> {t("Retake")}
                </button>
                <button
                  onClick={() => void use()}
                  disabled={!shot.check.ok || saving}
                  className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  {t("Use photo")}
                </button>
              </div>
            </>
          ) : error ? (
            <button
              onClick={() => void start()}
              className="min-h-12 w-full rounded-xl border border-border text-sm"
            >
              {t("Try again")}
            </button>
          ) : (
            <button
              onClick={capture}
              disabled={starting || checking}
              className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-medium text-primary-foreground disabled:opacity-50"
            >
              <Camera className="h-5 w-5" /> {t("Take photo")}
            </button>
          )}
          <p className="text-center text-xs text-muted-foreground">
            {t("Photos are taken live with the camera. Gallery uploads are not allowed.")}
          </p>
        </div>
      </div>
    </div>
  );
}
