import React from 'react';

interface FrameCounterProps {
  currentFrame: number;
  totalFrames: number;
  currentTime: number;
}

export default function FrameCounter({ currentFrame, totalFrames, currentTime }: FrameCounterProps) {
  const timeStr = `T-${currentTime.toFixed(1)}s`;
  return (
    <div className="frame-counter">
      FRAME {currentFrame} / {totalFrames} | {timeStr}
    </div>
  );
}
