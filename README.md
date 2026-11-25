# pow/dock

pow/dock is a fast, light web UI for the Docker Engine on your machine. It is made to replace the heavy Docker Desktop window: open it in your browser, see your containers, images, volumes and networks, and clean up what you no longer need. It talks to the Docker Engine directly through its socket and uses about 30 MB of memory.

## Features

- **Dashboard**: what needs attention (unhealthy, restarting, stopped with an error, near its memory limit), the counts of containers, images, volumes and disk use, and the CPU and memory in use now.
- **Containers**: grouped by Compose project, with live CPU and memory. Start, stop, restart, pause, kill and remove, one by one or a whole project at once. Published ports open in a new tab.
- **Projects**: a Compose project on one page: Up, restart, pull and update, stop or take down, with the live output. Its merged logs and its Compose file (edited with a check before each save). New projects start from an empty file or a `docker run` command.
- **Container details**: live logs (colors, search, timestamps, pause, download), the details of the container (ports, environment with secrets hidden, mounts, networks, health), and a **terminal**: a shell in a running container, in the browser. It runs with the container's default user. See [docs/configuration.md](docs/configuration.md#terminal).
- **Images**: the list with what uses each image, the layer history, remove a tag, pull an image with live progress, and scan an image for known vulnerabilities with Trivy (see [docs/configuration.md](docs/configuration.md#vulnerability-scans)).
- **Updates**: pow/dock checks the registry once every six hours (or on demand) and shows an Update badge when a newer image exists. Update a container or a Compose service in one click.
- **Volumes**: the list with sizes and the containers that use each one, create and remove.
- **Networks**: the list with subnets and attached containers, create and remove.
- **Cleanup**: how much disk Docker uses and what can be freed, by category. Clear old build cache, remove dangling or unused images, stopped containers, unused volumes and unused networks. Every step shows what goes before it runs.

## Quick start

From source (needs [Bun](https://bun.sh) 1.4.4 or newer):

```bash
bun install
bun run build
bun run start
```

Then open http://127.0.0.1:3434/ in your browser. `bun run dev` starts the development server on the same port; the terminal tab works only in the built app.

With Docker, build the image and run it with the Docker socket mounted. The `--group-add` gives the app (which runs as user 1000) access to the socket:

```bash
docker build -t powdock .
docker run -d --name powdock --restart unless-stopped \
  -p 127.0.0.1:3434:3434 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  --group-add "$(stat -c %g /var/run/docker.sock)" \
  -v powdock-data:/data \
  powdock
```

pow/dock knows the container it runs in and refuses to stop or remove it, so it cannot cut itself off.

## First login

The first time you open pow/dock, it asks you to create an admin account: a username and a password of at least 8 characters. After that, sign in with those details. Settings, then Account, lets you change the password. To create the admin at start instead, set `POWDOCK_ADMIN_PASSWORD` (and optionally `POWDOCK_ADMIN_USER`).

## Security

- **Local only by default.** pow/dock listens on `127.0.0.1`, so only this computer can reach it. Do not expose it to a network without a reverse proxy that uses HTTPS.
- **Full control of Docker.** Access to the Docker socket is as powerful as root on this machine. A container can mount any folder of the host. For that reason pow/dock always asks for a login, and it cannot be turned off.
- **Login limits.** Too many failed sign-ins from one address block it for a while.

See [docs/configuration.md](docs/configuration.md) for every setting.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
