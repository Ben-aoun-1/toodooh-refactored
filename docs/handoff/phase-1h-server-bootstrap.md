# Phase 1h-server-bootstrap — VPS provisioning runbook

A reproducible runbook for bringing a blank Ubuntu 24.04 VPS to the state the Toodooh production
stack needs: Docker + compose plugin, a key-only `deploy` user, a default-deny firewall, hardened
SSH, and fail2ban. No application stack is started here — that is **1h-app-deploy** (the first run of
`.github/workflows/deploy.yml`). Everything below was executed once, on 2026-05-31, and is recorded
verbatim so an identical box can be rebuilt from scratch.

## Context

- **HEAD** post-1h-prep at `c7eccc1` — the prod artifact set (compose, nginx, api Dockerfile,
  deploy workflow) is in the repo; this phase prepares the VPS to run it.
- **VPS:** OVH `54.38.26.121`, Ubuntu 24.04.3 LTS (Noble), 6 vCPU / 11 GB RAM / 96 GB disk.
- **Session:** 2026-05-31, MABA-driven over SSH as `ubuntu` (passwordless sudo, granted by Kais).
- **Operating pattern:** executor proposes each command batch (1–3 commands, expected-output +
  verification + halt condition); MABA runs on the VPS and pastes output; executor validates and
  proposes the next batch. No autonomous VPS execution.
- **Goal:** a VPS ready for the app stack — Docker, `deploy` user, firewall, SSH hardened, fail2ban
  active. The deploy workflow SSHes in as `deploy` and runs `docker compose ... up -d --build`.

## Pre-flight findings

- **Access:** user `ubuntu`; groups `ubuntu adm cdrom sudo dip lxd`; `sudo -l` → `(ALL : ALL) ALL`
  plus `(ALL) NOPASSWD: ALL` (passwordless sudo to anything).
- **Listening sockets** (`sudo ss -tlnp`): only `sshd` on `:22` (IPv4+IPv6) and `systemd-resolved`
  on `127.0.0.53:53`. **80/443 free**, as the prod stack requires.
- **Packages** (`sudo apt list --installed | grep -E '(nginx|docker|postgres|mysql|ufw|fail2ban)'`):
  only `ufw` (preinstalled, **inactive**). No nginx/docker/postgres/mysql/fail2ban — no conflicts.
- **Running services:** 19 standard cloud-init services; nothing surprising. `unattended-upgrades`
  is running (Ubuntu's automatic **security** patching) — **left enabled**; it only applies security
  updates and does not contend with the manually-managed Docker stack.

## Unit A — System updates + reboot

```bash
sudo apt update
sudo apt upgrade -y
sudo apt autoremove -y
sudo reboot          # SSH disconnects; reconnect after ~30s
```

Post-reboot verification:

```bash
uname -r                          # 6.8.0-124-generic (was 6.8.0-90 — substantial kernel jump)
uptime                            # 0 min (fresh reboot)
ls /var/run/reboot-required       # absent → reboot-required flag cleared
```

**Result:** 65 updates applied (incl. 1 security update); kernel `6.8.0-90 → 6.8.0-124`;
`reboot-required` cleared.

## Unit B — Docker Engine + compose plugin (docker-ce upstream)

Installed from Docker's **upstream `docker-ce` repository** (not Ubuntu's `docker.io`), so the
`docker compose` v2 plugin and `docker buildx` ship together — both are needed by
`deploy.yml`'s `docker compose ... up -d --build`.

```bash
# 1. prerequisites
sudo apt install -y ca-certificates curl
# 2. trust the Docker GPG key
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
# 3. add the repo (noble)
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
# 4. install engine + cli + containerd + buildx + compose plugins
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
# 5. verify versions
docker --version
docker compose version
docker buildx version
# 6. enable on boot
sudo systemctl enable docker
# 7. end-to-end test
sudo docker run --rm hello-world
```

**Verified:** Docker Engine `29.5.2`, Compose plugin `v5.1.4`, Buildx `v0.34.1`; `docker` enabled
on boot; `hello-world` pulled, ran, and exited cleanly (daemon end-to-end OK).

## Unit C — Deploy user + key-only SSH

The `deploy` user is what `deploy.yml` SSHes in as. It has **no sudo** — it runs Docker through the
`docker` group, never `sudo`. Authentication is **key-only**.

