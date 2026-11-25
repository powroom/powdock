/** What the sign-in pages and the app shell need to know about the session. */
export interface AuthState {
  /** true until the first admin account exists */
  setupRequired: boolean
  authenticated: boolean
  /** the signed-in admin's username, or null */
  username: string | null
}

/** The states the Docker Engine reports for a container (the `State` field). */
export type ContainerState = 'running' | 'exited' | 'paused' | 'restarting' | 'created' | 'dead' | 'removing'

/** The actions pow/dock can run on a container. Each one is a Docker Engine endpoint of the same name. */
export const CONTAINER_ACTIONS = ['start', 'stop', 'restart', 'pause', 'unpause', 'kill'] as const
export type ContainerAction = (typeof CONTAINER_ACTIONS)[number]

/** A port of a container. `public` is only set when the port is published on the host. */
export interface ContainerPort {
  private: number
  public?: number
  type: string
  ip?: string
}

export interface ContainerSummary {
  id: string
  /** the first 12 characters of the id */
  shortId: string
  /** the name without the leading slash */
  name: string
  image: string
  /** the id of the image the container was made from ("sha256:" and 64 hex characters), or "" when unknown */
  imageId: string
  state: ContainerState
  /** Docker's own text, for example "Up 3 hours" or "Exited (0) 2 days ago" */
  status: string
  /** ISO 8601 time the container was created */
  createdAt: string
  ports: ContainerPort[]
  /** the Docker Compose project label, or null */
  project: string | null
  /** the Docker Compose service label, or null */
  service: string | null
  /** true for the container pow/dock itself runs in */
  isSelf: boolean
}

/** The latest CPU and memory of one running container, with its recent CPU values for a sparkline. */
export interface ContainerStats {
  id: string
  /** null until a second sample exists to compare with */
  cpuPercent: number | null
  memUsage: number
  memLimit: number
  /** the last 30 CPU percent values, oldest first. A null is a gap (no sample then). */
  spark: (number | null)[]
}

/**
 * One sample of a running container, taken by the stats sampler every 2 seconds. Rates are per second
 * and null for the first sample, which has nothing to compare with.
 */
export interface StatsSample {
  /** Unix time in milliseconds */
  t: number
  cpu: number | null
  /** memory in use, without the page cache, in bytes */
  mem: number
  /** the memory limit in bytes (the host memory when the container has no limit) */
  memLimit: number
  netRx: number | null
  netTx: number | null
  blkRead: number | null
  blkWrite: number | null
}

/** The sum over all running containers at one sampler tick. A rate or CPU is null when no container has one. */
export interface TotalsSample {
  t: number
  containers: number
  cpu: number | null
  mem: number
  netRx: number | null
  netTx: number | null
  blkRead: number | null
  blkWrite: number | null
}

/** The history of one container: its samples (oldest first) and the host memory in bytes, or null. */
export interface ContainerHistory {
  samples: StatsSample[]
  hostMemory: number | null
}

/** One image on the Images page: one row per image id. */
export interface ImageSummary {
  /** the full id, "sha256:" and 64 hex characters */
  id: string
  /** the first 12 hex characters of the id (without "sha256:") */
  shortId: string
  /** the tags Docker lists for the image, "<none>:<none>" left out */
  tags: string[]
  /** the repository of the first tag, or "<none>" when the image has no tag */
  repository: string
  /** the tag of the first tag, or "<none>" when the image has no tag */
  tag: string
  /** size in bytes */
  size: number
  /** ISO 8601 time the image was created */
  createdAt: string
  /** how many containers, of any state, were made from this image */
  containers: number
  /** true when the image has no tag */
  dangling: boolean
}

/** One step of an image's history (the layers, newest first, as Docker lists them). */
export interface ImageHistoryEntry {
  /** the instruction that made the layer, for example "/bin/sh -c apt-get update" */
  createdBy: string
  /** size of the layer in bytes */
  size: number
  /** ISO 8601 time, or null when Docker gave none */
  createdAt: string | null
}

/** The details of one image, for the image page. */
export interface ImageDetails {
  id: string
  shortId: string
  tags: string[]
  createdAt: string | null
  size: number
  os: string
  architecture: string
  variant: string
  author: string
  entrypoint: string[]
  cmd: string[]
  workingDir: string
  user: string
  /** ports the image declares, such as "80/tcp" */
  exposedPorts: string[]
  env: { key: string; value: string }[]
  labels: { key: string; value: string }[]
  /** how many filesystem layers the image has */
  layers: number
  history: ImageHistoryEntry[]
}

/** The severities of a vulnerability. "unknown" is what the scanner gives when it has no rating. */
export type ScanSeverity = 'critical' | 'high' | 'medium' | 'low' | 'unknown'

/** How many vulnerabilities of each severity an image has. */
export type ScanCounts = Record<ScanSeverity, number>

/** One vulnerability of a scanned image: one CVE in one package. */
export interface ScanItem {
  /** the CVE (or other advisory) id, for example "CVE-2026-4738" */
  id: string
  severity: ScanSeverity
  pkg: string
  /** the version in the image */
  installed: string
  /** the version that fixes it, or null when there is no fix yet */
  fixed: string | null
  /** a short title, at most 200 characters */
  title: string
  /** the advisory page, or null */
  url: string | null
}

/** The numbers of one scan. Enough for the list badges and the summary line. */
export interface ScanSummary {
  imageId: string
  /** ISO 8601 time the scan finished */
  scannedAt: string
  counts: ScanCounts
  /** how many vulnerabilities have a fixed version */
  fixable: number
}

