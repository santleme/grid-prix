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
        <span>NEON CIRCUIT</span>
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
  context.fillStyle = "#f6f8f7";
  context.fillRect(0, 0, WIDTH, HEIGHT);

  context.save();
  context.strokeStyle = "rgba(58, 89, 82, 0.035)";
  context.lineWidth = 1;
  for (let i = 0; i < 4; i += 1) {
    context.beginPath();
    context.ellipse(WIDTH * .5, HEIGHT * .52, 330 + i * 65, 150 + i * 42, -.04, 0, Math.PI * 2);
    context.stroke();
  }
  context.restore();

  const track = new Path2D();
  if (points.length) {
    const canvasPoints = points.map((point) => ({ x: clamp(point.x) * WIDTH, y: clamp(point.y) * HEIGHT }));
    track.moveTo(canvasPoints[0].x, canvasPoints[0].y);
    for (const point of canvasPoints.slice(1)) track.lineTo(point.x, point.y);
    track.closePath();
  }

  context.save();
  context.translate(0, 14);
  context.strokeStyle = "rgba(89, 106, 100, .24)";
  context.lineWidth = 74;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.shadowColor = "rgba(42, 59, 54, .2)";
  context.shadowBlur = 14;
  context.shadowOffsetY = 3;
  context.stroke(track);
  context.restore();

  context.save();
  context.strokeStyle = "rgba(44, 71, 67, 0.17)";
  context.lineWidth = 80;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.shadowColor = "rgba(31, 52, 49, .24)";
  context.shadowBlur = 28;
  context.shadowOffsetY = 13;
  context.stroke(track);
  context.shadowColor = "transparent";
  context.shadowBlur = 0;
  context.shadowOffsetY = 0;
  const roadEdge = context.createLinearGradient(0, 110, 0, 700);
  roadEdge.addColorStop(0, "#fafcfb");
  roadEdge.addColorStop(.2, "#dce3e0");
  roadEdge.addColorStop(.52, "#c2cdca");
  roadEdge.addColorStop(.78, "#d3dcda");
  roadEdge.addColorStop(1, "#f6f8f7");
  context.strokeStyle = roadEdge;
  context.lineWidth = 69;
  context.stroke(track);
  context.strokeStyle = "#d6dfdc";
  context.lineWidth = 59;
  context.stroke(track);
  context.strokeStyle = "rgba(255,255,255,.34)";
  context.lineWidth = 53;
  context.stroke(track);
  context.strokeStyle = "rgba(255,255,255,.9)";
  context.lineWidth = 2.5;
  context.stroke(track);
  context.strokeStyle = "rgba(112, 134, 128, .37)";
  context.lineWidth = 1.5;
  context.setLineDash([10, 12]);
  context.stroke(track);
  context.setLineDash([]);
  context.restore();

  context.save();
  context.fillStyle = "#14b98a";
  context.shadowColor = "rgba(20,185,138,.35)";
  context.shadowBlur = 12;
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
    context.arc(x, y, driver.id === selectedDriverId ? 9 : 6.5, 0, Math.PI * 2);
    context.fillStyle = driver.id === selectedDriverId ? "#0caf80" : "#697674";
    context.shadowColor = driver.id === selectedDriverId ? "rgba(12,175,128,.55)" : "rgba(28,45,43,.23)";
    context.shadowBlur = driver.id === selectedDriverId ? 22 : 9;
    context.fill();
    context.shadowBlur = 0;
    context.strokeStyle = "rgba(255,255,255,.94)";
    context.lineWidth = 2.5;
    context.stroke();
    context.restore();
  }
}

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}
