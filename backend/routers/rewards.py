from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
import database
from security import AccountContext, require_authenticated, require_roles

router = APIRouter(prefix="/api", tags=["Rewards & Admin"])

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

@router.get("/rewards")
def get_rewards():
    conn = database.get_db_connection()
    rewards = conn.execute("SELECT * FROM rewards").fetchall()
    conn.close()
    return [dict(r) for r in rewards]

@router.post(
    "/rewards",
    dependencies=[Depends(require_roles("admin", "adult"))],
)
def create_reward(payload: RewardCreate):
    conn = database.get_db_connection()
    cursor = conn.cursor()
    cursor.execute("INSERT INTO rewards (title, point_cost, type) VALUES (?, ?, ?)", (payload.title, payload.point_cost, payload.type))
    conn.commit()
    new_id = cursor.lastrowid
    conn.close()
    return {"status": "success", "reward_id": new_id}

@router.put(
    "/rewards/{reward_id}",
    dependencies=[Depends(require_roles("admin", "adult"))],
)
def update_reward(reward_id: int, payload: RewardUpdate):
    conn = database.get_db_connection()
    conn.execute("UPDATE rewards SET title = ?, point_cost = ?, type = ? WHERE id = ?", (payload.title, payload.point_cost, payload.type, reward_id))
    conn.commit()
    conn.close()
    return {"status": "success"}

@router.delete(
    "/rewards/{reward_id}",
    dependencies=[Depends(require_roles("admin", "adult"))],
)
def delete_reward(reward_id: int):
    conn = database.get_db_connection()
    conn.execute("DELETE FROM rewards WHERE id = ?", (reward_id,))
    conn.commit()
    conn.close()
    return {"status": "success"}

@router.post("/rewards/claim")
def claim_reward(
    payload: RewardClaim,
    actor: AccountContext = Depends(require_authenticated),
):
    if actor.role == "guest" or (
        actor.role in {"teen", "child"} and actor.profile_id != payload.user_id
    ):
        raise HTTPException(status_code=403, detail="Du kannst nur eigene Belohnungen einlösen.")
    conn = database.get_db_connection()
    try:
        conn.execute("BEGIN IMMEDIATE")
        user = conn.execute(
            "SELECT current_points FROM users WHERE id = ? AND is_active = 1",
            (payload.user_id,),
        ).fetchone()
        reward = conn.execute(
            "SELECT point_cost FROM rewards WHERE id = ?",
            (payload.reward_id,),
        ).fetchone()

        if not user or not reward:
            raise HTTPException(status_code=404, detail="Objekt fehlt.")
        if user["current_points"] < reward["point_cost"]:
            raise HTTPException(status_code=400, detail="Mangelnde Sterne!")

        new_points = user["current_points"] - reward["point_cost"]
        conn.execute(
            "UPDATE users SET current_points = ? WHERE id = ?",
            (new_points, payload.user_id),
        )
        conn.commit()
        return {"status": "success", "remaining_points": new_points}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
