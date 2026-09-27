import jwt
import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from app import security
from app.config import get_settings


def _creds(token: str) -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


def test_existing_hs256_token_still_decodes():
    tok = jwt.encode(
        {"sub": "u1", "role": "user", "iat": 1, "exp": 4102444800},
        get_settings().jwt_secret,
        algorithm="HS256",
    )
    assert security._decode(_creds(tok), "user")["sub"] == "u1"


def test_token_without_exp_is_rejected():
    tok = jwt.encode({"sub": "u1", "role": "user"}, get_settings().jwt_secret, algorithm="HS256")
    with pytest.raises(HTTPException) as err:
        security._decode(_creds(tok), "user")
    assert err.value.status_code == 401


def test_unsigned_token_is_rejected():
    # alg=none carries no signature; algorithms=["HS256"] must refuse it.
    tok = jwt.encode(
        {"sub": "u1", "role": "user", "iat": 1, "exp": 4102444800}, None, algorithm="none"
    )
    with pytest.raises(HTTPException) as err:
        security._decode(_creds(tok), "user")
    assert err.value.status_code == 401
