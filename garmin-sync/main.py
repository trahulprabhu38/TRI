"""
garmin-sync: logs into Garmin Connect (via the open-source `garminconnect`
library) and returns the user's metrics mapped to the dashboard's Bundle shape.
Day-level pulls run concurrently for speed. Only the Go backend talks to this.

Garmin has no public API. This uses email/password login (read-only) and stores
only the resulting OAuth session token per user — never the password.
"""

import os
import threading
import datetime as dt
from concurrent.futures import ThreadPoolExecutor
from typing import Optional, Dict, Any, List

from fastapi import FastAPI
from pydantic import BaseModel
from garminconnect import Garmin

app = FastAPI(title="garmin-sync")

TOKEN_DIR = os.getenv("TOKEN_DIR", "/tokens")
MAX_WORKERS = int(os.getenv("SYNC_WORKERS", "6"))
os.makedirs(TOKEN_DIR, exist_ok=True)

_pending: Dict[str, Any] = {}       # clients awaiting an MFA code
_tl = threading.local()             # per-thread Garmin client for concurrent pulls


def token_path(uid: str) -> str:
    safe_id = "".join(c for c in uid if c.isalnum() or c in "-_")
    return os.path.join(TOKEN_DIR, safe_id)


def resume(uid: str) -> Optional[Garmin]:
    path = token_path(uid)
    if not os.path.isdir(path):
        return None
    try:
        g = Garmin()
        g.login(path)
        return g
    except Exception:
        return None


def _client(tokenstore: str) -> Garmin:
    """A Garmin client bound to the current thread (built once per worker)."""
    c = getattr(_tl, "g", None)
    if c is None:
        c = Garmin()
        c.login(tokenstore)
        _tl.g = c
    return c


# ---------- request models ----------

class LoginReq(BaseModel):
    id: str
    email: str
    password: str


class MfaReq(BaseModel):
    id: str
    code: str


class TokenReq(BaseModel):
    id: str
    token: str


class SyncReq(BaseModel):
    id: str
    days: int = 28


# ---------- endpoints ----------

@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/status")
def status(id: str):
    return {"connected": resume(id) is not None}


@app.post("/login")
def login(req: LoginReq):
    try:
        try:
            g = Garmin(email=req.email, password=req.password, return_on_mfa=True)
            result = g.login()
            if isinstance(result, tuple) and result and result[0] == "needs_mfa":
                _pending[req.id] = (g, result[1])
                return {"status": "mfa_required"}
            g.client.dump(token_path(req.id))
            return {"status": "ok"}
        except TypeError:
            pass

        g = Garmin(req.email, req.password)
        try:
            result = g.login(return_on_mfa=True)
            if isinstance(result, tuple) and result and result[0] == "needs_mfa":
                _pending[req.id] = (g, result[1])
                return {"status": "mfa_required"}
        except TypeError:
            g.login()
        g.client.dump(token_path(req.id))
        return {"status": "ok"}
    except Exception as e:
        return {"status": "error", "error": str(e)}


@app.post("/login/mfa")
def login_mfa(req: MfaReq):
    entry = _pending.get(req.id)
    if not entry:
        return {"status": "error", "error": "no pending MFA login; start over"}
    g, client_state = entry
    try:
        g.resume_login(client_state, req.code)
        g.client.dump(token_path(req.id))
        _pending.pop(req.id, None)
        return {"status": "ok"}
    except Exception as e:
        return {"status": "error", "error": str(e)}


@app.post("/login/token")
def login_token(req: TokenReq):
    try:
        g = Garmin()
        g.login(req.token.strip())
        g.client.dump(token_path(req.id))
        return {"status": "ok"}
    except Exception as e:
        return {"status": "error", "error": str(e)}


@app.post("/sync")
def sync(req: SyncReq):
    if resume(req.id) is None:
        return {"status": "not_connected"}
    try:
        bundle = build_bundle(token_path(req.id), req.days)
        counts = {k: len(v) for k, v in bundle.items() if isinstance(v, list)}
        return {"status": "ok", "bundle": bundle, "counts": counts}
    except Exception as e:
        return {"status": "error", "error": str(e)}


# ---------- data mapping (Garmin API -> Bundle shape) ----------

