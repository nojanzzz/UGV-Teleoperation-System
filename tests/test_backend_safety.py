import os
import sys
import time
import unittest


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BACKEND = os.path.join(ROOT, "backend")
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

from simulator import UGVSimulator


class UGVSimulatorSafetyTests(unittest.TestCase):
    def test_deadman_stops_stale_manual_commands(self):
        ugv = UGVSimulator(command_timeout_s=0.01)
        ugv.apply_command(throttle=1.0, steering=0.5)

        time.sleep(0.02)
        state = ugv.get_state()

        self.assertEqual(state["throttle"], 0.0)
        self.assertEqual(state["steering"], 0.0)
        self.assertTrue(state["command_stale"])

    def test_estop_blocks_commands_until_dedicated_release(self):
        ugv = UGVSimulator()
        ugv.emergency_stop()
        ugv.apply_command(throttle=1.0, steering=1.0)

        stopped = ugv.get_state()
        self.assertTrue(stopped["estop"])
        self.assertEqual(stopped["throttle"], 0.0)
        self.assertEqual(stopped["steering"], 0.0)

        ugv.release_estop()
        ugv.apply_command(throttle=0.5, steering=-0.5)
        released = ugv.get_state()

        self.assertFalse(released["estop"])
        self.assertEqual(released["throttle"], 0.5)
        self.assertEqual(released["steering"], -0.5)

    def test_waypoint_delete_keeps_active_index_consistent(self):
        ugv = UGVSimulator()
        ugv.add_waypoint(-6.58, 106.80)
        ugv.add_waypoint(-6.59, 106.81)
        ugv.waypoint_index = 1

        ugv.delete_waypoint(0)

        self.assertEqual(len(ugv.waypoints), 1)
        self.assertEqual(ugv.waypoint_index, 0)


if __name__ == "__main__":
    unittest.main()
