import asyncio
import math
import time

import cv2

try:
    import numpy as np
except ImportError:
    from cv2 import numpy as np


class VideoSimulator:
    def __init__(self, ugv):
        self.ugv = ugv
        self.W = 960
        self.H = 540
        self._frame_count = 0
        self._rng = np.random.default_rng(42)
        self._vignette = self._make_vignette()

    def _make_vignette(self):
        y, x = np.indices((self.H, self.W))
        cx, cy = self.W / 2, self.H / 2
        dist = np.sqrt(((x - cx) / cx) ** 2 + ((y - cy) / cy) ** 2)
        mask = 1.0 - np.clip((dist - 0.28) * 0.42, 0.0, 0.32)
        return mask[..., None].astype(np.float32)

    def _render_frame(self) -> np.ndarray:
        ugv = self.ugv
        t = time.time()
        frame = np.zeros((self.H, self.W, 3), dtype=np.uint8)

        self._draw_environment(frame, ugv, t)
        self._draw_depth_grid(frame, ugv, t)
        self._draw_scene_objects(frame, ugv, t)
        self._draw_sensor_effects(frame, t)
        self._draw_hud(frame, ugv, t)

        self._frame_count += 1
        return frame

    def _draw_environment(self, frame, ugv, t):
        horizon = int(self.H * 0.44 + math.sin(t * 0.35) * 2)
        heading_shift = math.sin(math.radians(ugv.heading)) * 18

        # Sky gradient with a warm horizon band.
        for y in range(horizon):
            f = y / max(1, horizon)
            blue = int(72 + 36 * f)
            green = int(64 + 46 * f)
            red = int(42 + 34 * f)
            frame[y, :] = [blue, green, red]

        glow_y = max(0, horizon - 52)
        cv2.ellipse(
            frame,
            (int(self.W * 0.72 + heading_shift), glow_y),
            (150, 38),
            0,
            0,
            360,
            (92, 106, 96),
            -1,
            cv2.LINE_AA,
        )
        frame[:horizon] = cv2.GaussianBlur(frame[:horizon], (0, 0), 2.0)

        # Distant terrain silhouette.
        ridge = []
        for x in range(-20, self.W + 21, 24):
            y = int(horizon - 10 + math.sin(x * 0.018 + ugv.heading * 0.035) * 10)
            ridge.append((x, y))
        terrain = np.array(ridge + [(self.W + 20, horizon + 24), (-20, horizon + 24)], np.int32)
        cv2.fillPoly(frame, [terrain], (38, 56, 48), cv2.LINE_AA)

        # Ground gradient.
        for y in range(horizon, self.H):
            f = (y - horizon) / max(1, self.H - horizon)
            frame[y, :] = [int(35 + 15 * f), int(47 + 36 * f), int(38 + 18 * f)]

        # Perspective road.
        cx = int(self.W / 2 + heading_shift)
        road_top = 70
        road_bottom = int(self.W * 0.92)
        road = np.array(
            [
                [cx - road_top // 2, horizon],
                [cx + road_top // 2, horizon],
                [self.W // 2 + road_bottom // 2, self.H],
                [self.W // 2 - road_bottom // 2, self.H],
            ],
            np.int32,
        )
        cv2.fillPoly(frame, [road], (54, 58, 60), cv2.LINE_AA)

        shoulder_l = np.array(
            [[cx - road_top // 2 - 6, horizon], [cx - road_top // 2, horizon], [self.W // 2 - road_bottom // 2, self.H], [0, self.H]],
            np.int32,
        )
        shoulder_r = np.array(
            [[cx + road_top // 2, horizon], [cx + road_top // 2 + 6, horizon], [self.W, self.H], [self.W // 2 + road_bottom // 2, self.H]],
            np.int32,
        )
        cv2.fillPoly(frame, [shoulder_l], (42, 72, 50), cv2.LINE_AA)
        cv2.fillPoly(frame, [shoulder_r], (42, 72, 50), cv2.LINE_AA)

        # Road edge lines.
        cv2.line(frame, tuple(road[0]), tuple(road[3]), (126, 132, 118), 2, cv2.LINE_AA)
        cv2.line(frame, tuple(road[1]), tuple(road[2]), (126, 132, 118), 2, cv2.LINE_AA)

        # Center dashed line.
        for i in range(11):
            f1 = i / 11
            f2 = min(1.0, f1 + 0.045)
            if i % 2 == 0:
                y1 = int(horizon + (self.H - horizon) * (f1 ** 1.65))
                y2 = int(horizon + (self.H - horizon) * (f2 ** 1.65))
                w1 = int(2 + 14 * f1)
                cv2.line(frame, (cx, y1), (self.W // 2, y2), (184, 176, 116), max(1, w1), cv2.LINE_AA)

    def _draw_depth_grid(self, frame, ugv, t):
        horizon = int(self.H * 0.44)
        cx = self.W // 2

        # Faint range bands help the view feel like a real FPV/navigation camera.
        for i in range(1, 8):
            f = i / 8
            y = int(horizon + (self.H - horizon) * (f ** 1.9))
            width = int(80 + 720 * (f ** 1.7))
            color = (78, 88, 82)
            cv2.line(frame, (cx - width // 2, y), (cx + width // 2, y), color, 1, cv2.LINE_AA)

        yaw = math.sin(math.radians(ugv.heading)) * 32
        for offset in [-0.38, -0.22, 0.22, 0.38]:
            x_top = int(cx + yaw + offset * 120)
            x_bot = int(cx + offset * self.W)
            cv2.line(frame, (x_top, horizon), (x_bot, self.H), (50, 72, 66), 1, cv2.LINE_AA)

    def _draw_scene_objects(self, frame, ugv, t):
        horizon = int(self.H * 0.44)
        heading_offset = (ugv.heading * 0.013 + t * 0.05) % 1.0

        for i in range(10):
            phase = (i * 0.137 + heading_offset) % 1.0
            side = -1 if i % 2 == 0 else 1
            depth = 0.18 + 0.78 * phase
            y = int(horizon + (self.H - horizon) * (depth ** 1.7))
            x = int(self.W / 2 + side * (130 + 410 * depth) + math.sin(i * 2.1 + t * 0.2) * 12)
            scale = 0.35 + 1.45 * depth
            self._draw_tree(frame, x, y, scale)

        # A soft, animated range target/obstacle in the lane.
        obstacle_phase = 0.5 + 0.5 * math.sin(t * 0.28)
        if obstacle_phase > 0.72:
            depth = 0.55 + 0.22 * obstacle_phase
            y = int(horizon + (self.H - horizon) * depth)
            w = int(42 + 46 * depth)
            h = int(34 + 38 * depth)
            x = self.W // 2 + int(math.sin(t * 0.7) * 38)
            cv2.rectangle(frame, (x - w, y - h), (x + w, y + h), (36, 68, 150), -1, cv2.LINE_AA)
            cv2.rectangle(frame, (x - w, y - h), (x + w, y + h), (92, 128, 205), 2, cv2.LINE_AA)
            cv2.putText(frame, "RANGE TARGET", (x - w + 8, y + 5), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (210, 226, 236), 1, cv2.LINE_AA)

    def _draw_tree(self, frame, x, ground_y, scale):
        trunk_w = max(2, int(5 * scale))
        trunk_h = max(14, int(36 * scale))
        crown = max(10, int(24 * scale))
        cv2.rectangle(frame, (x - trunk_w, ground_y - trunk_h), (x + trunk_w, ground_y), (36, 55, 42), -1, cv2.LINE_AA)
        cv2.circle(frame, (x, ground_y - trunk_h), crown, (33, 100, 55), -1, cv2.LINE_AA)
        cv2.circle(frame, (x - crown // 3, ground_y - trunk_h + crown // 5), crown // 2, (28, 82, 48), -1, cv2.LINE_AA)
        cv2.circle(frame, (x + crown // 3, ground_y - trunk_h + crown // 6), crown // 2, (46, 116, 62), -1, cv2.LINE_AA)

    def _draw_sensor_effects(self, frame, t):
        # Vignette and subtle scan/noise treatment, kept light so it feels modern.
        f = frame.astype(np.float32) * self._vignette

        scan = (np.sin(np.arange(self.H) * 0.55 + t * 18) * 1.5).astype(np.float32)
        f += scan[:, None, None]

        if self._frame_count % 2 == 0:
            noise = self._rng.normal(0, 2.0, frame.shape).astype(np.float32)
            f += noise

        np.clip(f, 0, 255, out=f)
        frame[:] = f.astype(np.uint8)

    def _draw_hud(self, frame, ugv, t):
        H, W = self.H, self.W
        cx, cy = W // 2, H // 2

        overlay = frame.copy()
        cv2.rectangle(overlay, (0, 0), (W, 44), (5, 7, 9), -1)
        cv2.rectangle(overlay, (0, H - 42), (W, H), (5, 7, 9), -1)
        cv2.addWeighted(overlay, 0.48, frame, 0.52, 0, frame)

        # Framing guides.
        guide = (92, 220, 150) if ugv.autonomous_mode else (216, 185, 70)
        cv2.line(frame, (cx - 42, cy), (cx - 14, cy), guide, 1, cv2.LINE_AA)
        cv2.line(frame, (cx + 14, cy), (cx + 42, cy), guide, 1, cv2.LINE_AA)
        cv2.line(frame, (cx, cy - 42), (cx, cy - 14), guide, 1, cv2.LINE_AA)
        cv2.line(frame, (cx, cy + 14), (cx, cy + 42), guide, 1, cv2.LINE_AA)
        cv2.circle(frame, (cx, cy), 4, guide, 1, cv2.LINE_AA)

        # Horizon/attitude marker.
        roll = int(ugv.angular_vel * 0.25)
        cv2.line(frame, (cx - 120, cy + roll), (cx - 38, cy + roll), (86, 148, 165), 1, cv2.LINE_AA)
        cv2.line(frame, (cx + 38, cy + roll), (cx + 120, cy + roll), (86, 148, 165), 1, cv2.LINE_AA)

        mode = "AUTO" if ugv.autonomous_mode else "MANUAL"
        mode_color = (92, 220, 150) if ugv.autonomous_mode else (216, 185, 70)

        if int(t * 2) % 2 == 0:
            cv2.circle(frame, (22, 22), 5, (42, 62, 220), -1, cv2.LINE_AA)
        cv2.putText(frame, "REC", (36, 27), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (210, 220, 226), 1, cv2.LINE_AA)
        cv2.putText(frame, time.strftime("%H:%M:%S"), (W // 2 - 42, 27), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (210, 220, 226), 1, cv2.LINE_AA)
        cv2.putText(frame, mode, (W - 92, 27), cv2.FONT_HERSHEY_SIMPLEX, 0.48, mode_color, 1, cv2.LINE_AA)

        speed_pct = min(1.0, abs(ugv.speed) / max(0.01, ugv.MAX_SPEED))
        bar_x, bar_y = 18, H - 28
        cv2.rectangle(frame, (bar_x, bar_y), (bar_x + 150, bar_y + 8), (52, 58, 64), -1, cv2.LINE_AA)
        cv2.rectangle(frame, (bar_x, bar_y), (bar_x + int(150 * speed_pct), bar_y + 8), (92, 220, 150), -1, cv2.LINE_AA)
        cv2.putText(frame, f"{abs(ugv.speed):.1f} M/S", (bar_x, H - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (218, 226, 232), 1, cv2.LINE_AA)

        cv2.putText(frame, f"HDG {ugv.heading:03.0f}", (W - 104, H - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (218, 226, 232), 1, cv2.LINE_AA)

        if ugv._estop:
            cv2.rectangle(frame, (0, 0), (W, H), (42, 52, 220), 5, cv2.LINE_AA)

    async def generate_frames(self):
        while True:
            frame = self._render_frame()
            _, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 88])
            data = jpeg.tobytes()
            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n\r\n" + data + b"\r\n"
            )
            await asyncio.sleep(1 / 24)
