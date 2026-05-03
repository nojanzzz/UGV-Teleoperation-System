import math
import time


class UGVSimulator:
    def __init__(self, command_timeout_s: float = 0.35):
        # Position in lat/lng (start: IPB University area)
        self.lat = -6.589190898640269
        self.lng = 106.8060121530933
        self.heading = 0.0       # degrees, 0 = north
        self.speed = 0.0         # m/s
        self.angular_vel = 0.0   # deg/s

        # Drive inputs [-1, 1]
        self._throttle = 0.0
        self._steering = 0.0

        # Physical limits
        self.MAX_SPEED = 5.0       # m/s
        self.MAX_ANGULAR = 120.0   # deg/s
        self.ACCEL = 5.0           # m/s^2
        self.DECEL = 7.0           # m/s^2

        # Waypoint navigation
        self.waypoints: list[dict] = []
        self.waypoint_index = 0
        self.autonomous_mode = False
        self.WAYPOINT_RADIUS = 3.0  # meters to consider "reached"

        # Safety state
        self._estop = False
        self.command_timeout_s = command_timeout_s
        self._last_manual_command = time.monotonic()
        self._command_stale = False

        self._last_tick = time.monotonic()

    # ------------------------------------------------------------------
    def apply_command(self, throttle: float, steering: float):
        if self._estop:
            return

        self._throttle = max(-1.0, min(1.0, float(throttle)))
        self._steering = max(-1.0, min(1.0, float(steering)))
        self._last_manual_command = time.monotonic()
        self._command_stale = False

    def release_estop(self):
        self._estop = False
        self.autonomous_mode = False
        self.stop_motion()
        self._last_manual_command = time.monotonic()
        self._command_stale = False

    def emergency_stop(self):
        self._estop = True
        self.autonomous_mode = False
        self.stop_motion()

    def stop_motion(self):
        self._throttle = 0.0
        self._steering = 0.0
        self.speed = 0.0
        self.angular_vel = 0.0

    def add_waypoint(self, lat: float, lng: float):
        self.waypoints.append({"lat": float(lat), "lng": float(lng)})

    def update_waypoint(self, index: int, lat: float, lng: float):
        self.waypoints[index] = {"lat": float(lat), "lng": float(lng)}

    def clear_waypoints(self):
        self.waypoints.clear()
        self.waypoint_index = 0
        self.autonomous_mode = False
        self.stop_motion()

    def delete_waypoint(self, index: int):
        self.waypoints.pop(index)
        if self.waypoint_index > index:
            self.waypoint_index = max(0, self.waypoint_index - 1)
        if self.waypoint_index >= len(self.waypoints):
            self.waypoint_index = max(0, len(self.waypoints) - 1)
        if not self.waypoints:
            self.clear_waypoints()

    # ------------------------------------------------------------------
    def tick(self):
        now = time.monotonic()
        dt = min(now - self._last_tick, 0.1)
        self._last_tick = now

        if self._estop:
            self.speed = self._decelerate_to_zero(self.speed, dt)
            self.angular_vel = 0.0
            return

        if self.autonomous_mode and self.waypoints:
            self._command_stale = False
            self._autonomous_tick(dt)
        else:
            self._apply_deadman(now)
            self._manual_tick(dt)

        self._integrate_position(dt)

    def _apply_deadman(self, now: float):
        stale = now - self._last_manual_command > self.command_timeout_s
        if stale:
            self._throttle = 0.0
            self._steering = 0.0
            self._command_stale = True

    def _manual_tick(self, dt: float):
        target_speed = self._throttle * self.MAX_SPEED
        if abs(target_speed) > abs(self.speed):
            rate = self.ACCEL
        else:
            rate = self.DECEL
        diff = target_speed - self.speed
        change = rate * dt
        self.speed += max(-change, min(change, diff))

        self.angular_vel = self._steering * self.MAX_ANGULAR

    def _autonomous_tick(self, dt: float):
        if not self.waypoints or self.waypoint_index >= len(self.waypoints):
            self.autonomous_mode = False
            self.stop_motion()
            return

        wp = self.waypoints[self.waypoint_index]
        dist = self._haversine(self.lat, self.lng, wp["lat"], wp["lng"])

        if dist < self.WAYPOINT_RADIUS:
            self.waypoint_index += 1
            if self.waypoint_index >= len(self.waypoints):
                self.autonomous_mode = False
                self.stop_motion()
            return

        bearing = self._bearing_to(wp["lat"], wp["lng"])
        heading_err = (bearing - self.heading + 360) % 360
        if heading_err > 180:
            heading_err -= 360

        self._steering = max(-1.0, min(1.0, heading_err / 45.0))
        self._throttle = 0.6 if abs(heading_err) < 30 else 0.3
        self._manual_tick(dt)

    def _integrate_position(self, dt: float):
        self.heading = (self.heading + self.angular_vel * dt) % 360
        rad = math.radians(self.heading)
        dist_m = self.speed * dt
        self.lat += (dist_m * math.cos(rad)) / 111320
        self.lng += (dist_m * math.sin(rad)) / (111320 * math.cos(math.radians(self.lat)))

    def _decelerate_to_zero(self, speed: float, dt: float) -> float:
        if abs(speed) <= self.DECEL * dt:
            return 0.0
        return speed - math.copysign(self.DECEL * dt, speed)

    # ------------------------------------------------------------------
    def _haversine(self, lat1, lng1, lat2, lng2) -> float:
        radius_m = 6371000
        phi1, phi2 = math.radians(lat1), math.radians(lat2)
        d_phi = math.radians(lat2 - lat1)
        d_lambda = math.radians(lng2 - lng1)
        a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
        return radius_m * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    def _bearing_to(self, lat2, lng2) -> float:
        lat1, lng1 = math.radians(self.lat), math.radians(self.lng)
        lat2, lng2 = math.radians(lat2), math.radians(lng2)
        d_lambda = lng2 - lng1
        x = math.sin(d_lambda) * math.cos(lat2)
        y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(d_lambda)
        return (math.degrees(math.atan2(x, y)) + 360) % 360

    # ------------------------------------------------------------------
    def get_state(self) -> dict:
        self.tick()
        return {
            "lat": round(self.lat, 7),
            "lng": round(self.lng, 7),
            "heading": round(self.heading, 1),
            "speed": round(self.speed, 2),
            "angular_vel": round(self.angular_vel, 1),
            "throttle": round(self._throttle, 2),
            "steering": round(self._steering, 2),
            "autonomous": self.autonomous_mode,
            "estop": self._estop,
            "command_stale": self._command_stale,
            "command_age_ms": round((time.monotonic() - self._last_manual_command) * 1000),
            "waypoint_index": self.waypoint_index,
            "waypoint_count": len(self.waypoints),
        }
