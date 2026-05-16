#!/usr/bin/env bash
set -euo pipefail

# Bootstrap a fresh Ubuntu 24.04 VPS for DevPinger production.
# Idempotent — safe to re-run. Designed for Hetzner Cloud CX-line servers.
#
# Run as root on the target server:
#   curl -fsSL https://raw.githubusercontent.com/Guck111/devpinger/main/infra/setup-server.sh | bash
# Or after cloning the repo to /opt/devpinger:
#   bash /opt/devpinger/infra/setup-server.sh

if [[ $EUID -ne 0 ]]; then
	echo "This script must be run as root" >&2
	exit 1
fi

log() { echo -e "\n\033[1;36m==> $*\033[0m"; }

log "Updating apt and installing base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq \
	ca-certificates curl wget gnupg lsb-release \
	htop tmux git ufw fail2ban unattended-upgrades \
	rsync tzdata

log "Setting timezone to UTC"
timedatectl set-timezone UTC

log "Configuring 2GB swap (if not already present)"
if [[ ! -f /swapfile ]]; then
	fallocate -l 2G /swapfile
	chmod 600 /swapfile
	mkswap /swapfile >/dev/null
	swapon /swapfile
	echo "/swapfile none swap sw 0 0" >> /etc/fstab
	echo "vm.swappiness=10" > /etc/sysctl.d/99-swap.conf
	sysctl -p /etc/sysctl.d/99-swap.conf >/dev/null
fi

log "Setting hostname to devpinger-prod"
hostnamectl set-hostname devpinger-prod
if ! grep -q "devpinger-prod" /etc/hosts; then
	echo "127.0.1.1 devpinger-prod" >> /etc/hosts
fi

log "Installing Docker CE (if missing)"
if ! command -v docker >/dev/null 2>&1; then
	curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

log "Configuring unattended-upgrades for security patches"
cat > /etc/apt/apt.conf.d/50unattended-upgrades <<'EOF'
Unattended-Upgrade::Allowed-Origins {
	"${distro_id}:${distro_codename}-security";
	"${distro_id}ESMApps:${distro_codename}-apps-security";
	"${distro_id}ESM:${distro_codename}-infra-security";
};
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Automatic-Reboot-Time "04:00";
EOF
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF

log "Configuring fail2ban for SSH brute-force protection"
cat > /etc/fail2ban/jail.d/sshd.local <<'EOF'
[sshd]
enabled = true
port    = 22
filter  = sshd
maxretry = 3
findtime = 10m
bantime  = 1h
EOF
systemctl enable --now fail2ban
systemctl restart fail2ban

log "Hardening SSH (key-only auth, no root password login)"
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
sed -i 's/^#\?ChallengeResponseAuthentication.*/ChallengeResponseAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?UsePAM.*/UsePAM yes/' /etc/ssh/sshd_config
# Drop cloud-init overrides that re-enable password auth on Hetzner images
rm -f /etc/ssh/sshd_config.d/50-cloud-init.conf
systemctl reload ssh

log "Cleaning apt cache"
apt-get autoremove -y -qq
apt-get autoclean -qq

log "Done."
echo
echo "Summary:"
echo "  hostname: $(hostname)"
echo "  docker:   $(docker --version)"
echo "  compose:  $(docker compose version --short)"
echo "  swap:     $(free -h | awk '/^Swap:/ {print $2}')"
echo "  uptime:   $(uptime -p)"
echo
echo "Next steps:"
echo "  1. Clone the repo:  git clone https://github.com/Guck111/devpinger.git /opt/devpinger"
echo "  2. Copy .env.prod:  scp .env.prod root@<this-host>:/opt/devpinger/.env.prod"
echo "  3. Bring up stack:  cd /opt/devpinger && bash infra/deploy.sh"
