import cv2
import math

try:
    import numpy as np
except ImportError:
    from cv2 import numpy as np
import time
import asyncio


class VideoSimulator:
    def __init__(self, ugv):
        self.ugv = ugv
        self.W = 640
        self.H = 480
        self._frame_count = 0

    def _render_frame(self) -> np.ndarray:
        ugv = self.ugv
        t = time.time()
        frame = np.zeros((self.H, self.W, 3), dtype=np.uint8)

        # Sky gradient
        for y in range(self.H // 2):
            intensity = int(30 + y * 0.4)
            frame[y, :] = [intensity + 10, intensity, int(intensity * 0.6)]

        # Ground
        for y in range(self.H // 2, self.H):
            v = int(20 + (y - self.H // 2) * 0.15)
            frame[y, :] = [v, int(v * 1.3), v]

        # Horizon road / terrain lines (perspective)
        horizon_y = self.H // 2
        cx = self.W // 2

        # Road lanes fading to horizon
        for i in range(1, 8):
            factor = i / 8
            y_pos = int(horizon_y + (self.H - horizon_y) * factor)
            road_w = int(60 * factor * factor)
            road_w = max(road_w, 2)
            shade = int(40 + factor * 60)
            cv2.line(frame, (cx - road_w, y_pos), (cx + road_w, y_pos), (shade, shade, shade), 1)

        # Center dashed lane marker
        for i in range(1, 10):
            factor = i / 10
            y1 = int(horizon_y + (self.H - horizon_y) * (factor - 0.05))
            y2 = int(horizon_y + (self.H - horizon_y) * factor)
            if i % 2 == 0:
                x_spread = int(3 * factor * factor)
                cv2.line(frame, (cx - x_spread, y1), (cx + x_spread, y2), (180, 180, 50), max(1, x_spread))

        # Simulated obstacle blinking if close
        dist_cm = 200 + 30 * math.sin(t * 0.3)
        if dist_cm < 80:
            cv2.rectangle(frame, (cx - 40, horizon_y - 60), (cx + 40, horizon_y + 40), (0, 50, 180), -1)
            cv2.putText(frame, "OBSTACLE", (cx - 35, horizon_y), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 200, 255), 1)

        # Rolling terrain feature (moves with heading)
        heading_offset = int(ugv.heading * 2) % self.W
        for i in range(5):
            x = (heading_offset + i * 120) % self.W
            tree_h = 40 + i * 8
            cv2.rectangle(frame, (x - 4, horizon_y - tree_h), (x + 4, horizon_y), (30, 80, 30), -1)
            cv2.circle(frame, (x, horizon_y - tree_h), 12, (20, 120, 20), -1)

        # HUD overlay
        self._draw_hud(frame, ugv, t)

        self._frame_count += 1
        return frame

    def _draw_hud(self, frame, ugv, t):
        H, W = self.H, self.W
        overlay = frame.copy()

        # Top bar background
        cv2.rectangle(overlay, (0, 0), (W, 36), (0, 0, 0), -1)
        cv2.addWeighted(overlay, 0.5, frame, 0.5, 0, frame)

        # REC indicator
        if int(t * 2) % 2 == 0:
            cv2.circle(frame, (16, 18), 5, (0, 0, 220), -1)
        cv2.putText(frame, "REC", (26, 23), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (200, 200, 200), 1)

        # Timestamp
        ts = time.strftime("%H:%M:%S")
        cv2.putText(frame, ts, (W // 2 - 32, 23), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (200, 200, 200), 1)

        # Mode badge
        mode = "AUTO" if ugv.autonomous_mode else "MANUAL"
        color = (0, 200, 100) if ugv.autonomous_mode else (0, 180, 220)
        cv2.putText(frame, mode, (W - 75, 23), cv2.FONT_HERSHEY_SIMPLEX, 0.45, color, 1)

        # Crosshair
        cx, cy = W // 2, H // 2
        size = 12
        cv2.line(frame, (cx - size, cy), (cx - 4, cy), (0, 255, 0), 1)
        cv2.line(frame, (cx + 4, cy), (cx + size, cy), (0, 255, 0), 1)
        cv2.line(frame, (cx, cy - size), (cx, cy - 4), (0, 255, 0), 1)
        cv2.line(frame, (cx, cy + 4), (cx, cy + size), (0, 255, 0), 1)

        # Speed bar (bottom left)
        speed_pct = min(1.0, abs(ugv.speed) / 2.0)
        bar_w = int(100 * speed_pct)
        cv2.rectangle(frame, (10, H - 30), (110, H - 18), (60, 60, 60), -1)
        bar_color = (0, 220, 80) if ugv.speed >= 0 else (80, 80, 220)
        cv2.rectangle(frame, (10, H - 30), (10 + bar_w, H - 18), bar_color, -1)
        cv2.putText(frame, f"{abs(ugv.speed):.1f} m/s", (10, H - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (200, 200, 200), 1)

        # Heading compass (bottom right)
        cv2.putText(frame, f"HDG {ugv.heading:.0f}°", (W - 90, H - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (200, 200, 200), 1)

        # E-STOP warning — border only, text handled by HTML overlay
        if ugv._estop:
            cv2.rectangle(frame, (0, 0), (W, H), (0, 0, 180), 4)

    async def generate_frames(self):
        while True:
            frame = self._render_frame()
            _, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
            data = jpeg.tobytes()
            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n\r\n" + data + b"\r\n"
            )
            await asyncio.sleep(1 / 20)  # 20 FPS
