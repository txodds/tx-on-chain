FROM ubuntu:24.04

RUN apt-get update && apt-get install -y \
    curl \
    wget \
    build-essential \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y

# Install Solana CLI
RUN curl -sSfL https://release.solana.com/stable/install | sh

# Add to PATH
ENV PATH="/root/.local/share/solana/install/active_release/bin:/root/.cargo/bin:${PATH}"

# Create ubuntu user to match devcontainer
RUN useradd -m -u 1000 ubuntu

WORKDIR /workspaces/tx-on-chain
