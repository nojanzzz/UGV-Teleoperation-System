import asyncio
import json
import time
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse, FileResponse
import uvicorn
import os

from simulator import UGVSimulator
from sensor_sim import SensorSimulator
from video_sim import VideoSimulator

app = FastAPI(title="UGV Teleoperation API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

ugv = UGVSimulator()
sensors = SensorSimulator(ugv)
video = VideoSimulator(ugv)

connected_clients: list[WebSocket] = []

FRONTEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))


@app.get("/api/status")
async def get_status():
    return {"state": ugv.get_state(), "sensors": sensors.get_readings(), "timestamp": time.time()}


@app.get("/api/waypoints")
async def get_waypoints():
    return {"waypoints": ugv.waypoints, "current_index": ugv.waypoint_index}


@app.post("/api/waypoints/clear")
async def clear_waypoints():
    ugv.waypoints.clear()
    ugv.waypoint_index = 0
    ugv.autonomous_mode = False
    return {"ok": True}


@app.delete("/api/waypoints/{index}")
async def delete_waypoint(index: int):
    if index < 0 or index >= len(ugv.waypoints):
        return {"ok": False, "error": "index out of range"}
    ugv.waypoints.pop(index)
    # Adjust current waypoint index so navigation doesnt skip or go out of bounds
    if ugv.waypoint_index > index:
        ugv.waypoint_index = max(0, ugv.waypoint_index - 1)
    if ugv.waypoint_index >= len(ugv.waypoints):
        ugv.waypoint_index = max(0, len(ugv.waypoints) - 1)
    # Stop UGV if no waypoints remain
    if len(ugv.waypoints) == 0:
        ugv.autonomous_mode = False
        ugv._throttle = 0.0
        ugv._steering = 0.0
        ugv.speed = 0.0
        ugv.waypoint_index = 0
    return {"ok": True, "remaining": len(ugv.waypoints)}


@app.post("/api/battery/recharge")
async def recharge_battery():
    sensors.recharge(100.0)
    return {"ok": True, "battery": 100.0}


@app.get("/video/stream")
async def video_stream():
    return StreamingResponse(
        video.generate_frames(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={"Cache-Control": "no-cache"},
    )


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    connected_clients.append(ws)
    sender_task = None
    try:
        async def sender():
            while True:
                payload = {
                    "type": "telemetry",
                    "state": ugv.get_state(),
                    "sensors": sensors.get_readings(),
                    "ts": time.time(),
                }
                await ws.send_text(json.dumps(payload))
                await asyncio.sleep(0.05)

        sender_task = asyncio.create_task(sender())
        while True:
            raw = await ws.receive_text()
            msg = json.loads(raw)
            await handle_message(msg)
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        if ws in connected_clients:
            connected_clients.remove(ws)
        if sender_task:
            sender_task.cancel()


async def handle_message(msg: dict):
    t = msg.get("type")
    if t == "command":
        ugv.apply_command(msg.get("cmd", {}))
    elif t == "waypoint_add":
        ugv.add_waypoint(msg.get("lat"), msg.get("lng"))
    elif t == "autonomous":
        ugv.autonomous_mode = msg.get("enabled", False)
    elif t == "estop":
        ugv.emergency_stop()


# IMPORTANT: mount frontend LAST, after all API/WS routes
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")


if __name__ == "__main__":
    print(f"Frontend: {FRONTEND_DIR}")
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
