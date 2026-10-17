import { useEffect, useRef } from "react";
import type { MouseEvent } from "react";
import type { DriverView } from "./types";

interface RaceCanvasProps {
  drivers: DriverView[];
  track: Array<{ x: number; y: number }>;
  status: string;
  tick: number;
  onSelectDriver?: (id: string) => void;
  selectedDriverId?: string;
}

const WIDTH = 1200;
const HEIGHT = 760;

export function RaceCanvas({
  drivers,
  track,
  status,
  tick,
  onSelectDriver,
  selectedDriverId,
}: RaceCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => {
      const context = canvas.getContext("2d");
      if (!context) return;
      const bounds = canvas.getBoundingClientRect();
      const ratio = Math.max(1, window.devicePixelRatio || 1);
      canvas.width = Math.round(bounds.width * ratio);
      canvas.height = Math.round(bounds.height * ratio);
      context.scale(canvas.width / WIDTH, canvas.height / HEIGHT);
      drawTrack(context, drivers, track, selectedDriverId);
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [drivers, track, selectedDriverId, tick]);

  function selectAt(event: MouseEvent<HTMLCanvasElement>) {
    if (!onSelectDriver) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * WIDTH;
    const y = ((event.clientY - bounds.top) / bounds.height) * HEIGHT;
    const hit = drivers.find((driver) => {
      const dx = driver.x * WIDTH - x;
      const dy = driver.y * HEIGHT - y;
      return dx * dx + dy * dy < 22 * 22;
    });
    if (hit) onSelectDriver(hit.id);
  }

  return (
    <div className="race-canvas-wrap">
      <canvas
        ref={canvasRef}
        className="race-canvas"
        onClick={selectAt}
        role="img"
        aria-label={`Top-down race track with ${drivers.length} drivers. Race ${status}.`}
      />
      {drivers.length === 0 && (
        <div className="track-empty">
          <span className="track-empty-mark">◎</span>
          <strong>Race grid not loaded</strong>
          <span>Start a championship to populate the track.</span>
        </div>
      )}
      <div className="track-coordinates" aria-hidden="true">
        <span>GRID / 01</span>
        <span>SECTOR 01 · 02 · 03</span>
      </div>
    </div>
  );
}

function drawTrack(
  context: CanvasRenderingContext2D,
  drivers: DriverView[],
  points: Array<{ x: number; y: number }>,
  selectedDriverId?: string,
) {
  context.clearRect(0, 0, WIDTH, HEIGHT);
  context.fillStyle = "#0b1015";
  context.fillRect(0, 0, WIDTH, HEIGHT);

  context.save();
  context.strokeStyle = "rgba(173, 201, 215, 0.055)";
  context.lineWidth = 1;
  for (let x = 0; x <= WIDTH; x += 40) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, HEIGHT);
    context.stroke();
  }
  for (let y = 0; y <= HEIGHT; y += 40) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(WIDTH, y);
    context.stroke();
  }
  context.restore();

  const track = new Path2D();
  if (points.length) {
    track.moveTo(clamp(points[0].x) * WIDTH, clamp(points[0].y) * HEIGHT);
    for (const point of points.slice(1)) track.lineTo(clamp(point.x) * WIDTH, clamp(point.y) * HEIGHT);
    track.closePath();
  }

  context.save();
  context.strokeStyle = "rgba(29, 244, 193, 0.12)";
  context.lineWidth = 66;
  context.lineJoin = "round";
  context.stroke(track);
  context.strokeStyle = "#26343c";
  context.lineWidth = 58;
  context.stroke(track);
  context.strokeStyle = "rgba(207, 220, 226, 0.25)";
  context.lineWidth = 2;
  context.setLineDash([10, 12]);
  context.stroke(track);
  context.setLineDash([]);
  context.restore();

  context.save();
  context.fillStyle = "#1df4c1";
  context.shadowColor = "#1df4c1";
  context.shadowBlur = 16;
  if (points.length) context.fillRect(clamp(points[0].x) * WIDTH - 3, clamp(points[0].y) * HEIGHT - 22, 6, 44);
  context.restore();

  for (const driver of drivers) {
    const x = clamp(driver.x) * WIDTH;
    const y = clamp(driver.y) * HEIGHT;
    if (driver.trail?.length) {
      context.save();
      context.beginPath();
      driver.trail.forEach((point, index) => {
        const trailX = clamp(point.x) * WIDTH;
        const trailY = clamp(point.y) * HEIGHT;
        if (index === 0) context.moveTo(trailX, trailY);
        else context.lineTo(trailX, trailY);
      });
      context.strokeStyle = `${driver.color}55`;
      context.lineWidth = 2;
      context.stroke();
      context.restore();
    }
    context.save();
    context.beginPath();
    context.arc(x, y, driver.id === selectedDriverId ? 10 : 7, 0, Math.PI * 2);
    context.fillStyle = driver.color;
    context.shadowColor = driver.color;
    context.shadowBlur = driver.id === selectedDriverId ? 26 : 14;
    context.fill();
    context.shadowBlur = 0;
    context.strokeStyle = "rgba(8, 13, 17, 0.9)";
    context.lineWidth = 2;
    context.stroke();
    context.restore();
  }
}

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}
