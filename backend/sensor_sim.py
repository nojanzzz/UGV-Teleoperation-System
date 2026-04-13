import math
import random
import time
import json
import os

BATTERY_FILE = os.path.join(os.path.dirname(__file__), "battery_state.json")


def _load_battery() -> float:
    try:
        with open(BATTERY_FILE) as f:
            data = json.load(f)
            val = float(data.get("battery", 100.0))
            return max(0.0, min(100.0, val))
    except Exception:
        return 100.0


def _save_battery(val: float):
    try:
        with open(BATTERY_FILE, "w") as f:
            json.dump({"battery": round(val, 2)}, f)
    except Exception:
        pass


class SensorSimulator:
    def __init__(self, ugv):
        self.ugv = ugv
        self._battery = _load_battery()
        self._battery_drain_rate = 0.002   # % per tick
        self._start_time = time.time()
        self._last_save = time.time()

        # IMU bias drift (simulates real sensor imperfection)
        self._gyro_bias = random.uniform(-0.2, 0.2)
        self._accel_bias = [random.uniform(-0.05, 0.05) for _ in range(3)]

        self._last_tick = time.time()
        self._low_battery_warned = self._battery < 20

    def _tick(self):
        now = time.time()
        dt = now - self._last_tick
        self._last_tick = now

        # Battery drains faster under load
        load = abs(self.ugv._throttle)
        self._battery = max(0.0, self._battery - self._battery_drain_rate * (1 + load * 3) * dt * 10)

        # Auto recharge at 0%
        if self._battery <= 0.0:
            print("[INFO] Battery empty, auto-recharging to 100%...")
            self.recharge(100.0)
            self._low_battery_warned = False

        # Save battery to file every 10 seconds
        if now - self._last_save > 10:
            _save_battery(self._battery)
            self._last_save = now

    def recharge(self, percent: float = 100.0):
        self._battery = max(0.0, min(100.0, percent))
        _save_battery(self._battery)

    def _noise(self, scale=1.0) -> float:
        return random.gauss(0, scale)

    def get_readings(self) -> dict:
        self._tick()
        ugv = self.ugv
        speed = ugv.speed

        # IMU - accelerometer (m/s²)
        accel_x = speed * math.cos(math.radians(ugv.heading)) + self._accel_bias[0] + self._noise(0.02)
        accel_y = speed * math.sin(math.radians(ugv.heading)) + self._accel_bias[1] + self._noise(0.02)
        accel_z = 9.81 + self._accel_bias[2] + self._noise(0.01)

        # IMU - gyroscope (deg/s)
        gyro_z = ugv.angular_vel + self._gyro_bias + self._noise(0.1)

        # GPS with realistic CEP noise (~1.5m)
        gps_noise = 0.000013
        gps_lat = ugv.lat + self._noise(gps_noise)
        gps_lng = ugv.lng + self._noise(gps_noise)
        gps_fix = random.random() > 0.01

        # Ultrasonic distance sensor (front obstacle)
        obstacle_dist = 200.0 + self._noise(2.0)

        # CPU temperature
        cpu_temp = 45.0 + abs(speed) * 5 + self._noise(0.5)

        # Uptime
        uptime = int(time.time() - self._start_time)

        return {
            "imu": {
                "accel": {
                    "x": round(accel_x, 3),
                    "y": round(accel_y, 3),
                    "z": round(accel_z, 3),
                },
                "gyro": {"z": round(gyro_z, 2)},
                "heading": round(ugv.heading, 1),
            },
            "gps": {
                "lat": round(gps_lat, 7),
                "lng": round(gps_lng, 7),
                "fix": gps_fix,
                "satellites": random.randint(7, 12) if gps_fix else 0,
            },
            "battery": {
                "percent": round(self._battery, 1),
                "voltage": round(11.1 + (self._battery / 100) * 1.5, 2),
                "current": round(1.2 + abs(ugv._throttle) * 8 + self._noise(0.1), 2),
            },
            "ultrasonic": {
                "front_cm": round(max(5.0, obstacle_dist), 1),
            },
            "system": {
                "cpu_temp": round(cpu_temp, 1),
                "uptime_s": uptime,
            },
        }
