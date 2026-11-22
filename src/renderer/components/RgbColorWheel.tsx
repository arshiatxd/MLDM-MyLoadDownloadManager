import { useCallback, useEffect, useRef, useState } from 'react';
import { hexToRgb, hsvToRgb, normalizeHexColor, rgbToHex, rgbToHsv } from '../../shared/constants';

interface RgbColorWheelProps {
  color: string;
  onChange: (hex: string) => void;
}

const WHEEL_SIZE = 168;
const RADIUS = WHEEL_SIZE / 2;

export function RgbColorWheel({ color, onChange }: RgbColorWheelProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const draggingRef = useRef(false);

  const normalized = normalizeHexColor(color, '#c81e3d');
  const rgb = hexToRgb(normalized);
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
  const [hexDraft, setHexDraft] = useState(normalized);

  useEffect(() => {
    setHexDraft(normalized);
  }, [normalized]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = ctx.createImageData(WHEEL_SIZE, WHEEL_SIZE);
    const data = img.data;
    const val = Math.max(0.18, hsv.v);

    for (let y = 0; y < WHEEL_SIZE; y++) {
      for (let x = 0; x < WHEEL_SIZE; x++) {
        const dx = x - RADIUS + 0.5;
        const dy = y - RADIUS + 0.5;
        const dist = Math.hypot(dx, dy);
        const idx = (y * WHEEL_SIZE + x) * 4;
        if (dist > RADIUS - 1) {
          data[idx + 3] = 0;
          continue;
        }
        const sat = Math.min(1, dist / (RADIUS - 1));
        const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
        const hue = angle < 0 ? angle + 360 : angle;
        const pxRgb = hsvToRgb(hue, sat, val);
        const edgeAlpha = dist > RADIUS - 2.2 ? Math.max(0, (RADIUS - 1 - dist) / 1.2) : 1;
        data[idx] = pxRgb.r;
        data[idx + 1] = pxRgb.g;
        data[idx + 2] = pxRgb.b;
        data[idx + 3] = Math.round(edgeAlpha * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [hsv.v]);

  const pickFromPoint = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left - rect.width / 2;
      const y = clientY - rect.top - rect.height / 2;
      const maxR = rect.width / 2 - 1;
      const dist = Math.min(maxR, Math.hypot(x, y));
      const sat = maxR > 0 ? dist / maxR : 0;
      const angle = (Math.atan2(y, x) * 180) / Math.PI;
      const hue = angle < 0 ? angle + 360 : angle;
      const nextRgb = hsvToRgb(hue, sat, Math.max(0.15, hsv.v));
      onChange(rgbToHex(nextRgb.r, nextRgb.g, nextRgb.b));
    },
    [hsv.v, onChange]
  );

  const markerAngle = (hsv.h * Math.PI) / 180;
  const markerDist = hsv.s * (RADIUS - 3);
  const markerX = RADIUS + Math.cos(markerAngle) * markerDist;
  const markerY = RADIUS + Math.sin(markerAngle) * markerDist;

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="relative shrink-0" style={{ width: WHEEL_SIZE, height: WHEEL_SIZE }}>
        <canvas
          ref={canvasRef}
          width={WHEEL_SIZE}
          height={WHEEL_SIZE}
          onPointerDown={(e) => {
            draggingRef.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            pickFromPoint(e.clientX, e.clientY);
          }}
          onPointerMove={(e) => {
            if (draggingRef.current) pickFromPoint(e.clientX, e.clientY);
          }}
          onPointerUp={() => {
            draggingRef.current = false;
          }}
          onPointerCancel={() => {
            draggingRef.current = false;
          }}
          aria-label="RGB color wheel"
          className="cursor-crosshair rounded-full border border-[var(--border-strong)]"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
          style={{
            left: markerX,
            top: markerY,
            backgroundColor: normalized,
          }}
        />
      </div>

      <div className="min-w-[200px] flex-1 space-y-2.5 text-[13px]">
        <div>
          <div className="mb-1 flex items-center justify-between text-[var(--text-secondary)]">
            <span>Brightness</span>
            <span className="font-mono text-[12px]">{Math.round(hsv.v * 100)}%</span>
          </div>
          <input
            type="range"
            min={5}
            max={100}
            value={Math.round(hsv.v * 100)}
            onChange={(e) => {
              const v = Math.max(0.05, Number(e.target.value) / 100);
              const nextRgb = hsvToRgb(hsv.h, hsv.s, v);
              onChange(rgbToHex(nextRgb.r, nextRgb.g, nextRgb.b));
            }}
            aria-label="Brightness"
            className="w-full accent-[var(--accent)]"
          />
        </div>

        {(
          [
            { key: 'r' as const, label: 'R', value: rgb.r },
            { key: 'g' as const, label: 'G', value: rgb.g },
            { key: 'b' as const, label: 'B', value: rgb.b },
          ]
        ).map((ch) => (
          <div key={ch.key} className="flex items-center gap-2">
            <span className="w-4 font-mono text-[12px] font-semibold text-[var(--text-secondary)]">
              {ch.label}
            </span>
            <input
              type="range"
              min={0}
              max={255}
              value={ch.value}
              onChange={(e) => {
                const next = { ...rgb, [ch.key]: Number(e.target.value) };
                onChange(rgbToHex(next.r, next.g, next.b));
              }}
              aria-label={`${ch.label} channel`}
              className="flex-1 accent-[var(--accent)]"
            />
            <span className="w-8 text-right font-mono text-[12px] text-[var(--text-primary)]">
              {ch.value}
            </span>
          </div>
        ))}

        <div className="flex items-center gap-2 pt-0.5">
          <span
            className="h-8 w-8 shrink-0 rounded-md border border-[var(--border-strong)]"
            style={{ backgroundColor: normalized }}
            aria-hidden="true"
          />
          <input
            type="text"
            value={hexDraft}
            maxLength={7}
            onChange={(e) => {
              const val = e.target.value;
              setHexDraft(val);
              if (/^#[0-9a-fA-F]{6}$/.test(val.trim())) {
                onChange(val.trim().toLowerCase());
              }
            }}
            onBlur={() => setHexDraft(normalized)}
            aria-label="Hex color code"
            className="h-8 w-28 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 font-mono text-[13px] text-[var(--text-primary)]"
          />
        </div>
      </div>
    </div>
  );
}

