import asyncio
import json
import logging
import os
import time
import uuid
from dataclasses import dataclass
from typing import Any, Dict, Optional

import uvicorn
from fastapi import FastAPI, Header, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ValidationError

from sensor_sim import SensorSimulator
from simulator import UGVSimulator
from video_sim import VideoSimulator


logger = logging.getLogger("ugv.teleoperation")
logging.basicConfig(
    level=os.environ.get("UGV_LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)


class Settings:
    def __init__(self):
        self.command_timeout_s = float(os.environ.get("UGV_COMMAND_TIMEOUT_S", "0.35"))
        self.estop_release_cooldown_s = float(os.environ.get("UGV_ESTOP_RELEASE_COOLDOWN_S", "1.0"))
        self.telemetry_hz = float(os.environ.get("UGV_TELEMETRY_HZ", "20"))
        self.allow_all_origins = os.environ.get("UGV_ALLOW_ALL_ORIGINS", "0") == "1"
        origins = os.environ.get(
            "UGV_ALLOWED_ORIGINS",
            "http://localhost:8000,http://127.0.0.1:8000,"
            "http://localhost:8001,http://127.0.0.1:8001,"
            "http://localhost:8002,http://127.0.0.1:8002",
        )
        self.allowed_origins = ["*"] if self.allow_all_origins else [o.strip() for o in origins.split(",") if o.strip()]


settings = Settings()

app = FastAPI(title="UGV Teleoperation API", version="1.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type", "X-Client-Id"],
)

ugv = UGVSimulator(command_timeout_s=settings.command_timeout_s)
sensors = SensorSimulator(ugv)
video = VideoSimulator(ugv)

FRONTEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))


class StrictModel(BaseModel):
    class Config:
        extra = "forbid"


class CommandPayload(StrictModel):
    throttle: float
    steering: float


class CommandMessage(StrictModel):
    type: str
    cmd: CommandPayload


class WaypointPayload(StrictModel):
    lat: float
    lng: float


class WaypointMessage(StrictModel):
    type: str
    lat: float
    lng: float


class AutonomousMessage(StrictModel):
    type: str
    enabled: bool


class ClaimControlMessage(StrictModel):
    type: str


@dataclass
class ClientSession:
    id: str
    websocket: WebSocket
    role: str
    connected_at: float


clients: Dict[str, ClientSession] = {}
controller_id: Optional[str] = None
last_estop_at: Optional[float] = None


def is_valid_waypoint(lat: float, lng: float) -> bool:
    return -90 <= lat <= 90 and -180 <= lng <= 180


def is_unit_input(value: float) -> bool:
    return -1.0 <= value <= 1.0


def is_controller(client_id: Optional[str]) -> bool:
    return bool(client_id and client_id == controller_id and client_id in clients)


def controller_error():
    return JSONResponse(
        status_code=403,
        content={"ok": False, "error": "controller role required", "controller_id": controller_id},
    )


def require_controller(client_id: Optional[str]):
    if clients and not is_controller(client_id):
        return controller_error()
    return None


def assign_initial_role(client_id: str) -> str:
    global controller_id
    if controller_id is None:
        controller_id = client_id
        return "controller"
    return "observer"


async def send_session(ws: WebSocket, session: ClientSession):
    await ws.send_text(json.dumps({
        "type": "session",
        "client_id": session.id,
        "role": session.role,
        "controller_id": controller_id,
    }))


async def send_event(ws: WebSocket, event: str, **fields: Any):
    payload = {"type": "event", "event": event, **fields}
    await ws.send_text(json.dumps(payload))


def validation_error(error: ValidationError) -> str:
    first = error.errors()[0] if error.errors() else {}
    loc = ".".join(str(p) for p in first.get("loc", []))
    msg = first.get("msg", "invalid payload")
    return f"{loc}: {msg}" if loc else msg


def vehicle_status() -> dict:
    return {
        "state": ugv.get_state(),
        "sensors": sensors.get_readings(),
        "timestamp": time.time(),
        "safety": {
            "command_timeout_s": settings.command_timeout_s,
            "estop_release_cooldown_s": settings.estop_release_cooldown_s,
        },
        "control": {
            "controller_id": controller_id,
            "client_count": len(clients),
        },
    }


@app.get("/api/status")
async def get_status():
    return vehicle_status()


@app.get("/api/waypoints")
async def get_waypoints():
    return {"waypoints": ugv.waypoints, "current_index": ugv.waypoint_index}


@app.post("/api/waypoints/clear")
async def clear_waypoints(x_client_id: Optional[str] = Header(default=None)):
    err = require_controller(x_client_id)
    if err:
        return err
    ugv.clear_waypoints()
    logger.info("waypoints cleared client_id=%s", x_client_id or "api")
    return {"ok": True}