/** One scan, with its findings (at most 500, the most serious first). */
export interface ScanResult extends ScanSummary {
  items: ScanItem[]
}

/** Where a scan is: waiting, downloading the vulnerability database, or scanning. */
export type ScanPhase = 'queued' | 'downloading' | 'scanning'

/** What the server knows about scanning now. */
export interface ScanStatus {
  /** true when a Trivy program can be run */
  available: boolean
  /** true when the vulnerability database is in the Trivy cache */
  databaseReady: boolean
  /** the scans that run or wait, the running one first */
  scans: { imageId: string; phase: ScanPhase }[]
}

/** What Docker untagged and deleted when an image was removed. */
export interface ImageRemoval {
  untagged: string[]
  deleted: string[]
}

/** A container that uses a volume, with where it is mounted. */
export interface VolumeMount {
  id: string
  name: string
  running: boolean
  /** the path inside the container, for example "/var/lib/postgresql/data" */
  destination: string
  readOnly: boolean
}

/** One volume on the Volumes page. `size` is filled in from the sizes query (null when unknown). */
export interface VolumeSummary {
  name: string
  driver: string
  mountpoint: string
  /** ISO 8601 time the volume was created, or null when Docker gave none */
  createdAt: string | null
  /** the Docker Compose project label, or null */
  project: string | null
  /** true for a volume Docker named with a random 64-character ID and that has no labels */
  anonymous: boolean
  /** the containers that mount the volume (each container once) */
  usedBy: { id: string; name: string; running: boolean }[]
  /** size in bytes, or null when Docker cannot tell */
  size: number | null
}

/** The details of one volume, for its details sheet. */
export interface VolumeDetails {
  name: string
  driver: string
  mountpoint: string
  createdAt: string | null
  scope: string
  labels: { key: string; value: string }[]
  options: { key: string; value: string }[]
  /** every mount of the volume, one row per container mount */
  usedBy: VolumeMount[]
}

/** A container attached to a network, with its IPv4 address (no prefix length). */
export interface NetworkContainer {
  id: string
  name: string
  ipv4: string
}

/** One network on the Networks page. */
export interface NetworkSummary {
  id: string
  /** the first 12 characters of the id */
  shortId: string
  name: string
  driver: string
  scope: string
  internal: boolean
  attachable: boolean
  ipv6: boolean
  /** the subnets of the IP address management config, for example "172.20.0.0/16" */
  subnets: string[]
  gateways: string[]
  /** the Docker Compose project label, or null */
  project: string | null
  /** true for bridge, host and none, which Docker creates itself */
  builtIn: boolean
  /** ISO 8601 time the network was created, or null when Docker gave none */
  createdAt: string | null
  containers: NetworkContainer[]
}

/** A container attached to a network, with its IPv4 and MAC addresses. */
export interface NetworkAttachment extends NetworkContainer {
  mac: string
}

/** The details of one network, for its details sheet. */
export interface NetworkDetails {
  id: string
  shortId: string
  name: string
  driver: string
  scope: string
  internal: boolean
  attachable: boolean
  ipv6: boolean
  subnets: string[]
  gateways: string[]
  builtIn: boolean
  createdAt: string | null
  options: { key: string; value: string }[]
  labels: { key: string; value: string }[]
  containers: NetworkAttachment[]
}

/** Images in the disk usage summary. Sizes are bytes. Shared layers make the unused size an estimate. */
export interface ImageUsage {
  /** the size of all image layers (Docker's LayersSize) */
  total: number
  count: number
  /** the size of the images no container uses */
  unused: number
  unusedCount: number
  /** the size of the images with no tag */
  dangling: number
  danglingCount: number
}

/** Containers in the disk usage summary. Sizes are the writable layers (SizeRw). */
export interface ContainerUsage {
  count: number
  stoppedCount: number
  /** the writable layers of all containers */
  size: number
  /** the writable layers of the stopped containers */
  stoppedSize: number
}

/** Volumes in the disk usage summary. A volume whose size Docker cannot tell adds 0. */
export interface VolumeUsage {
  total: number
  count: number
  unused: number
  unusedCount: number
  anonymousUnused: number
  anonymousUnusedCount: number
}

/** Build cache in the disk usage summary. */
export interface BuildCacheUsage {
  total: number
  count: number
  /** the cache that no build uses now */
  reclaimable: number
  reclaimableCount: number
  /** the cache that no build uses and that was last used more than a week ago */
  olderThanWeek: number
  olderThanWeekCount: number
}

/** The whole disk usage summary, from GET /system/df and the network list. */
export interface DiskUsage {
  images: ImageUsage
  containers: ContainerUsage
  volumes: VolumeUsage
  buildCache: BuildCacheUsage
  /** custom networks with no container attached (built-in networks never count) */
  unusedNetworks: number
}

/**
 * The disk usage as the server sends it. `refreshing` is true while the server reads Docker again in the
 * background, and the numbers shown are the previous answer (stale-while-revalidate).
 */
export type DiskUsageState = DiskUsage & { refreshing: boolean }

/** What one prune call removed. `spaceReclaimed` is 0 when Docker does not report a size (networks). */
export interface PruneResult {
  removed: number
  spaceReclaimed: number
}

/** The Docker Engine on this machine: its version, operating system, CPU count and memory (in bytes). */
export interface EngineInfo {
  version: string
  os: string
  cpus: number
  memTotal: number
}

/** The numbers the sidebar shows: running and all containers, and the counts of images, volumes and networks. */
export interface DockerCounts {
  containersRunning: number
  containers: number
  images: number
  volumes: number
  networks: number
}
