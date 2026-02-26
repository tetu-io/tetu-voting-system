---
description:
alwaysApply: true
---


## Delivery Rules
- If behavior or route contracts change, update user-facing docs (`README.md`) and 
relevant config/docs references.
- If frontend architecture, flows, or operational conventions change materially, check 
whether `AGENTS.md` needs an update.
- Every new feature or behavior change must include corresponding tests (unit/
integration/e2e where applicable).
- If you add a new environment key, register it in
document expected usage in project docs, and add to `.env.example`.
- Final validation after edits:
  - `npm run build`
  - `npm run lint`
  - `npm run test`