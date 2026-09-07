#!/bin/bash
# Runs once when the devcontainer is created: installs the JVM/Scala, Node,
# and Rust toolchains, wires up the solana-tool-wrappers PATH shim, and
# starts the solana-sidecar container (see start-solana-sidecar.sh).
set -e

SCRIPTDIR="$(readlink -f "$(dirname "$0")")"

sudo apt-get update
sudo apt-get install -y \
  maven curl build-essential gnupg \
  libssl-dev pkg-config libudev-dev clang libclang-dev

curl -fsSL https://download.bell-sw.com/pki/GPG-KEY-bellsoft | sudo gpg --dearmor -o /etc/apt/trusted.gpg.d/bellsoft.gpg
echo "deb https://apt.bell-sw.com/ stable main" | sudo tee /etc/apt/sources.list.d/bellsoft.list > /dev/null

curl -fsSL "https://keyserver.ubuntu.com/pks/lookup?op=get&search=0x2EE0EA64E40A89B84B2DF73499E82A75642AC823" | sudo gpg --dearmor -o /etc/apt/trusted.gpg.d/scalasbt-release.gpg
echo "deb https://repo.scala-sbt.org/scalasbt/debian all main" | sudo tee /etc/apt/sources.list.d/sbt.list > /dev/null
echo "deb https://repo.scala-sbt.org/scalasbt/debian /" | sudo tee /etc/apt/sources.list.d/sbt_old.list > /dev/null

sudo apt-get update
sudo apt-get install -y bellsoft-java25 sbt

curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs
sudo npm install --global yarn@1.22.22

curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y

echo "export PATH=\"\$PATH:\$HOME/.cargo/bin:$SCRIPTDIR/solana-tool-wrappers\"" | sudo tee /etc/profile.d/solana-anchor-path.sh > /dev/null
sudo chmod +x /etc/profile.d/solana-anchor-path.sh
echo '. /etc/profile.d/solana-anchor-path.sh' >> "$HOME/.bashrc"

git config --global --add safe.directory "$SCRIPTDIR/.."

"$SCRIPTDIR/start-solana-sidecar.sh"

