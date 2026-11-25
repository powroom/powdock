# Contributing to pow/dock

Thanks for helping. Bug reports, ideas, and pull requests are all welcome.

## Before you start

- For a bug or an idea, open an issue first, so we can agree on the approach before you write code.
- For a security problem, do not open an issue: see [SECURITY.md](SECURITY.md).

## Set up and run

See [docs/development.md](docs/development.md): install Bun, run `bun install`, and run `bun run dev`.

## Before you open a pull request

Run the same checks as CI:

```bash
bun check && bun run lint && bun fmt --check && bun test
```

- Keep the change focused. One pull request, one topic.
- Add or update tests for the behaviour you change. Tests must not need the Docker Engine or the network.
- UI text is plain English, without em dashes. Use the existing coss ui components.
- Do not turn checks off with comments (`eslint-disable`, `@ts-ignore`, and similar): a test fails if you do.
- Update the docs when the change affects users.

## License

pow/dock is licensed under the [Apache License 2.0](LICENSE). By sending a contribution, you agree that it is licensed under the same terms.
