#!/usr/bin/env python3
"""Generate a stable Maestro subset-selection manifest from inventory.json."""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inventory", help="inventory.json path, or - for stdin")
    parser.add_argument("--output", help="manifest path; defaults beside the inventory")
    parser.add_argument("--stdout", action="store_true", help="write the manifest to stdout")
    args = parser.parse_args()
    if args.output and args.stdout:
        parser.error("--output and --stdout cannot be combined")

    if args.inventory == "-":
        if not args.stdout:
            parser.error("stdin inventory requires --stdout")
        inventory_path = None
        inventory = json.load(sys.stdin)
    else:
        inventory_path = Path(args.inventory).resolve()
        inventory = json.loads(inventory_path.read_text())
    run = inventory.get("run", {})
    boundary = inventory.get("boundary", {})
    entries = []
    for scenario in inventory.get("scenarios", []):
        maestro_flow = scenario.get("maestroFlow")
        if not maestro_flow:
            continue
        entries.append({
            "scenarioId": scenario["id"],
            "flowId": scenario.get("flowId"),
            "maestroFlow": maestro_flow,
            "platform": scenario.get("platform", run.get("target")),
            "roles": scenario.get("roles", boundary.get("roles", [])),
            "fixtureRef": scenario.get("fixtureRef"),
            "tags": scenario.get("tags", []),
            "behaviorStatus": scenario.get("behaviorStatus"),
            "freshness": scenario.get("freshness"),
        })
    manifest = {
        "schemaVersion": "1.0",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "target": run.get("target"),
        "entries": sorted(entries, key=lambda entry: entry["scenarioId"]),
    }
    rendered = json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"
    if args.stdout:
        sys.stdout.write(rendered)
        return
    output = Path(args.output).resolve() if args.output else inventory_path.with_name("maestro-manifest.json")
    output.write_text(rendered)
    print(output)


if __name__ == "__main__":
    main()
