## Summary
<!-- What and why, in 1 to 3 lines. Ticket: <PROJ>-123 -->

## Changes
<!-- One line per component (api, web, …) -->
- **<component>:**
- **Migrations** (in the order they must run before deploy):

## How to test
<!-- Concrete steps and the role to use. Preview link if any. -->

## Risks / deploy notes
- [ ] Migration scripts run on the target environment's database
- [ ] New environment variables set on the platform (names only here, never values)
- [ ] Contract changes that break a consumer:
- [ ] `/cuadrilla:verify` green locally; `claude-review` comments addressed
