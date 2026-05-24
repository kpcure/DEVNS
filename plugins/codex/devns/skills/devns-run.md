# DevNS Run

Use this workflow in repositories configured with Never Stop.

Start by running the stable command surface:

```sh
npm run devns:run -- --json
```

Then follow the returned mode:

1. `bootstrap_required`: run `devns-init` before implementation.
2. `continue_active`: continue the active feature only.
3. `claim_next`: read the returned feature and approved RFC before editing code.
4. `blocked_ready`: run `devns-rfc` or ask for human RFC approval.
5. `empty_queue`: stop unless the human adds new candidates or features.

Inside one feature loop:

1. Read the approved RFC and linked context.
2. Do technical implementation analysis before coding.
3. Implement exactly one feature.
4. Run verification and review lanes.
5. Record evidence and execution history.
6. Commit exactly one feature.

DevNS is extension-first: project-local skills, agents, sensors, and hook policies override defaults.
