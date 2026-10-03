#!/usr/bin/env bash
# Run this ONCE on a fresh Ubuntu EC2 server (22.04 or 24.04):
#     bash ec2-setup.sh
# It installs Docker, rsync and adds 2 GB of swap (extra memory on small servers).
set -euo pipefail

echo "==> Installing packages"
sudo apt-get update -y
sudo apt-get install -y rsync curl

echo "==> Installing Docker"
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"

echo "==> Adding 2 GB swap"
if ! swapon --show | grep -q '/swapfile'; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab > /dev/null
fi

mkdir -p "$HOME/smartcart"

echo
echo "Done. IMPORTANT: log out and log in again so Docker works without sudo."
echo "Next: create ~/smartcart/.env  (see docs/DEPLOY-AWS.md, step 4)."