@app.delete("/api/waypoints/{index}")
async def delete_waypoint(index: int, x_client_id: Optional[str] = Header(default=None)):
    err = require_controller(x_client_id)
    if err:
        return err
    if index < 0 or index >= len(ugv.waypoints):
        return JSONResponse(status_code=400, content={"ok": False, "error": "index out of range"})
    ugv.delete_waypoint(index)
    logger.info("waypoint deleted index=%s client_id=%s", index, x_client_id or "api")
    return {"ok": True, "remaining": len(ugv.waypoints)}


@app.put("/api/waypoints/{index}")
async def update_waypoint(index: int, waypoint: WaypointPayload, x_client_id: Optional[str] = Header(default=None)):
    err = require_controller(x_client_id)
    if err:
        return err
    if index < 0 or index >= len(ugv.waypoints):
        return JSONResponse(status_code=400, content={"ok": False, "error": "index out of range"})
    if not is_valid_waypoint(waypoint.lat, waypoint.lng):
        return JSONResponse(status_code=400, content={"ok": False, "error": "invalid coordinates"})
    ugv.update_waypoint(index, waypoint.lat, waypoint.lng)
    logger.info("waypoint updated index=%s lat=%s lng=%s client_id=%s", index, waypoint.lat, waypoint.lng, x_client_id or "api")
    return {"ok": True, "waypoint": ugv.waypoints[index]}


@app.post("/api/battery/recharge")
async def recharge_battery(x_client_id: Optional[str] = Header(default=None)):
    err = require_controller(x_client_id)
    if err:
        return err
    sensors.recharge(100.0)
    logger.info("battery recharged client_id=%s", x_client_id or "api")
    return {"ok": True, "battery": 100.0}


@app.post("/api/estop")
async def api_estop():
    global last_estop_at
    ugv.emergency_stop()
    last_estop_at = time.monotonic()
    logger.warning("emergency stop activated source=api")
    return {"ok": True, "estop": True}


@app.post("/api/estop/release")
async def api_release_estop(x_client_id: Optional[str] = Header(default=None)):
    err = require_controller(x_client_id)
    if err:
        return err
    result = release_estop_if_allowed(x_client_id or "api")
    status = 200 if result["ok"] else 423
    return JSONResponse(status_code=status, content=result)


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
    client_id = uuid.uuid4().hex[:12]
    role = assign_initial_role(client_id)
    session = ClientSession(id=client_id, websocket=ws, role=role, connected_at=time.time())
    clients[client_id] = session
    logger.info("client connected client_id=%s role=%s count=%s", client_id, role, len(clients))

    sender_task = None
    try:
        await send_session(ws, session)

        async def sender():
            while True:
                payload = {
                    "type": "telemetry",
                    "state": ugv.get_state(),
                    "sensors": sensors.get_readings(),
                    "ts": time.time(),
                    "session": {
                        "client_id": session.id,
                        "role": session.role,
                        "controller_id": controller_id,
                    },
                }
                await ws.send_text(json.dumps(payload))
                await asyncio.sleep(1 / settings.telemetry_hz)

        sender_task = asyncio.create_task(sender())
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await send_event(ws, "invalid_message", ok=False, error="malformed json")
                logger.warning("malformed json from client_id=%s", client_id)
                continue
            await handle_message(msg, session)
    except WebSocketDisconnect:
        logger.info("client disconnected client_id=%s", client_id)
    except Exception:
        logger.exception("websocket error client_id=%s", client_id)
    finally:
        await remove_client(session)
        if sender_task:
            sender_task.cancel()


async def remove_client(session: ClientSession):
    global controller_id
    clients.pop(session.id, None)
    if controller_id == session.id:
        controller_id = None
        ugv.autonomous_mode = False
        ugv.stop_motion()
        logger.warning("controller disconnected; vehicle stopped client_id=%s", session.id)


async def handle_message(msg: Any, session: ClientSession):
    if not isinstance(msg, dict):
        await send_event(session.websocket, "invalid_message", ok=False, error="message must be an object")
        return

    msg_type = msg.get("type")
    if msg_type == "claim_control":
        await handle_claim_control(session)
    elif msg_type == "release_control":
        await handle_release_control(session)
    elif msg_type == "command":
        await handle_command(msg, session)
    elif msg_type == "waypoint_add":
        await handle_waypoint_add(msg, session)
    elif msg_type == "autonomous":
        await handle_autonomous(msg, session)
    elif msg_type == "estop":
        await handle_estop(session)
    elif msg_type == "estop_release":
        await handle_estop_release(session)
    else:
        await send_event(session.websocket, "invalid_message", ok=False, error=f"unknown message type: {msg_type}")
        logger.warning("unknown message type client_id=%s type=%s", session.id, msg_type)


