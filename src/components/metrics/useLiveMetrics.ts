"use client";

import { useEffect, useRef } from "react";
import { computeMetrics, type MetricsInput } from "@/engine/metrics";
import type { Metrics } from "@/types/game";

/**
 * Drives the live speedometer at display refresh rate (AGENTS.md §1.3, §4.11).
 *
 * Deliberately does NOT call setState. Re-rendering React 60 times a second is
 * the exact pattern §4.11 forbids for the editor, and the speedometer sits in
 * the same frame budget. `onFrame` is expected to write into DOM refs.
 *
 * `sample` and `onFrame` are read through refs, so a caller passing inline
 * closures does not restart the loop on every render.
 */
export function useLiveMetrics(
  active: boolean,
  sample: () => MetricsInput,
  onFrame: (metrics: Metrics) => void,
): void {
  const sampleRef = useRef(sample);
  const onFrameRef = useRef(onFrame);

  useEffect(() => {
    sampleRef.current = sample;
    onFrameRef.current = onFrame;
  });

  useEffect(() => {
    if (!active) return;

    let frame = 0;
    const tick = () => {
      onFrameRef.current(computeMetrics(sampleRef.current()));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frame);
  }, [active]);

  // One final frame after the run ends, so the display lands on the true final
  // numbers instead of whatever the last animation frame happened to catch.
  useEffect(() => {
    if (active) return;
    onFrameRef.current(computeMetrics(sampleRef.current()));
  }, [active]);
}
