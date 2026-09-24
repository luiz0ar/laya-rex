import os
import asyncio
import torch
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from laya import Router

cpu_threads = min(4, os.cpu_count() or 4)
torch.set_num_threads(cpu_threads)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

router = Router()

@app.get("/ok")
def health():
    return {"status": "ok"}

class GameState(BaseModel):
    obstacle_distance: float
    obstacle_type: str
    obstacle_y: float
    speed: float

QUESTIONS = {
    "action": {
        "type": "choice",
        "instructions": "Determine the optimal immediate action for the dinosaur to avoid the obstacle.",
        "criteria": {
            "jump": "ground obstacle, cactus, or low flying bird within jump range",
            "duck": "flying pterodactyl at head height where jumping causes a hit",
            "run": "obstacle is still far away or no immediate collision risk"
        }
    }
}

@app.on_event("startup")
def startup_event():
    router.predict("warmup", QUESTIONS, model="english")

def format_state(data: dict) -> dict:
    obstacle_y = data.get("obstacle_y", 100)
    obstacle_dist = data.get("obstacle_distance", 0)
    speed = data.get("speed", 6)
    obs_type = data.get("obstacle_type", "CACTUS")

    return {
        "obstacle": obs_type,
        "distance_pixels": round(obstacle_dist, 1),
        "height_level": "flying_high" if obstacle_y < 50 else ("flying_mid" if obstacle_y < 80 else "ground"),
        "game_speed": round(speed, 1),
        "summary": f"Obstacle {obs_type} at distance {obstacle_dist:.0f}px approaching at speed {speed:.1f}"
    }

@app.post("/decide")
def decide(state: GameState):
    state_payload = format_state(state.dict())
    result = router.predict(state_payload, QUESTIONS, model="english")
    return {
        "action": result["answers"]["action"]["choice"],
        "confidence": result["answers"]["action"]["confidence"],
        "model_received": state_payload
    }

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    loop = asyncio.get_running_loop()
    try:
        while True:
            data = await websocket.receive_json()
            state_payload = format_state(data)
            
            result = await loop.run_in_executor(
                None, lambda: router.predict(state_payload, QUESTIONS, model="english")
            )

            await websocket.send_json({
                "action": result["answers"]["action"]["choice"],
                "confidence": result["answers"]["action"]["confidence"],
                "model_received": state_payload
            })
    except WebSocketDisconnect:
        print("Client disconnected")
    except Exception as e:
        print(f"Client error: {e}")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
