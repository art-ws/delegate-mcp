#!/usr/bin/env python3
"""Bounded, value-blind OpenRouter access observations for D-ACCESS."""

import argparse
import datetime as dt
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


ENDPOINTS = {
    "models": ("https://openrouter.ai/api/v1/models", 2 * 1024 * 1024),
    "key": ("https://openrouter.ai/api/v1/key", 64 * 1024),
}
CANARY = "DACCESS_SYNTHETIC_REFLECTION_CANARY_9f93d7"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


def category_for(status, body, oversize=False, redirected=False):
    if redirected:
        return "REDIRECT_REJECTED"
    if oversize:
        return "OVERSIZE"
    if status is None:
        return "NETWORK_ERROR"
    if status < 200 or status >= 300:
        return "HTTP_ERROR"
    try:
        json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return "NON_JSON"
    return "JSON"


def optional_bool(data, key):
    if not isinstance(data, dict) or key not in data:
        return "unknown"
    value = data[key]
    if isinstance(value, bool) or value is None:
        return value
    return "unknown"


def derive_expired(data, now):
    if not isinstance(data, dict) or "expires_at" not in data:
        return "unknown"
    value = data["expires_at"]
    if value is None:
        return False
    if not isinstance(value, str):
        return "unknown"
    try:
        expiration = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return "unknown"
    if expiration.tzinfo is None:
        return "unknown"
    return expiration <= now


def project_models(status, parsed):
    keys = ("jev_1_13", "jev_latest")
    projection = {
        "exact_id_typesafe_jev_1_13": "unknown",
        "exact_canonical_slug_typesafe_jev_1_13": "unknown",
        "exact_id_typesafe_jev_latest": "unknown",
        "exact_canonical_slug_typesafe_jev_latest": "unknown",
    }
    if status != 200 or not isinstance(parsed, dict) or not isinstance(parsed.get("data"), list):
        return projection
    wanted = {
        "jev_1_13": "typesafe/jev-1.13",
        "jev_latest": "~typesafe/jev-latest",
    }
    ids = set()
    slugs = set()
    for row in parsed["data"]:
        if not isinstance(row, dict):
            continue
        for field, target in (("id", ids), ("canonical_slug", slugs)):
            value = row.get(field)
            if isinstance(value, str) and value in wanted.values():
                target.add(value)
    for suffix, name in wanted.items():
        projection[f"exact_id_typesafe_{suffix}"] = name in ids
        projection[f"exact_canonical_slug_typesafe_{suffix}"] = name in slugs
    return projection


def project_key(status, parsed, now):
    data = parsed.get("data") if isinstance(parsed, dict) else None
    recognized = status == 200 and isinstance(data, dict)
    if not recognized:
        return {
            "recognized": False,
            "expired": "unknown",
            "is_free_tier": "unknown",
            "is_management_key": "unknown",
            "is_provisioning_key": "unknown",
            "limit_remaining_positive": "unknown",
        }
    remaining = data.get("limit_remaining", "unknown")
    positive = remaining > 0 if isinstance(remaining, (int, float)) and not isinstance(remaining, bool) else "unknown"
    return {
        "recognized": True,
        "expired": derive_expired(data, now),
        "is_free_tier": optional_bool(data, "is_free_tier"),
        "is_management_key": optional_bool(data, "is_management_key"),
        "is_provisioning_key": optional_bool(data, "is_provisioning_key"),
        "limit_remaining_positive": positive,
    }


def read_bounded(response, cap):
    chunks = []
    total = 0
    while total <= cap:
        chunk = response.read(min(16384, cap + 1 - total))
        if not chunk:
            return b"".join(chunks), total, False
        chunks.append(chunk)
        total += len(chunk)
        if total > cap:
            return b"".join(chunks), total, True
    return b"".join(chunks), total, True


def observe(name, key_value):
    url, cap = ENDPOINTS[name]
    request = urllib.request.Request(
        url,
        headers={"Authorization": "Bearer " + key_value, "Accept": "application/json", "Accept-Encoding": "identity"},
        method="GET",
    )
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({}),
        NoRedirect(),
        urllib.request.HTTPSHandler(context=ssl.create_default_context()),
    )
    started = time.monotonic()
    status = None
    body = b""
    size = 0
    oversize = False
    redirected = False
    try:
        response = opener.open(request, timeout=15)
        try:
            status = response.status
            body, size, oversize = read_bounded(response, cap)
        finally:
            response.close()
    except urllib.error.HTTPError as error:
        status = error.code
        redirected = 300 <= error.code < 400
        if not redirected:
            try:
                body, size, oversize = read_bounded(error, cap)
            finally:
                error.close()
        else:
            error.close()
    except Exception as error:
        reason = error.reason if isinstance(error, urllib.error.URLError) else None
        tls_failure = isinstance(error, ssl.SSLError) or isinstance(reason, ssl.SSLError)
        return {
            "http_status": None,
            "elapsed_ms": int((time.monotonic() - started) * 1000),
            "bytes": 0,
            "category": "NETWORK_ERROR",
            "parsed": None,
            "redirected": False,
            "terminal_security": tls_failure,
        }
    elapsed = int((time.monotonic() - started) * 1000)
    category = category_for(status, body, oversize, redirected)
    parsed = None
    if category == "JSON":
        try:
            parsed = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            category = "NON_JSON"
    return {
        "http_status": status,
        "elapsed_ms": elapsed,
        "bytes": size,
        "category": category,
        "parsed": parsed,
        "redirected": redirected,
        "terminal_security": False,
    }


