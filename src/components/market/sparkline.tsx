"use client";

import { useEffect, useRef } from "react";
import type { SparklinePoint } from "@/lib/types";

interface SparklineProps {
  data: SparklinePoint[];
  width?: number;
  height?: number;
  positive?: boolean;
}

export function Sparkline({ data, width = 80, height = 32, positive = true }: SparklineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length < 2) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const values = data.map((d) => d.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    ctx.clearRect(0, 0, width, height);

    // Draw line
    ctx.beginPath();
    ctx.strokeStyle = positive ? "#00c853" : "#ef4444";
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";

    data.forEach((point, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((point.value - min) / range) * (height - 4) - 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Fill gradient
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    if (positive) {
      gradient.addColorStop(0, "rgba(0, 200, 83, 0.14)");
      gradient.addColorStop(1, "rgba(0, 200, 83, 0)");
    } else {
      gradient.addColorStop(0, "rgba(239, 68, 68, 0.14)");
      gradient.addColorStop(1, "rgba(239, 68, 68, 0)");
    }
    ctx.fillStyle = gradient;
    ctx.fill();
  }, [data, width, height, positive]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height }}
      className="block"
    />
  );
}