```bash
sudo adduser deploy --disabled-password --gecos ""
sudo usermod -aG docker deploy                                   # docker without sudo
sudo install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
# the GitHub Actions deploy public key (private half → GitHub Secrets SSH_PRIVATE_KEY)
echo 'ssh-ed25519 AAAA…  github-actions-deploy@toodooh' \
  | sudo tee /home/deploy/.ssh/authorized_keys > /dev/null
sudo chmod 600 /home/deploy/.ssh/authorized_keys
sudo chown deploy:deploy /home/deploy/.ssh/authorized_keys
# per-user: never allow password auth for deploy
printf 'Match User deploy\n    PasswordAuthentication no\n' \
  | sudo tee /etc/ssh/sshd_config.d/deploy.conf > /dev/null
sudo systemctl reload ssh
```

**Verified:** `deploy` can SSH in with the key and run `docker ps` without sudo.

- **Keypair:** a fresh `ed25519` pair was generated locally by MABA. The **public** key sits in
  `/home/deploy/.ssh/authorized_keys`; the **private** key goes into GitHub Secrets as
  `SSH_PRIVATE_KEY` (the deploy-workflow secret). The private key never lands on the VPS.

## Unit D — `/srv/toodooh` layout

Collapsed per architect ruling: the orientation envisioned `webroot/`, `compose/`, `nginx-conf/`,
`data/postgres`, `data/minio`, but the shipped artifacts use a **flat** `/srv/toodooh/` with
**Docker named volumes** for data. `deploy.yml`'s rsync writes `www/`, `nginx/`, `apps/`,
`docker-compose.prod.yml`, and the root pnpm files flat into `/srv/toodooh/`; Postgres + MinIO data
live in the `pgdata` / `miniodata` named volumes (auto-created on first `compose up`); rsync
auto-creates the subdirs. So Unit D reduces to one directory:

```bash
sudo mkdir -p /srv/toodooh
sudo chown deploy:deploy /srv/toodooh       # so rsync (as deploy) can write
```

