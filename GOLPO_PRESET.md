# Golpo-accurate doodle preset (derived from C:\GolpoAI\youtube-channel-demo.mp4)

Source: 10:04 video, 1536x1024, 30fps. Analyzed 20 frames (1 per 30s) with k-means + Canny.

## Canvas
- Background: near-white, RGB(254,254,253) — use #FEFEFD, not pure #FFFFFF (softer paper feel).
- Aspect: 3:2 (1536x1024). Render at 1536x1024 or scale preserving 3:2.

## Ink / line colors (dominant non-background)
- Primary ink (dark): RGB(27-55, 16-46, 9-32) -> hex ~#1B1009 / #2F2315. Use for main outlines/text.
- Warm tan fill: RGB(202-229, 177-216, 128-165) -> hex ~#CFAF8A / #E5D8A4. Use for fills/shading.
- Mid brown: RGB(160-185, 108-142, 71-101) -> hex ~#A87A52. Secondary strokes.
- Accent orange: RGB(214-224, 96-114, 58-59) -> hex ~#D66A3A. Highlights/CTA.
- Deep brown: RGB(100-134, 71-100, 48-69) -> hex ~#7A5A3F. Shadows.

## Line quality
- Edge density per frame ~0.05-0.26 (sparse, deliberate strokes; not dense scribble).
- Lines are hand-drawn wobbly but clean; use a slight jitter (2-4px) on straight segments.
- Recommended stroke width: 3-5px at 1536x1024 (scale with canvas).
- Use round caps/joins for smooth doodle feel.

## Animation pacing
- Frames sampled every 30s show progressive reveal (stroke-by-stroke draw-on).
- Keep draw-on duration ~0.6-1.2s per element; hold 1-2s before next.
- Avoid simultaneous multi-element animation; sequential reads better.

## Implementation notes for DoodleMinds
- Set canvas background to #FEFEFD.
- Default palette: ink #1B1009, fill #CFAF8A, accent #D66A3A, shadow #7A5A3F.
- Stroke width 4px, round caps, slight jitter.
- Sequential draw-on, 0.8s per stroke, 1.5s hold.
- Match Golpo's 3:2 canvas and sequential reveal for best accuracy.
