#!/usr/bin/env python3
"""Refresh App Flow Maestro scenario freshness without changing receipts."""

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path


def read_inventory(path_arg):
    if path_arg == "-":
        return json.load(sys.stdin), None
    path = Path(path_arg).resolve()
    return json.loads(path.read_text()), path


def repository_root(inventory_path, explicit_root):
    if explicit_root:
        return Path(explicit_root).resolve()
    if not inventory_path:
        return Path.cwd().resolve()
    result = subprocess.run(
        ["git", "-C", str(inventory_path.parent), "rev-parse", "--show-toplevel"],
        capture_output=True,
        text=True,
    )
    return Path(result.stdout.strip()).resolve() if result.returncode == 0 else inventory_path.parent


def digest_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(131072), b""):
            digest.update(block)
    return digest.hexdigest()


def digest_path(root, raw_path):
    path = Path(raw_path)
    candidate = (root / path).resolve() if not path.is_absolute() else path.resolve()
    try:
        candidate.relative_to(root)
    except ValueError:
        return {"path": raw_path, "state": "outside-repository"}
    if not candidate.exists():
        return {"path": raw_path, "state": "missing"}
    if candidate.is_file():
        return {"path": raw_path, "state": "file", "sha256": digest_file(candidate)}
    entries = []
    for child in sorted(candidate.rglob("*")):
        if child.is_file() and ".git" not in child.parts:
            entries.append((str(child.relative_to(root)), digest_file(child)))
    serialized = json.dumps(entries, separators=(",", ":"), ensure_ascii=True).encode()
    return {"path": raw_path, "state": "directory", "sha256": hashlib.sha256(serialized).hexdigest()}


def canonical_digest(value):
    serialized = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()
    return hashlib.sha256(serialized).hexdigest()


def current_inputs(inventory, scenario, root):
    run = inventory.get("run", {})
    boundary = inventory.get("boundary", {})
    declared = scenario.get("freshnessInputs", {})
    source_by_id = {source.get("id"): source for source in inventory.get("sources", [])}
    source_ids = declared.get("sourceIds", [])
    source_records = []
    path_values = list(scenario.get("ownerPaths", []))
    path_values.extend(declared.get("ownerPaths", []))
    path_values.extend(declared.get("requirementPaths", []))
    if scenario.get("maestroFlow"):
        path_values.append(scenario["maestroFlow"])
    for source_id in source_ids:
        source = source_by_id.get(source_id)
        if source is None:
            source_records.append({"id": source_id, "state": "missing-source"})
            continue
        source_records.append({
            "id": source_id,
            "kind": source.get("kind"),
            "ref": source.get("ref"),
            "revision": source.get("revision"),
        })
        path_values.extend(source.get("paths", []))
    return {
        "paths": [digest_path(root, path) for path in sorted(set(path_values))],
        "sources": sorted(source_records, key=lambda item: item["id"]),
        "fixtureRef": scenario.get("fixtureRef"),
        "platform": scenario.get("platform"),
        "device": run.get("device"),
        "roles": scenario.get("roles", boundary.get("roles", [])),
        "flags": boundary.get("flags", []),
        "target": run.get("target"),
        "build": run.get("build"),
        "maestroFlow": scenario.get("maestroFlow"),
    }


def latest_passing_receipt(receipts, scenario_id):
    matching = [
        receipt for receipt in receipts
        if receipt.get("result") == "passed"
        and scenario_id in receipt.get("scenarioIds", [])
        and receipt.get("inputFingerprint")
    ]
    return max(matching, key=lambda receipt: receipt.get("timestamp", ""), default=None)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inventory", help="inventory.json path, or - for stdin")
    parser.add_argument("--repo", help="repository root; defaults to Git root or inventory parent")
    parser.add_argument("--write", action="store_true", help="replace the inventory file with refreshed statuses")
    args = parser.parse_args()

    inventory, inventory_path = read_inventory(args.inventory)
    if args.write and inventory_path is None:
        parser.error("--write requires an inventory file path")
    root = repository_root(inventory_path, args.repo)
    summary = {"current": 0, "stale": 0, "unknown": 0}

    for scenario in inventory.get("scenarios", []):
        receipt = latest_passing_receipt(inventory.get("receipts", []), scenario.get("id"))
        fingerprint = canonical_digest(current_inputs(inventory, scenario, root))
        scenario["currentInputFingerprint"] = fingerprint
        if receipt is None:
            scenario["freshness"] = "unknown"
        elif receipt["inputFingerprint"] == fingerprint:
            scenario["freshness"] = "current"
        else:
            scenario["freshness"] = "stale"
        summary[scenario["freshness"]] += 1

    inventory["freshnessSummary"] = summary
    rendered = json.dumps(inventory, indent=2, ensure_ascii=False) + "\n"
    if args.write:
        inventory_path.write_text(rendered)
        print(json.dumps(summary, sort_keys=True))
    else:
        sys.stdout.write(rendered)


if __name__ == "__main__":
    main()