The production `.env` (mode 0600, deploy-owned, **never** in git or rsync'd) is hand-created here at
1h-app-deploy; the `/etc/letsencrypt` cert tree is populated at 1h-tls.

## Unit E — UFW firewall

Default-deny incoming; allow only SSH + the two ports the dockerized nginx publishes.

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

Postgres / MinIO / api are never published (internal compose bridge), so no other ports open.

## Unit F — SSH hardening (with findings)

> **KEY FINDING — OpenSSH applies the FIRST matching directive in load order, not the last.**
> Higher-numbered `sshd_config.d/*.conf` snippets only win for directives **not yet defined** by an
> earlier file. To override a directive an earlier file already set, you must edit the **earlier**
> file — adding a later, higher-numbered file does nothing for that directive.

The Ubuntu cloud image ships layered and **contradictory** SSH config:

| File (load order) | `PasswordAuthentication` | Effect |
| --- | --- | --- |
| `50-cloud-init.conf` | `yes` | **FIRST → wins** by default |
| `60-cloudimg-settings.conf` | `no` | ignored (50- already set it) |
| `99-toodooh-hardening.conf` (added) | `no` | ignored (50- already set it) |

**Resolution** — comment out the line in the *earliest* file:

```bash
# add our hardening snippet
printf 'PermitRootLogin no\nPasswordAuthentication no\nPubkeyAuthentication yes\n' \
  | sudo tee /etc/ssh/sshd_config.d/99-toodooh-hardening.conf > /dev/null
# neutralise the 50- override so 60- (no) becomes first-in-order and 99- agrees
sudo sed -i \
  's/^PasswordAuthentication yes/#PasswordAuthentication yes  # disabled by toodooh hardening/' \
  /etc/ssh/sshd_config.d/50-cloud-init.conf
# verify EFFECTIVE config — NOT the per-file declarations
sudo sshd -T | grep -Ei 'permitrootlogin|passwordauthentication|pubkeyauthentication'
sudo systemctl reload ssh
```

> **Verify with `sshd -T` (effective merged config), not by reading each file** — declared values
> in individual files are not the effective config once first-match precedence is in play.

**Final effective state** (per `sshd -T`): `permitrootlogin no`, `passwordauthentication no`,
`pubkeyauthentication yes`.

- **Lockout-avoidance:** before disabling password auth, MABA's access key
  (`mabenaoun@toodooh-ubuntu`) was added to `/home/ubuntu/.ssh/authorized_keys`. MABA had been
  signing in by password; the only prior key entry was Kais's. Two key paths now exist for `ubuntu`
  (MABA's + Kais's), so disabling password auth does not lock anyone out.

## Unit G — fail2ban

```bash
sudo apt install -y fail2ban
sudo systemctl enable fail2ban
sudo systemctl status fail2ban       # active (running)
sudo fail2ban-client status sshd     # jail state
```

Installed from the Ubuntu repo; systemd-enabled; the default `sshd` jail is active (ban after 5
failures in 10 min → 10-min ban, watching the systemd journal).

- **Empirical validation:** **5 IPs banned within 22 seconds** of fail2ban startup, across 44 total
  failed attempts. The public SSH port faces constant botnet probing — this justifies the install
  decision outright (it was not a hypothetical hardening step).

## Final verification state

| Component | State | Verified by |
| --- | --- | --- |
| OS / kernel | Ubuntu 24.04.3 LTS, kernel `6.8.0-124-generic` | `uname -r` |
| Updates | 65 applied (1 security); reboot-required clear | `apt`, reboot, `/var/run/reboot-required` |
| Docker Engine | `29.5.2`, enabled on boot | `docker --version`, `systemctl is-enabled docker` |
| Compose plugin | `v5.1.4` | `docker compose version` |
| Buildx | `v0.34.1` | `docker buildx version` |
| Docker E2E | `hello-world` pull+run+exit OK | `sudo docker run --rm hello-world` |
| `deploy` user | exists; in `docker` group; key-only; **no sudo** | `id deploy`; key SSH + `docker ps` |
| `/srv/toodooh` | owned `deploy:deploy` | `ls -ld /srv/toodooh` |
| Firewall | UFW active: deny in / allow out / 22,80,443 | `sudo ufw status verbose` |
| SSH | `PermitRootLogin no`, `PasswordAuthentication no`, `PubkeyAuthentication yes` | `sudo sshd -T` |
| fail2ban | active; `sshd` jail; 5 IPs banned in 22 s | `sudo fail2ban-client status sshd` |

## Tracked for later (not blocking)

- **Cloud-init may rewrite `50-cloud-init.conf`** on certain triggers (cloud-init re-run, image
  refresh), undoing the `PasswordAuthentication` disable. If observed, drop
  `/etc/cloud/cloud.cfg.d/99-disable-ssh.cfg` to disable cloud-init's ssh module. **Slice 1: accept
  the risk** — cloud-init re-runs are rare on a long-lived VPS.
- **`ubuntu`'s `NOPASSWD: ALL` sudo** is convenient for bootstrap but loose for long-term ops.
  Slice-2 hardening: require a sudo password.
- **`deploy` has no sudo by design** — it runs Docker via the `docker` group, not sudo. (Membership
  in `docker` is itself root-equivalent on the host; acceptable for the deploy user whose sole job is
  running the stack.)

## Methodology notes (audit candidates for the 1h refresh)

**CF candidate — verify EFFECTIVE config on cloud-image hardening, not per-file declared values.**
Cloud images often ship layered, contradictory `sshd_config.d/*.conf` files; OpenSSH's
first-match-wins precedence means a later, higher-numbered file may silently fail to override an
earlier one for the same directive. Always confirm with the tool's effective-config dump
(`sshd -T` for OpenSSH) rather than reading the individual snippet files. To change a directive an
earlier file set, edit that earlier file.

**CF candidate — training-cutoff priors lose to VPS-reported reality; verify, don't assume.** During
Unit B the executor flagged the reported `docker compose version v5.1.4` as "impossible" — its prior
held that Compose was on the v2.x plugin track. That prior was a stale training-cutoff artifact:
Compose rebased its major version (skipping v3.0/v4.0 to avoid collision with the legacy
docker-compose *file-format* versions), and **v5.1.x is the current v2-plugin line as of May 2026**,
confirmed against current docker.com docs (the v5.1.2 manual-install URL) + the Compose release
notes. The **halt was correct discipline** — surfacing an anomaly before an irreversible push to
`main` is exactly the gate working — even though the specific finding was a stale prior, not a real
error. The transferable pattern: when an executor's prior disagrees with a VPS- (or tool-) reported
value, the architect verifies the *current* state against authoritative sources and reality wins.
A model's "this looks wrong" is a reason to **verify**, never a reason to silently overwrite an
observed value.
