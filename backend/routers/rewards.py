from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
import database

router = APIRouter(prefix="/api", tags=["Rewards & Admin"])

# Passwort-Konfiguration (wird temporär im RAM gehalten, optional in DB erweiterbar)
class PasswordContainer:
    current_password = "Chef"

class RewardCreate(BaseModel):
    title: str
    point_cost: int
    type: str = Field(..., pattern="^(snack|extra_time|cash)$")

class RewardUpdate(BaseModel):
    title: str
    point_cost: int
    type: str = Field(..., pattern="^(snack|extra_time|cash)$")

class RewardClaim(BaseModel):
    user_id: int
    reward_id: int

class PasswordVerify(BaseModel):
    password: str

class PasswordChange(BaseModel):
    old_password: str
    new_password: str

@router.get("/rewards")
def get_rewards():
    conn = database.get_db_connection()
    rewards = conn.execute("SELECT * FROM rewards").fetchall()
    conn.close()
    return [dict(r) for r in rewards]

@router.post("/rewards")
def create_reward(payload: RewardCreate):
    conn = database.get_db_connection()
    cursor = conn.cursor()
    cursor.execute("INSERT INTO rewards (title, point_cost, type) VALUES (?, ?, ?)", (payload.title, payload.point_cost, payload.type))
    conn.commit()
    new_id = cursor.lastrowid
    conn.close()
    return {"status": "success", "reward_id": new_id}

@router.put("/rewards/{reward_id}")
def update_reward(reward_id: int, payload: RewardUpdate):
    conn = database.get_db_connection()
    conn.execute("UPDATE rewards SET title = ?, point_cost = ?, type = ? WHERE id = ?", (payload.title, payload.point_cost, payload.type, reward_id))
    conn.commit()
    conn.close()
    return {"status": "success"}

@router.delete("/rewards/{reward_id}")
def delete_reward(reward_id: int):
    conn = database.get_db_connection()
    conn.execute("DELETE FROM rewards WHERE id = ?", (reward_id,))
    conn.commit()
    conn.close()
    return {"status": "success"}

@router.post("/rewards/claim")
def claim_reward(payload: RewardClaim):
    conn = database.get_db_connection()
    user = conn.execute("SELECT * FROM users WHERE id = ?", (payload.user_id,)).fetchone()
    reward = conn.execute("SELECT * FROM rewards WHERE id = ?", (payload.reward_id,)).fetchone()
    
    if not user or not reward:
        conn.close()
        raise HTTPException(status_code=404, detail="Objekt fehlt.")
    if user["current_points"] < reward["point_cost"]:
        conn.close()
        raise HTTPException(status_code=400, detail="Mangelnde Sterne!")
        
    new_points = user["current_points"] - reward["point_cost"]
    conn.execute("UPDATE users SET current_points = ? WHERE id = ?", (new_points, payload.user_id))
    conn.commit()
    conn.close()
    return {"status": "success", "remaining_points": new_points}

@router.post("/admin/verify")
def verify_password(payload: PasswordVerify):
    if payload.password != PasswordContainer.current_password:
        raise HTTPException(status_code=401, detail="Falsches Passwort!")
    return {"status": "authorized"}

@router.post("/admin/change-password")
def change_password(payload: PasswordChange):
    if payload.old_password != PasswordContainer.current_password:
        raise HTTPException(status_code=401, detail="Altes Passwort stimmt nicht!")
    PasswordContainer.current_password = payload.new_password
    return {"status": "success"}
