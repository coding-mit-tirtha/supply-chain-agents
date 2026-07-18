from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from db import get_client
from agents.crew import run_agents

app = FastAPI(title="Supply Chain Agents API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://supply-chain-agents-three.vercel.app"], 
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/run-agents")
def trigger_agents():
    try:
        return run_agents()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/recommendations")
def get_recommendations(limit: int = 100):
    db = get_client()
    resp = (
        db.table("agent_recommendations")
        .select("*")
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return resp.data