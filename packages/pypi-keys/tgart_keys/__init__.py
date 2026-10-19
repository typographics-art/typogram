"""tgart-keys — the verified Typographics Art issuer key registry, as data.

Published on PyPI (immutable per version) so a Python sandbox or agent that can reach PyPI but not an arbitrary website
can still verify signed Typograms. Only **public** keys are here; a private signing key is never included. Each entry
self-verifies and was confirmed served at the issuer's own https://<issuer>/.well-known/tgart-keys.json.

    >>> import tgart_keys
    >>> tgart_keys.issuers()
    ['typographics-art.org']
    >>> tgart_keys.get_issuer("typographics-art.org")["verifiedVia"]
    'https://typographics-art.org/.well-known/tgart-keys.json'

See https://typographics-art.org/keys and docs/key-registry.md.
"""
from __future__ import annotations

import json
from importlib.resources import files
from typing import Any

__all__ = ["registry", "issuers", "get_issuer", "__version__"]
__version__ = "0.1.0"

#: The whole registry document (spec "tgart-registry-v1").
registry: dict[str, Any] = json.loads(files(__package__).joinpath("registry.json").read_text(encoding="utf-8"))


def issuers() -> list[str]:
    """The issuer hostnames in the registry."""
    return [entry["issuer"] for entry in registry["issuers"]]


def get_issuer(domain: str) -> dict[str, Any] | None:
    """The registry entry for one issuer, or ``None``."""
    return next((entry for entry in registry["issuers"] if entry["issuer"] == domain), None)