def fetch_day(tokenstore: str, d: dt.date) -> Dict[str, Any]:
    """Pull one day of metrics using this thread's client."""
    g = _client(tokenstore)
    ds = d.isoformat()
    out: Dict[str, Any] = {"date": ds}

    stats = safe(lambda: g.get_stats(ds)) or {}
    out["daily"] = {
        "date": ds,
        "steps": num(stats, "totalSteps"),
        "stepGoal": num(stats, "dailyStepGoal"),
        "totalCalories": num(stats, "totalKilocalories"),
        "activeCalories": num(stats, "activeKilocalories"),
        "distanceMeters": num(stats, "totalDistanceMeters"),
        "restingHr": num(stats, "restingHeartRate"),
        "minHr": num(stats, "minHeartRate"),
        "maxHr": num(stats, "maxHeartRate"),
        "intensityMinutes": num(stats, "moderateIntensityMinutes") + num(stats, "vigorousIntensityMinutes"),
        "bodyBatteryHigh": num(stats, "bodyBatteryHighestValue"),
        "bodyBatteryLow": num(stats, "bodyBatteryLowestValue"),
        "avgStress": num(stats, "averageStressLevel"),
        "avgRespiration": num(stats, "avgWakingRespirationValue"),
        "floorsAscended": num(stats, "floorsAscended"),
    } if stats else None

    sd = safe(lambda: g.get_sleep_data(ds))
    dto = (sd or {}).get("dailySleepDTO") or {}
    if dto and num(dto, "sleepTimeSeconds") > 0:
        scores = dto.get("sleepScores") or {}
        out["sleep"] = {
            "date": ds,
            "overallScore": (scores.get("overall") or {}).get("value", 0),
            "deepMinutes": num(dto, "deepSleepSeconds") / 60,
            "lightMinutes": num(dto, "lightSleepSeconds") / 60,
            "remMinutes": num(dto, "remSleepSeconds") / 60,
            "awakeMinutes": num(dto, "awakeSleepSeconds") / 60,
            "totalMinutes": num(dto, "sleepTimeSeconds") / 60,
            "avgStress": num(dto, "avgSleepStress"),
            "avgRespiration": num(dto, "averageRespirationValue"),
            "avgSpo2": num(dto, "averageSpO2Value"),
            "restingHr": num(dto, "restingHeartRate"),
        }
    else:
        out["sleep"] = None

    hrv = safe(lambda: g.get_hrv_data(ds))
    summ = (hrv or {}).get("hrvSummary") or {}
    spo2 = safe(lambda: g.get_spo2_data(ds)) or {}
    p = {
        "date": ds,
        "hrv": num(summ, "lastNightAvg"),
        "hr": num(stats, "restingHeartRate"),
        "spo2": num(spo2, "averageSpO2") or num((out["sleep"] or {}), "avgSpo2"),
        "respiration": num(stats, "avgWakingRespirationValue"),
        "stress": num(stats, "averageStressLevel"),
    }
    out["physio"] = p if (p["hrv"] > 0 or p["stress"] > 0 or p["spo2"] > 0) else None

    tr = safe(lambda: g.get_training_readiness(ds))
    row = tr[0] if isinstance(tr, list) and tr else (tr if isinstance(tr, dict) else None)
    if row and num(row, "score") > 0:
        out["readiness"] = {
            "date": ds,
            "score": num(row, "score"),
            "level": row.get("level", ""),
            "feedbackShort": row.get("feedbackShort", ""),
            "sleepFactor": num(row, "sleepScoreFactorPercent"),
            "recoveryFactor": num(row, "recoveryTimeFactorPercent"),
            "acwrFactor": num(row, "acwrFactorPercent"),
            "stressFactor": num(row, "stressHistoryFactorPercent"),
            "hrvFactor": num(row, "hrvFactorPercent"),
            "sleepHistoryFactor": num(row, "sleepHistoryFactorPercent"),
            "recoveryTimeHours": num(row, "recoveryTime") / 60.0,
            "hrvWeeklyAvg": num(row, "hrvWeeklyAverage"),
        }
    else:
        out["readiness"] = None

    mm = safe(lambda: g.get_max_metrics(ds))
    item = mm[0] if isinstance(mm, list) and mm else (mm if isinstance(mm, dict) else None)
    generic = (item or {}).get("generic") or {}
    v = num(generic, "vo2MaxValue") or num(generic, "vo2MaxPreciseValue")
    out["vo2"] = {"date": ds, "sport": "RUNNING", "vo2max": v, "maxMet": num(generic, "maxMet")} if v > 0 else None

    ts = safe(lambda: g.get_training_status(ds))
    latest = ((ts or {}).get("mostRecentTrainingStatus") or {}).get("latestTrainingStatusData") or {}
    out["trainingLoad"] = None
    for dev in latest.values():
        atl = (dev or {}).get("acuteTrainingLoadDTO") or {}
        acute, chronic = num(atl, "dailyTrainingLoadAcute"), num(atl, "dailyTrainingLoadChronic")
        if acute > 0 or chronic > 0:
            ratio = num(atl, "dailyAcuteChronicWorkloadRatio") or (acute / chronic if chronic else 0)
            out["trainingLoad"] = {"date": ds, "acute": acute, "chronic": chronic,
                                   "ratio": ratio, "acwrStatus": atl.get("acwrStatus", "")}
            break
    return out


