FROM rust:1.88-slim AS builder

WORKDIR /usr/src/backend

RUN apt-get update && \
    apt-get install -y pkg-config libssl-dev ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY backend/Cargo.toml ./
COPY backend/src ./src

RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app
COPY --from=builder /usr/src/backend/target/release/paperlens-api ./paperlens-api

EXPOSE 8080
CMD ["./paperlens-api"]
