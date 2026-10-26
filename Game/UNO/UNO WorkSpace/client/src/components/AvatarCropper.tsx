import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

/** The saved avatar is a square WebP this wide, matching what the server would produce on its own. */
const OUTPUT_SIZE = 512;
const OUTPUT_QUALITY = 0.92;
/** The cropper's on-screen window; the picture is fitted inside it on open. */
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

interface Props {
  file: File;
  /** An object URL for `file`, so the picture is decoded once and can be drawn to a canvas. */
  sourceUrl: string;
  onCancel: () => void;
  /** Receives the cropped square, ready to upload. */
  onDone: (cropped: File) => void;
}

interface Offset { x: number; y: number }

/**
 * Avatar cropper: the picture is fitted inside a square window, can be dragged with one finger (or the mouse) and
 * zoomed with a pinch, the wheel or the slider, and the square that will be saved is exactly what is shown.
 *
 * The empty space around the picture is not part of the result, so the output is always fully opaque: a PNG with
 * transparency is flattened onto the page background colour instead of leaving a see-through avatar.
 */
export function AvatarCropper({ file, sourceUrl, onCancel, onDone }: Props) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [loadError, setLoadError] = useState("");
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const [windowSize, setWindowSize] = useState(280);
  /** The size the picture is drawn at when zoom is 1 (it is fitted so the shorter side fills the window). */
  const [baseScale, setBaseScale] = useState({ width: 0, height: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null);

  // The window is a square that follows the screen: 280px on a desktop, a little less on a phone.
  useEffect(() => {
    const measure = (): void => {
      const width = stageRef.current?.clientWidth ?? 280;
      setWindowSize(Math.max(150, Math.min(width, 320)));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => {
    const element = new Image();
    element.decoding = "async";
    element.onload = () => {
      if (!element.naturalWidth || !element.naturalHeight) {
        setLoadError("这张图片无法读取，请换一张。");
        return;
      }
      setImage(element);
    };
    element.onerror = () => setLoadError("这台设备无法解码这张图片，请换一张（或先另存为 PNG、JPEG）。");
    element.src = sourceUrl;
    return () => { element.onload = null; element.onerror = null; };
  }, [sourceUrl]);

  // Fit the picture so its shorter side exactly fills the window, then centre it.
  useEffect(() => {
    if (!image) return;
    const ratio = image.naturalWidth / image.naturalHeight;
    const width = ratio >= 1 ? windowSize * ratio : windowSize;
    const height = ratio >= 1 ? windowSize : windowSize / ratio;
    setBaseScale({ width, height });
    setZoom(MIN_ZOOM);
    setOffset({ x: 0, y: 0 });
  }, [image, windowSize]);

  const clampOffset = useCallback((next: Offset, picture: { width: number; height: number }, level: number): Offset => {
    const halfWidth = Math.max(0, (picture.width * level - windowSize) / 2);
    const halfHeight = Math.max(0, (picture.height * level - windowSize) / 2);
    return {
      x: Math.min(halfWidth, Math.max(-halfWidth, next.x)),
      y: Math.min(halfHeight, Math.max(-halfHeight, next.y))
    };
  }, [windowSize]);

  const move = useCallback((next: Offset) => {
    setOffset((current) => clampOffset({ x: current.x + next.x, y: current.y + next.y }, baseScale, zoom));
  }, [baseScale, clampOffset, zoom]);

  const changeZoom = (next: number): void => {
    const level = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    setZoom(level);
    setOffset((current) => clampOffset(current, baseScale, level));
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if ((event.target as HTMLElement).closest("button")) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: offset.x, originY: offset.y };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setOffset(clampOffset({ x: drag.originX + (event.clientX - drag.startX), y: drag.originY + (event.clientY - drag.startY) }, baseScale, zoom));
  };
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  // Pinch to zoom on touch screens; the wheel does the same on a desktop.
  const onTouchStart = (event: React.TouchEvent<HTMLDivElement>): void => {
    if (event.touches.length !== 2) return;
    const [a, b] = [event.touches[0]!, event.touches[1]!];
    pinchRef.current = { distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), zoom };
  };
  const onTouchMove = (event: React.TouchEvent<HTMLDivElement>): void => {
    const pinch = pinchRef.current;
    if (!pinch || event.touches.length !== 2) return;
    const [a, b] = [event.touches[0]!, event.touches[1]!];
    const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    if (pinch.distance > 0) changeZoom(pinch.zoom * (distance / pinch.distance));
  };
  const onTouchEnd = (): void => { pinchRef.current = null; };

  /** Draws exactly the visible square at OUTPUT_SIZE and hands back a WebP (PNG if WebP is not available). */
  const save = async (): Promise<void> => {
    if (!image || saving) return;
    setSaving(true);
    try {
      // The picture's on-screen box inside the window (see `left`/`top` below), converted back to source pixels:
      // whatever part of the source sits under the window is exactly what gets drawn into the output square.
      const drawnWidth = baseScale.width * zoom;
      const drawnHeight = baseScale.height * zoom;
      const drawnLeft = (windowSize - drawnWidth) / 2 + offset.x;
      const drawnTop = (windowSize - drawnHeight) / 2 + offset.y;
      const sourcePerPixelX = image.naturalWidth / drawnWidth;
      const sourcePerPixelY = image.naturalHeight / drawnHeight;
      const sourceX = Math.max(0, -drawnLeft * sourcePerPixelX);
      const sourceY = Math.max(0, -drawnTop * sourcePerPixelY);
      const sourceWidth = Math.min(image.naturalWidth - sourceX, windowSize * sourcePerPixelX);
      const sourceHeight = Math.min(image.naturalHeight - sourceY, windowSize * sourcePerPixelY);
      const canvas = document.createElement("canvas");
      canvas.width = OUTPUT_SIZE;
      canvas.height = OUTPUT_SIZE;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("CANVAS_UNAVAILABLE");
      // Flatten transparency onto the page background, so a PNG logo does not become a see-through avatar.
      const background = getComputedStyle(document.body).backgroundColor;
      context.fillStyle = background && background !== "rgba(0, 0, 0, 0)" ? background : "#ffffff";
      context.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", OUTPUT_QUALITY));
      const output = blob && blob.type === "image/webp" ? blob : await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!output) throw new Error("ENCODE_FAILED");
      const extension = output.type === "image/webp" ? "webp" : "png";
      const baseName = file.name.replace(/\.[^.]+$/, "") || "avatar";
      onDone(new File([output], `${baseName}-cropped.${extension}`, { type: output.type }));
    } catch {
      setLoadError("裁剪后的图片生成失败，请重试或换一张图片。");
    } finally {
      setSaving(false);
    }
  };

  const left = (windowSize - baseScale.width * zoom) / 2 + offset.x;
  const top = (windowSize - baseScale.height * zoom) / 2 + offset.y;

  return <div className="avatar-crop-backdrop" role="presentation" onClick={onCancel}>
    <section className="avatar-crop" role="dialog" aria-modal="true" aria-labelledby="avatar-crop-title" onClick={(event) => event.stopPropagation()}>
      <div className="avatar-crop-head">
        <h2 id="avatar-crop-title">裁剪头像</h2>
        <button type="button" className="text-button" onClick={onCancel}>取消</button>
      </div>
      <p className="muted">拖动图片调整位置，用双指或滚轮缩放；方框里的部分会保存为头像。</p>
      <div ref={stageRef} className="avatar-crop-stage">
        <div className="avatar-crop-window" style={{ width: windowSize, height: windowSize }}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}
          onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
          onWheel={(event) => { event.preventDefault(); changeZoom(zoom - event.deltaY / 500); }}>
          {image && baseScale.width > 0
            ? <img src={sourceUrl} alt="待裁剪的头像" draggable={false}
                style={{ width: baseScale.width * zoom, height: baseScale.height * zoom, left, top }} />
            : <p className="avatar-crop-loading">{loadError || "正在读取图片…"}</p>}
          <span className="avatar-crop-grid" aria-hidden="true" />
        </div>
      </div>
      <label className="avatar-crop-zoom">
        <span>缩放</span>
        <input type="range" min={MIN_ZOOM} max={MAX_ZOOM} step={0.01} value={zoom} disabled={!image}
          aria-label="缩放图片" onChange={(event) => changeZoom(Number(event.target.value))} />
      </label>
      {loadError ? <p className="error-text" role="alert">{loadError}</p> : null}
      <div className="avatar-crop-buttons">
        <button type="button" className="secondary" onClick={onCancel}>取消</button>
        <button type="button" className="primary" disabled={!image || saving} onClick={() => void save()}>{saving ? "处理中…" : "使用这张头像"}</button>
      </div>
    </section>
  </div>;
}
