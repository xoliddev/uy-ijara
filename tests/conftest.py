"""Test setup: run ``async def`` tests without extra plugins, and share small fixtures."""

from __future__ import annotations

import asyncio
import inspect
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


@pytest.hookimpl(tryfirst=True)
def pytest_pyfunc_call(pyfuncitem: pytest.Function):
    if inspect.iscoroutinefunction(pyfuncitem.obj):
        args = {name: pyfuncitem.funcargs[name] for name in pyfuncitem._fixtureinfo.argnames}
        asyncio.run(pyfuncitem.obj(**args))
        return True
    return None


@pytest.fixture(scope="session")
def vectors() -> dict:
    with open(ROOT / "shared" / "test_vectors.json", encoding="utf-8") as fh:
        return json.load(fh)


@pytest.fixture(scope="session")
def districts() -> list[dict]:
    with open(ROOT / "shared" / "data" / "districts.json", encoding="utf-8") as fh:
        return json.load(fh)
