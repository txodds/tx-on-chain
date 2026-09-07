#!/bin/bash
# Starts (or reuses) the merkle-postgres container defined in
# tx-solana-publisher/docker/docker-compose-postgres.yml, so the resource
# server demo (README's "Run the subscription demo" section) doesn't require
# a manual `docker compose up -d` every session. Guarded the same way as
# start-solana-sidecar.sh: a no-op if the container is already running.
set -e

SCRIPTDIR="$(readlink -f "$(dirname "$0")")"
REPO_ROOT="$(readlink -f "$SCRIPTDIR/..")"
COMPOSE_FILE="$REPO_ROOT/tx-solana-publisher/docker/docker-compose-postgres.yml"
CONTAINER_NAME="merkle-postgres"

if docker ps --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  echo "merkle-postgres already running."
  exit 0
fi

docker compose -f "$COMPOSE_FILE" up -d

echo "merkle-postgres started."