def fetch_fitnessage(tokenstore: str, d: dt.date) -> Optional[dict]:
    g = _client(tokenstore)
    r = safe(lambda: g.get_fitnessage_data(d.isoformat()))
    if not r or num(r, "chronologicalAge") == 0:
        return None
    comp = r.get("components") or {}
    return {
        "date": d.isoformat(),
        "chronologicalAge": num(r, "chronologicalAge"),
        "currentBioAge": num(r, "fitnessAge"),
        "healthyBioAge": num(r, "achievableFitnessAge"),
        "bmi": num(comp.get("bmi") or {}, "value"),
        "restingHr": num(comp.get("rhr") or {}, "value"),
        "vo2max": 0,
    }


def build_zones(g: Garmin, daily: List[dict], fitness: List[dict]) -> dict:
    lt = safe(lambda: g.get_lactate_threshold())
    if lt is None:
        lt = safe(lambda: g.get_lactate_threshold(dt.date.today().isoformat())) or {}
    shr = (lt or {}).get("speed_and_heart_rate") or {}
    resting = 0.0
    for row in reversed(daily):
        if row and row.get("restingHr"):
            resting = row["restingHr"]
            break
    age = fitness[-1]["chronologicalAge"] if fitness else 0
    return {
        "restingHr": resting,
        "maxHr": (220 - age) if age else 0,
        "lactateThresholdHr": num(shr, "heartRate"),
        "lactateThresholdSpeed": num(shr, "speed"),
        "hrZoneFloors": [],
        "powerZoneFloors": [],
    }


def build_bundle(tokenstore: str, days: int) -> Dict[str, Any]:
    today = dt.date.today()
    dates = [(today - dt.timedelta(days=i)) for i in range(days)]
    dates.reverse()  # oldest first

    # Fitness age changes slowly — sample every 5 days plus the latest.
    fa_dates = dates[::5]
    if dates and dates[-1] not in fa_dates:
        fa_dates.append(dates[-1])

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        day_results = list(ex.map(lambda d: fetch_day(tokenstore, d), dates))
        fa_results = list(ex.map(lambda d: fetch_fitnessage(tokenstore, d), fa_dates))

    pick = lambda key: [r[key] for r in day_results if r.get(key)]
    daily = pick("daily")
    sleep = pick("sleep")
    physio = pick("physio")
    readiness = pick("readiness")
    vo2 = pick("vo2")
    training_load = pick("trainingLoad")
    fitness = [r for r in fa_results if r]

    g = _client(tokenstore)
    zones = build_zones(g, daily, fitness)

    race = []
    rp = safe(lambda: g.get_race_predictions())
    rp = rp[0] if isinstance(rp, list) and rp else rp
    if isinstance(rp, dict):
        t5 = num(rp, "time5K") or num(rp, "raceTime5K")
        if t5:
            race.append({
                "date": today.isoformat(),
                "time5k": t5,
                "time10k": num(rp, "time10K") or num(rp, "raceTime10K"),
                "timeHalf": num(rp, "timeHalfMarathon") or num(rp, "raceTimeHalf"),
                "timeMarathon": num(rp, "timeMarathon") or num(rp, "raceTimeMarathon"),
            })

    return {
        "profile": {},
        "zones": zones,
        "racePredictions": race,
        "vo2max": vo2,
        "trainingLoad": training_load,
        "readiness": readiness,
        "sleep": sleep,
        "daily": daily,
        "physio": physio,
        "fitnessAge": fitness,
        "hydration": [],
        "endurance": [],
        "hill": [],
    }


def safe(fn):
    try:
        return fn()
    except Exception:
        return None


def num(d: dict, key: str) -> float:
    v = (d or {}).get(key)
    try:
        return float(v) if v is not None else 0.0
    except (TypeError, ValueError):
        return 0.0
