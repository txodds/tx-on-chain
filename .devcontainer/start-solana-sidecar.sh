#!/bin/bash
# Starts (or reuses) a long-lived "solana-sidecar" container built from
# localnet/solana/Dockerfile, so devcontainer shells can run anchor/solana/etc.
# via thin PATH wrappers (see solana-tool-wrappers/) instead of native
# arm64 installs, which Anza/Agave doesn't ship (see memory: no
# aarch64-unknown-linux-gnu build exists for the Solana CLI).
set -e

SCRIPTDIR="$(readlink -f "$(dirname "$0")")"
REPO_ROOT="$(readlink -f "$SCRIPTDIR/..")"
CONTAINER_NAME="solana-sidecar"

if docker ps --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  echo "solana-sidecar already running."
  exit 0
fi

docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true

# Use the pre-built solana image if available, otherwise build from Dockerfile
if docker images --format "{{.Repository}}:{{.Tag}}" | grep -q "^solana:latest$"; then
  IMAGE_TAG="solana:latest"
else
  docker build --platform=linux/amd64 -t solana "$REPO_ROOT/localnet/solana"
  IMAGE_TAG="solana"
fi

DEVCONTAINER_ID="$(hostname)"

docker run -d --name "$CONTAINER_NAME" \
  --platform=linux/amd64 \
  --volumes-from "$DEVCONTAINER_ID" \
  --network=host \
  --restart unless-stopped \
  -w "$REPO_ROOT" \
  "$IMAGE_TAG" \
  sleep infinity

echo "solana-sidecar started."
