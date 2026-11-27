# Install and update

How to run pow/dock with npx or Docker, where your data is kept, and how to update. For settings, see [Configuration](configuration.md). To build from source, see [Development](development.md).

## Run with npx

You need [Node.js](https://nodejs.org) 18 or newer.

```bash
npx powdock          # or: bunx powdock
npx powdock --yes    # installs Bun without asking, for scripts
```

- pow/dock runs on [Bun](https://bun.sh). If Bun is missing or older than 1.4.4, `powdock` says so and asks whether to install Bun 1.4.4. That copy goes only into `~/.powdock/runtime` (about 100 MB, depending on the platform). Nothing else on your computer changes. Answer `n` to install Bun yourself from https://bun.sh instead. Without a terminal, `powdock` installs Bun only when you pass `--yes`.
- The data folder is `~/.powdock`. It holds `auth.json` (the admin account and the session secret), `projects.json` (the Compose projects pow/dock remembers), `updates.json` (the last image update check) and `scans.json` (the last vulnerability scan results). Change the folder with `--data-dir <path>` or `POWDOCK_DATA_DIR`.
- Options: `--port <n>` (default `PORT`, else 3434), `--host <address>` (default `HOST`, else 127.0.0.1), `--data-dir <path>`, `--no-open` (do not open the browser), `-y` or `--yes` (install Bun without asking), `-v` or `--version`, and `-h` or `--help`. `powdock start` does the same as `powdock`. Run `powdock --help` for the list.
- pow/dock uses the Docker Engine socket. By default that is `DOCKER_HOST` if it is a `unix://` URL, else `/var/run/docker.sock`. Set another path with `POWDOCK_DOCKER_SOCKET`.

## Run with Docker

You need [Docker](https://docs.docker.com/get-docker/).

```bash
docker run -d --name powdock --restart unless-stopped \
  -p 127.0.0.1:3434:3434 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  --group-add "$(stat -c %g /var/run/docker.sock)" \
  -v powdock-data:/data \
  ghcr.io/powroom/powdock:latest
```

- The port is bound to `127.0.0.1`, so only this computer can reach pow/dock.
- The Docker socket is mounted, so pow/dock can list and manage the containers on this machine. The app runs as user 1000, so `--group-add` gives it the group of the socket.
- `--restart unless-stopped` starts pow/dock again after a reboot or a Docker restart, unless you stopped it yourself with `docker stop powdock`. Already running without it? Add it with `docker update --restart unless-stopped powdock`.
- The admin account, your projects list, and the update and scan results are saved in the `powdock-data` volume, which is mounted at `/data`. They stay after a restart.
- pow/dock refuses to stop or remove the container it runs in.
- The image works on amd64 and arm64, including Apple Silicon Macs.
- The image layers use zstd compression for a smaller download, so pulling it needs Docker 23 or newer (or Podman 4, containerd 1.5).

## Docker Compose

Download the example file and start it:

```bash
curl -o compose.yml https://raw.githubusercontent.com/powroom/powdock/main/compose.example.yml
echo "DOCKER_GID=$(stat -c %g /var/run/docker.sock)" > .env
docker compose up -d
docker compose logs -f app   # show app logs (Ctrl+C to stop)
docker compose down          # stop (the data volume stays)
```

The file needs `DOCKER_GID`, the group of the Docker socket, so pow/dock can use the socket. The `.env` line saves it next to `compose.yml`, and every `docker compose` command reads it from there. The file also has a commented example for the admin password.

## Windows

- pow/dock does not run directly on Windows. It talks to Docker through a Unix socket, and Windows has none.
- Run it inside a WSL 2 distribution that can use Docker. Either install Docker Engine in that distribution, or use Docker Desktop with the WSL 2 engine and WSL integration turned on for that distribution.
- Docker Desktop with Docker VMM has no Docker socket in WSL, so pow/dock does not work with it.
- In a terminal in that distribution, run `npx powdock` (see [Run with npx](#run-with-npx)) or the Docker commands above.
- Open http://localhost:3434 in your Windows browser. WSL forwards localhost to Windows, so the address works there too.

## Pin a version

Use a release tag instead of `latest`, for example `ghcr.io/powroom/powdock:0.1.0`. The release tags are made from the version numbers of the releases.

## Where your data is

- **npx:** `~/.powdock` (change it with `--data-dir` or `POWDOCK_DATA_DIR`).
- **Docker:** the `powdock-data` volume, mounted at `/data`.
- **From source:** `.data` in the pow/dock folder, unless `POWDOCK_DATA_DIR` is set.
- **New Compose projects:** each one gets its own folder under `~/powdock-projects` by default (`POWDOCK_PROJECTS_DIR`).

The data folder holds the password hash and the session secret. Keep it private.

## Update

Once a day, the pow/dock server checks GitHub for a new release. With npx, `powdock` also checks npm when it starts and prints a notice when a newer version is out. To turn these checks off, set `POWDOCK_UPDATE_CHECK=off` (see [Update check privacy](configuration.md#update-check-privacy)).

- **Docker:** pull the new image, then recreate the container. Your data stays in the volume:

  ```bash
  docker pull ghcr.io/powroom/powdock:latest
  docker rm -f powdock     # then run the docker run command above again
  ```

  With Compose, run `docker compose pull`, then `docker compose up -d`.

- **npx:** stop pow/dock (Ctrl+C), then run `npx powdock@latest` to get the newest release. `bunx powdock@latest` works too. Your data in `~/.powdock` stays.

- **Source:** in your pow/dock folder, run `git pull`, `bun install`, and `bun run build`, then restart pow/dock.
