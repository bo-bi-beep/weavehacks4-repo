from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from agent import chat, create_session, sessions
from config import HOST, PORT
from database import get_all_usernames, get_latest_decision, get_user, init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Loan Approval Agent", version="0.1.0", lifespan=lifespan)


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class NewSessionResponse(BaseModel):
    session_id: str


class MessageRequest(BaseModel):
    message: str


class MessageResponse(BaseModel):
    reply: str


class SessionState(BaseModel):
    session_id: str
    username: str | None
    decided: bool
    turn_count: int


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/users")
def list_users():
    """Return all usernames in the database."""
    return {"usernames": get_all_usernames()}


@app.get("/users/{username}/approval-status")
def user_approval_status(username: str):
    """Return the most recent approval decision for a user, or N/A if none exists."""
    if get_user(username) is None:
        raise HTTPException(status_code=404, detail=f"User '{username}' not found.")
    decision = get_latest_decision(username)
    if decision is None:
        return {"username": username, "status": "N/A"}
    return {
        "username": username,
        "status": "approved" if decision["approved"] else "denied",
        "score": decision["score"],
        "requested_amount": decision["requested_amount"],
        "timestamp": decision["timestamp"],
    }


@app.post("/sessions", response_model=NewSessionResponse, status_code=201)
def new_session():
    """Create a new loan application session."""
    return {"session_id": create_session()}


@app.post("/sessions/{session_id}/messages", response_model=MessageResponse)
def send_message(session_id: str, req: MessageRequest):
    """Send a user message and get the agent's reply."""
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found.")
    reply = chat(session_id, req.message)
    return {"reply": reply}


@app.get("/sessions/{session_id}", response_model=SessionState)
def get_session(session_id: str):
    """Inspect session state (for debugging)."""
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found.")
    s = sessions[session_id]
    # turn_count = messages minus the system prompt
    return {
        "session_id": session_id,
        "username": s["username"],
        "decided": s["decided"],
        "turn_count": len(s["messages"]) - 1,
    }


if __name__ == "__main__":
    import os
    reload = os.getenv("RELOAD", "true").lower() not in ("0", "false", "no")
    uvicorn.run("main:app", host=HOST, port=PORT, reload=reload)
