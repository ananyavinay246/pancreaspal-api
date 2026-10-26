import json
import logging
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

import jwt
from fastapi import HTTPException, Header

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

_JWKS_CACHE: dict[str, Any] = {"keys": None, "expires_at": 0.0}


@dataclass(frozen=True)
class AuthUser:
    sub: str
    email: str | None


def auth_enabled() -> bool:
    return os.getenv("AUTH_ENABLED", "").strip().lower() in ("1", "true", "yes")


def demo_patient_id() -> str | None:
    value = (os.getenv("DEMO_PATIENT_ID") or "").strip()
    return value or None


def _cognito_issuer() -> str:
    region = (os.getenv("COGNITO_REGION") or os.getenv("AWS_REGION") or "us-east-1").strip()
    pool_id = (os.getenv("COGNITO_USER_POOL_ID") or "").strip()
    if not pool_id:
        raise HTTPException(status_code=500, detail="COGNITO_USER_POOL_ID is not configured.")
    return f"https://cognito-idp.{region}.amazonaws.com/{pool_id}"


def _app_client_id() -> str:
    client_id = (os.getenv("COGNITO_APP_CLIENT_ID") or "").strip()
    if not client_id:
        raise HTTPException(status_code=500, detail="COGNITO_APP_CLIENT_ID is not configured.")
    return client_id


def _fetch_jwks() -> dict[str, Any]:
    now = time.time()
    if _JWKS_CACHE["keys"] and _JWKS_CACHE["expires_at"] > now:
        return _JWKS_CACHE["keys"]

    issuer = _cognito_issuer()
    url = f"{issuer}/.well-known/jwks.json"
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        logging.error("Failed to load Cognito JWKS: %s", exc)
        raise HTTPException(status_code=503, detail="Authentication service unavailable.") from exc

    _JWKS_CACHE["keys"] = payload
    _JWKS_CACHE["expires_at"] = now + 3600
    return payload


def _rsa_key_for_kid(kid: str) -> Any:
    jwks = _fetch_jwks()
    for key in jwks.get("keys") or []:
        if key.get("kid") == kid:
            return jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(key))
    raise HTTPException(status_code=401, detail="Invalid token signing key.")


def verify_id_token(token: str) -> AuthUser:
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid token.") from exc

    kid = header.get("kid")
    if not kid:
        raise HTTPException(status_code=401, detail="Invalid token.")

    key = _rsa_key_for_kid(kid)
    issuer = _cognito_issuer()
    audience = _app_client_id()

    try:
        claims = jwt.decode(
            token,
            key=key,
            algorithms=["RS256"],
            audience=audience,
            issuer=issuer,
            options={"require": ["exp", "iss", "sub"]},
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired token.") from exc

    token_use = claims.get("token_use")
    if token_use and token_use != "id":
        raise HTTPException(status_code=401, detail="ID token required.")

    sub = str(claims.get("sub") or "")
    if not sub:
        raise HTTPException(status_code=401, detail="Invalid token subject.")

    email = claims.get("email")
    if email is not None:
        email = str(email)
    return AuthUser(sub=sub, email=email)


def parse_bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    parts = authorization.split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    token = parts[1].strip()
    return token or None


async def get_optional_user(authorization: str | None = Header(default=None)) -> AuthUser | None:
    token = parse_bearer_token(authorization)
    if not token:
        return None
    if not auth_enabled():
        return verify_id_token(token)
    return verify_id_token(token)


async def get_required_user(authorization: str | None = Header(default=None)) -> AuthUser:
    user = await get_optional_user(authorization)
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required.")
    return user


def authorize_patient_id(
    path_patient_id: str,
    user: AuthUser | None,
    user_patient_service: Any,
) -> str:
    """Return the patient_id the caller is allowed to use (must match path for this API shape)."""
    if not auth_enabled():
        return path_patient_id

    demo_id = demo_patient_id()
    if user is None:
        if demo_id and path_patient_id == demo_id:
            return path_patient_id
        raise HTTPException(
            status_code=403,
            detail="Guest access is limited to the demo patient. Sign in for a private account.",
        )

    allowed = user_patient_service.get_or_create_patient_for_sub(user.sub, user.email)
    if path_patient_id != allowed:
        raise HTTPException(status_code=403, detail="Not authorized for this patient.")
    return allowed
