import math
import time


class UGVSimulator:
    def __init__(self):
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
        self.MAX_SPEED = 2.0       # m/s
        self.MAX_ANGULAR = 90.0    # deg/s
        self.ACCEL = 1.5           # m/s²
        self.DECEL = 3.0           # m/s²

        # Waypoint navigation
        self.waypoints: list[dict] = []
        self.waypoint_index = 0
        self.autonomous_mode = False
        self.WAYPOINT_RADIUS = 3.0  # meters to consider "reached"

        # Emergency stop
        self._estop = False

        self._last_tick = time.time()

    # ------------------------------------------------------------------
    def apply_command(self, cmd: dict):
        if cmd.get("release_estop"):
            self._estop = False
        if self._estop:
            return
        self._throttle = max(-1.0, min(1.0, cmd.get("throttle", self._throttle)))
        self._steering = max(-1.0, min(1.0, cmd.get("steering", self._steering)))

    def emergency_stop(self):
        self._estop = True
        self._throttle = 0.0
        self._steering = 0.0
        self.speed = 0.0
        self.angular_vel = 0.0

    def add_waypoint(self, lat: float, lng: float):
        self.waypoints.append({"lat": lat, "lng": lng})

    # ------------------------------------------------------------------
    def tick(self):
        now = time.time()
        dt = min(now - self._last_tick, 0.1)
        self._last_tick = now

        if self._estop:
            self.speed = max(0.0, self.speed - self.DECEL * dt)
            return

        if self.autonomous_mode and self.waypoints:
            self._autonomous_tick(dt)
        else:
            self._manual_tick(dt)

        self._integrate_position(dt)

    def _manual_tick(self, dt: float):
        target_speed = self._throttle * self.MAX_SPEED
        if abs(target_speed) > abs(self.speed):
            rate = self.ACCEL
        else:
            rate = self.DECEL
        diff = target_speed - self.speed
        change = rate * dt
        self.speed += max(-change, min(change, diff))

        target_angular = self._steering * self.MAX_ANGULAR
        self.angular_vel = target_angular

    def _autonomous_tick(self, dt: float):
        if not self.waypoints or self.waypoint_index >= len(self.waypoints):
            self.autonomous_mode = False
            self._throttle = 0.0
            self._steering = 0.0
            self.speed = max(0.0, self.speed - self.DECEL * 0.05)
            return

        wp = self.waypoints[self.waypoint_index]
        dist = self._haversine(self.lat, self.lng, wp["lat"], wp["lng"])

        if dist < self.WAYPOINT_RADIUS:
            self.waypoint_index += 1
            return

        bearing = self._bearing_to(wp["lat"], wp["lng"])
        heading_err = (bearing - self.heading + 360) % 360
        if heading_err > 180:
            heading_err -= 360

        # Proportional steering
        self._steering = max(-1.0, min(1.0, heading_err / 45.0))
        self._throttle = 0.6 if abs(heading_err) < 30 else 0.3
        self._manual_tick(dt)

    def _integrate_position(self, dt: float):
        self.heading = (self.heading + self.angular_vel * dt) % 360
        rad = math.radians(self.heading)
        dist_m = self.speed * dt
        # Convert meters to lat/lng delta (approx)
        self.lat += (dist_m * math.cos(rad)) / 111320
        self.lng += (dist_m * math.sin(rad)) / (111320 * math.cos(math.radians(self.lat)))

    # ------------------------------------------------------------------
    def _haversine(self, lat1, lng1, lat2, lng2) -> float:
        R = 6371000
        φ1, φ2 = math.radians(lat1), math.radians(lat2)
        dφ = math.radians(lat2 - lat1)
        dλ = math.radians(lng2 - lng1)
        a = math.sin(dφ/2)**2 + math.cos(φ1)*math.cos(φ2)*math.sin(dλ/2)**2
        return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

    def _bearing_to(self, lat2, lng2) -> float:
        lat1, lng1 = math.radians(self.lat), math.radians(self.lng)
        lat2, lng2 = math.radians(lat2), math.radians(lng2)
        dλ = lng2 - lng1
        x = math.sin(dλ) * math.cos(lat2)
        y = math.cos(lat1)*math.sin(lat2) - math.sin(lat1)*math.cos(lat2)*math.cos(dλ)
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
            "waypoint_index": self.waypoint_index,
            "waypoint_count": len(self.waypoints),
        }
