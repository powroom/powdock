# Development

## Requirements

- [Bun](https://bun.sh) 1.4.4 or newer. Bun is the runtime, the package manager and the test runner.
- Development runs on Linux or macOS. On Windows, run it inside WSL 2.

## Run it from source

```bash
bun install
bun run dev
```

The app starts on port 3434: open http://127.0.0.1:3434/. The first start asks you to create an admin account. The terminal and the live logs use WebSockets that only the built server handles, so they do not work with `bun run dev`; use `bun run build` and `bun run start` to try them.

## Checks

These are the same checks CI runs:

```bash
bun check          # typecheck
bun run lint       # oxlint, no warnings allowed
bun fmt --check    # formatting
bun test
```

Run `bun fmt` to format the code. Tests must not need the network or the Docker Engine.

## Build

```bash
bun run build      # client and server into dist/
bun run build:npm  # also assembles npm-package/ for the npx launcher
```

## Code rules

- All text in the repository is plain English, and it has no em dashes.
- Do not turn checks off with comments (`eslint-disable`, `@ts-ignore`, and similar). A test fails if you do.
- The React Compiler builds the client. Avoid patterns it cannot optimise: `??=`, `x++` on module variables, getters in object literals, `import()` inside components, and `setState` inside `useEffect`.