def synthetic_controls():
    now = dt.datetime(2030, 1, 1, tzinfo=dt.timezone.utc)
    model = project_models(200, {"data": [
        {"id": "typesafe/jev-1.13", "canonical_slug": "typesafe/jev-1.13", "private": CANARY},
        {"id": "~typesafe/jev-latest", "canonical_slug": "~typesafe/jev-latest", "secretish": "discard"},
    ], "private_top_level": CANARY})
    assert model == {
        "exact_id_typesafe_jev_1_13": True,
        "exact_canonical_slug_typesafe_jev_1_13": True,
        "exact_id_typesafe_jev_latest": True,
        "exact_canonical_slug_typesafe_jev_latest": True,
    }
    false_null_missing = project_key(200, {"data": {
        "expires_at": None,
        "is_free_tier": False,
        "is_management_key": None,
        "limit_remaining": 0,
        "private_field": CANARY,
    }, "creator_user_id": CANARY}, now)
    assert false_null_missing == {
        "recognized": True,
        "expired": False,
        "is_free_tier": False,
        "is_management_key": None,
        "is_provisioning_key": "unknown",
        "limit_remaining_positive": False,
    }
    assert derive_expired({"expires_at": "2029-12-31T23:59:59Z"}, now) is True
    assert derive_expired({"expires_at": "2030-01-02T00:00:00Z"}, now) is False
    assert derive_expired({}, now) == "unknown"
    assert derive_expired({"expires_at": "bad"}, now) == "unknown"
    assert category_for(403, b'{"error":true}') == "HTTP_ERROR"
    assert category_for(200, b"not-json") == "NON_JSON"
    assert category_for(200, b"x" * 10, oversize=True) == "OVERSIZE"
    assert category_for(302, b"", redirected=True) == "REDIRECT_REJECTED"
    control_output = json.dumps({"model": model, "key": false_null_missing}, sort_keys=True)
    assert CANARY not in control_output
    assert "private_field" not in control_output and "creator_user_id" not in control_output
    return {
        "status": "PASS",
        "controls": [
            "unknown_fields_dropped",
            "false_null_missing_distinguished",
            "expiry_derivation",
            "http_403_invalid_json_oversize_classification",
            "reflected_canary_absent",
        ],
    }


def safe_projection(name, observation, now):
    base = {key: observation[key] for key in ("http_status", "elapsed_ms", "bytes", "category")}
    if name == "models":
        base["models"] = project_models(observation["http_status"], observation["parsed"])
    else:
        base["key"] = project_key(observation["http_status"], observation["parsed"], now)
    return base


def main():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--mode", choices=("controls", "live"), required=True)
    parser.add_argument("--evidence", required=True)
    args = parser.parse_args()
    evidence = Path(args.evidence)
    evidence.mkdir(parents=True, exist_ok=True)
    if args.mode == "controls":
        try:
            result = synthetic_controls()
            serialized = json.dumps(result, sort_keys=True) + "\n"
            if CANARY in serialized:
                raise ValueError("canary")
            (evidence / "controls.json").write_text(serialized, encoding="utf-8")
            sys.stdout.write(serialized)
            return 0
        except Exception:
            sys.stderr.write("D-ACCESS synthetic controls failed.\n")
            return 1

    key_value = os.environ.get("OPENROUTER_API_KEY")
    if not isinstance(key_value, str) or not key_value:
        sys.stderr.write("D-ACCESS child key environment absent.\n")
        return 2
    # Keep only the one authorized secret in this process; this also removes proxy configuration.
    os.environ.clear()
    os.environ["OPENROUTER_API_KEY"] = key_value
    rows = {}
    counts = {"models_get": 0, "key_get": 0, "post": 0, "retries": 0, "redirects": 0}
    now = dt.datetime.now(dt.timezone.utc)
    try:
        for name in ("models", "key"):
            counts[f"{name}_get"] += 1
            observation = observe(name, key_value)
            if observation["redirected"]:
                counts["redirects"] += 1
            projection = safe_projection(name, observation, now)
            serialized = json.dumps(projection, sort_keys=True)
            if key_value in serialized or CANARY in serialized:
                raise ValueError("leak")
            rows[name] = projection
            # A redirect or TLS verification failure stops before any later request.
            if observation["redirected"] or observation["terminal_security"]:
                break
        result = {"observations": rows, "counters": counts}
        serialized = json.dumps(result, sort_keys=True, indent=2) + "\n"
        if key_value in serialized or CANARY in serialized:
            raise ValueError("leak")
        output_path = evidence / "projection.json"
        output_path.write_text(serialized, encoding="utf-8")
        sys.stdout.write(serialized)
        return 0
    except Exception:
        sys.stderr.write("D-ACCESS stopped; safe projection blocked.\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