async def handle_claim_control(session: ClientSession):
    global controller_id
    if controller_id is None or controller_id == session.id:
        controller_id = session.id
        session.role = "controller"
        await send_session(session.websocket, session)
        logger.info("control claimed client_id=%s", session.id)
    else:
        await send_event(session.websocket, "control_denied", ok=False, controller_id=controller_id)


async def handle_release_control(session: ClientSession):
    global controller_id
    if controller_id == session.id:
        controller_id = None
        session.role = "observer"
        ugv.autonomous_mode = False
        ugv.stop_motion()
        await send_session(session.websocket, session)
        logger.info("control released client_id=%s", session.id)


def require_ws_controller(session: ClientSession) -> bool:
    return session.id == controller_id and session.role == "controller"


async def handle_command(msg: Dict[str, Any], session: ClientSession):
    if not require_ws_controller(session):
        await send_event(session.websocket, "control_denied", ok=False, controller_id=controller_id)
        return
    try:
        payload = CommandMessage(**msg).cmd
    except ValidationError as err:
        await send_event(session.websocket, "invalid_command", ok=False, error=validation_error(err))
        logger.warning("invalid command schema client_id=%s error=%s", session.id, validation_error(err))
        return
    if not is_unit_input(payload.throttle) or not is_unit_input(payload.steering):
        await send_event(session.websocket, "invalid_command", ok=False, error="throttle and steering must be between -1 and 1")
        logger.warning("invalid command range client_id=%s throttle=%s steering=%s", session.id, payload.throttle, payload.steering)
        return
    ugv.apply_command(payload.throttle, payload.steering)


async def handle_waypoint_add(msg: Dict[str, Any], session: ClientSession):
    if not require_ws_controller(session):
        await send_event(session.websocket, "control_denied", ok=False, controller_id=controller_id)
        return
    try:
        payload = WaypointMessage(**msg)
    except ValidationError as err:
        await send_event(session.websocket, "invalid_waypoint", ok=False, error=validation_error(err))
        logger.warning("invalid waypoint schema client_id=%s error=%s", session.id, validation_error(err))
        return
    if not is_valid_waypoint(payload.lat, payload.lng):
        await send_event(session.websocket, "invalid_waypoint", ok=False, error="invalid coordinates")
        return
    ugv.add_waypoint(payload.lat, payload.lng)
    logger.info("waypoint added lat=%s lng=%s client_id=%s", payload.lat, payload.lng, session.id)


async def handle_autonomous(msg: Dict[str, Any], session: ClientSession):
    if not require_ws_controller(session):
        await send_event(session.websocket, "control_denied", ok=False, controller_id=controller_id)
        return
    try:
        payload = AutonomousMessage(**msg)
    except ValidationError as err:
        await send_event(session.websocket, "invalid_autonomous", ok=False, error=validation_error(err))
        return
    if payload.enabled and not ugv.waypoints:
        await send_event(session.websocket, "autonomous_denied", ok=False, error="no waypoints set")
        return
    ugv.autonomous_mode = payload.enabled
    if not payload.enabled:
        ugv.stop_motion()
    logger.info("autonomous mode=%s client_id=%s", payload.enabled, session.id)


async def handle_estop(session: ClientSession):
    global last_estop_at
    ugv.emergency_stop()
    last_estop_at = time.monotonic()
    await send_event(session.websocket, "estop", ok=True, estop=True)
    logger.warning("emergency stop activated client_id=%s role=%s", session.id, session.role)


async def handle_estop_release(session: ClientSession):
    if not require_ws_controller(session):
        await send_event(session.websocket, "control_denied", ok=False, controller_id=controller_id)
        return
    result = release_estop_if_allowed(session.id)
    await send_event(session.websocket, "estop_release", **result)


def release_estop_if_allowed(source: str) -> dict:
    now = time.monotonic()
    if last_estop_at is not None and now - last_estop_at < settings.estop_release_cooldown_s:
        remaining = settings.estop_release_cooldown_s - (now - last_estop_at)
        return {"ok": False, "estop": True, "error": "release cooldown active", "retry_after_s": round(remaining, 2)}
    ugv.release_estop()
    logger.warning("emergency stop released source=%s", source)
    return {"ok": True, "estop": False}


# IMPORTANT: mount frontend LAST, after all API/WS routes
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")


if __name__ == "__main__":
    print(f"Frontend: {FRONTEND_DIR}")
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
