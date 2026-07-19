# Fusion role pack examples

JSON role packs load with the shipped CLI and `load_role_pack_file`.

## Files

| File | Purpose |
|------|---------|
| `custom_review.json` | Dual-branch **correctness vs operability** review pack (not a built-in profile dump). Distinct `role_id`s for smoke/CI. |

## CLI (offline)

```bash
# From monorepo root after building packages/cpp
handoffkit-cli fusion roles --file packages/cpp/examples/fusion/role_packs/custom_review.json

# Built-ins still work
handoffkit-cli fusion roles --profile neutral
handoffkit-cli fusion roles --pack incident
handoffkit-cli fusion explain --tier medium --mode ultra
```

## Schema (snake_case wire)

Minimum valid pack:

- `branches` array with **≥ 2** entries
- each branch: `branch_id`, `architect.role_id`, `architect.agent_name`, `architect.system_role`
- `merger.role_id`, `merger.agent_name`, `merger.system_role`
- optional: `profile`, `description`, `task_faithful_merge`, `shipping_merge_sections`, per-role `focus` / skeptic block

See `validate_role_pack` / `role_pack_from_json` under `demos/fusion/roles`.
