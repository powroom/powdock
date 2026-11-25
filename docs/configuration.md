# Configuration

How to set up pow/dock: environment variables, the admin login, network security, and the update check.

## Environment variables

If a variable is not set, its default is used. A session value that is not valid or not positive uses its default. An invalid `PORT` stops pow/dock with a message.

| Name                     | Default                                                             | What it does                                                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                   | `3434`                                                              | Port to listen on. A whole number from 1 to 65535.                                                                                                                                       |
| `HOST`                   | `127.0.0.1`                                                         | Address to listen on. The Docker image sets it to `0.0.0.0`.                                                                                                                             |
| `POWDOCK_DATA_DIR`       | `./.data` (`/data` in Docker, `~/.powdock` with npx)                | Data folder. It holds `auth.json`, which has the admin password hash and the session secret. Keep it private.                                                                            |
| `POWDOCK_ALLOWED_HOSTS`  | not set                                                             | Extra host names pow/dock accepts, separated by commas. `localhost`, `127.0.0.1`, and `[::1]` always work, and so does a `HOST` address that is not `0.0.0.0`. Other host names get 403. |
| `POWDOCK_ADMIN_USER`     | `admin`                                                             | Admin username, when the admin is created from environment variables (1 to 64 characters).                                                                                               |
| `POWDOCK_ADMIN_PASSWORD` | not set                                                             | If set and no admin exists yet, the admin is created at start. At least 8 characters.                                                                                                    |
| `POWDOCK_SESSION_DAYS`   | `30`                                                                | How many days a sign-in lasts.                                                                                                                                                           |
| `POWDOCK_SECURE_COOKIES` | `auto`                                                              | `true` or `false`. `auto` sends Secure cookies when the request uses HTTPS.                                                                                                              |
| `POWDOCK_TRUST_PROXY`    | `false`                                                             | Set to `true` behind a reverse proxy. The client IP for login limits then comes from `X-Forwarded-For` (or `X-Real-IP`). With `false`, only the connecting address is used.              |
| `POWDOCK_PROJECTS_DIR`   | `~/powdock-projects`                                                | Folder that New project suggests for a new Compose project. Each project gets its own folder under it. A `~` means your home folder.                                                     |
| `POWDOCK_DOCKER_SOCKET`  | `DOCKER_HOST` if it is a `unix://` URL, else `/var/run/docker.sock` | Path of the Docker Engine socket that pow/dock uses to list and manage containers. A `unix://` URL works too.                                                                            |
| `POWDOCK_UPDATE_CHECK`   | `on`                                                                | `off` turns off the check for new releases. `false` and `0` work too. See [Update check privacy](#update-check-privacy).                                                                 |
| `POWDOCK_UPDATE_URL`     | GitHub release API for `powroom/powdock`                            | Where the update check asks for the latest release. Mostly useful for testing.                                                                                                           |
| `POWDOCK_TRIVY`          | `trivy` on the PATH, else `~/.local/bin/trivy`                      | The Trivy program that scans images for vulnerabilities. A path, or a name on the PATH. Scans need Trivy. See [Vulnerability scans](#vulnerability-scans).                               |

## Admin account and sign-in

pow/dock always asks for a sign-in. It can start and stop containers on this machine, which is as powerful as root access, so there is no way to turn the login off.

- **First start**: with no admin yet, pow/dock opens `/setup` and asks for a username and a password (at least 8 characters). After that, sign in on `/login`.
- **Admin from environment**: if `POWDOCK_ADMIN_PASSWORD` is set and no admin exists, the admin is created at start. The username comes from `POWDOCK_ADMIN_USER` (default `admin`).
- **Change the password or sign out**: Settings, then Account. Changing the password signs out every other session.
- **Sessions** last `POWDOCK_SESSION_DAYS` days (default 30). Sessions are signed with a secret stored in `auth.json`.
- **Login attempt limit**: 10 failed sign-ins in 15 minutes from one IP address block that address for a while.
- **Passwords** are stored as argon2id hashes. They are never written in clear text.

## Network security and proxy

pow/dock is built for **local use**:

- **Listen on `127.0.0.1`** (the default). If other machines must reach pow/dock, put it behind a reverse proxy with HTTPS, and set `POWDOCK_SECURE_COOKIES=true`.
- Behind a proxy, also set `POWDOCK_TRUST_PROXY=true`, so login limits use the real client IP. Do not turn this on if pow/dock can be reached without the proxy, because `X-Forwarded-For` can be faked.
- **WebSockets**: the terminal and the live logs use WebSockets, so the reverse proxy must pass WebSocket upgrades through.
- **Allowed hosts**: pow/dock refuses requests with an unknown `Host` header. This blocks DNS rebinding attacks. Add other host names with `POWDOCK_ALLOWED_HOSTS`.
- **Cross-site requests** are refused by the server functions, which only accept calls from the same site.
- **Docker socket**: pow/dock lists and manages the containers on this machine through the Docker Engine socket. Set the path with `POWDOCK_DOCKER_SOCKET`. Anyone who can use that socket has root access to the host, so only give it to a pow/dock you trust. pow/dock refuses to stop, restart, pause, kill or remove the container it runs in.

## Terminal

The Terminal tab of a container opens a shell in that container, in the browser (xterm.js over a WebSocket).

- **Default user**: the shell runs as the container's default user, the same user `docker exec` would use without `--user`.
- **Shell**: the Shell menu lists only the shells the container has, looked up when the tab opens (bash, zsh, fish, and sh). bash is picked first when it is there. A container with no shell at all (for example a distroless image) shows a message instead of the terminal.
- **Running containers only**: the terminal opens for a running container. A stopped one shows a Start button.
- **Limit**: at most 20 terminals are open at once, across all browsers. More are refused with a message.
- **Sign-in and origin**: the WebSocket needs the same session as the rest of pow/dock, and the request must come from pow/dock's own page (the `Origin` header must match the `Host`).
- **Built app only**: `bun run dev` does not run the terminal. Use `bun run build` and `bun run start`.
- **Copy and paste**: select text to copy it. Press Ctrl+Shift+V to paste.

## Update check privacy

Once a day, the pow/dock server asks the GitHub API for the latest release. That request carries only the User-Agent `powdock/<version>`. With npx, the launcher also asks `registry.npmjs.org` once when it starts. `POWDOCK_UPDATE_CHECK=off` turns off both checks. A failed check is silent: pow/dock works the same without it.

## Vulnerability scans

Images can be scanned for known vulnerabilities with [Trivy](https://trivy.dev). Scans need the `trivy` program: install it, or set `POWDOCK_TRIVY` to its path. Without it, the Scan buttons are off and pow/dock says so.

- **Read only**: Trivy reads the image. It never pulls, changes or removes an image.
- **Database**: the first scan downloads Trivy's vulnerability database (about 60 MB) into Trivy's cache folder (`~/.cache/trivy` by default). Later scans reuse it.
- **One scan at a time**: scans run one after another. A second request for the same image waits for the running scan.
- **Results**: the last result of each image is kept in `scans.json` in the data folder, for up to 200 images.

## File size limits

Request bodies are limited to 1 MB. pow/dock only sends small JSON bodies.
