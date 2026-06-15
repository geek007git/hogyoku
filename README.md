# Hogyoku RAG

[![CI](https://github.com/geek007git/hogyoku/actions/workflows/ci.yml/badge.svg)](https://github.com/geek007git/hogyoku/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Hogyoku is a multimodal RAG web application for private research libraries. It
ingests PDFs, scans, images, Markdown, CSV, JSON, and plain text; performs OCR
and visual extraction; runs hybrid retrieval; and returns cited answers with a
separate claim-verification pass.

## Architecture

- **Web/API:** Fastify and a dependency-free browser client
- **Database:** PostgreSQL with `pgvector`, HNSW, and full-text search
- **Jobs:** BullMQ on Redis with retry and backoff
- **Files:** Private S3-compatible object storage
- **Parsing:** PDF.js, Sharp, and Tesseract
- **Models:** Google Gemini chat, vision, and embeddings
- **Security:** Scrypt passwords, opaque hashed sessions, secure cookies,
  origin checks, rate limits, CSP, upload limits, and per-user data isolation

## Quick Start

1. Read [SETUP_REQUIRED.md](SETUP_REQUIRED.md).
2. Optionally create `.env` and set `GEMINI_API_KEY`.
3. Start the complete stack:

```powershell
docker compose up --build
```

4. Open `http://localhost:4173` and create an account.

The application works without a model key using deterministic local embeddings
and extractive answers. Configure a provider key for generated and independently
verified answers.

On Linux, macOS, WSL, or Git Bash, bootstrap development with:

```bash
./scripts/bootstrap.sh
```

## Local Development

Start infrastructure:

```powershell
docker compose up postgres redis minio minio-init
```

Copy `.env.example` to `.env`, changing hostnames to `localhost`, then run:

```powershell
cmd /c npm run db:migrate
cmd /c npm run dev
cmd /c npm run dev:worker
```

## Quality Checks

```bash
./scripts/verify.sh
```

CI runs TypeScript checks, Node tests, dependency auditing, Bash syntax checks,
Compose validation, and Python retrieval evaluation on every pull request.

## Retrieval Evaluation

The dependency-free Python evaluator reports recall at configurable cutoffs and
mean reciprocal rank from JSONL retrieval output:

```bash
python scripts/evaluate_retrieval.py evaluations/example.jsonl
python scripts/evaluate_retrieval.py results.jsonl --k 1 5 10 20
```

Each JSONL row contains `question`, `relevant_ids`, and `retrieved_ids`.

## Request Lifecycle

1. The API validates and stores an uploaded file in a private object bucket.
2. A BullMQ job extracts PDF text or performs image OCR and visual description.
3. Page-aware overlapping chunks receive embeddings and full-text indexes.
4. A question runs semantic and lexical retrieval with reciprocal-rank fusion.
5. The model produces citation-marked claims using retrieved evidence only.
6. A second pass checks each claim for entailment and citation completeness.
7. Unsupported drafts are withheld instead of being presented as reliable.

## Deployment

Build one container image and deploy it twice:

- Web: `node dist/src/db/migrate.js && node dist/src/server.js`
- Worker: `node dist/src/worker.js`

Use managed PostgreSQL with the `vector` extension, managed Redis, and private
S3-compatible storage. Set all values from `.env.example` in the deployment
secret manager. Run at least one worker independently from the web service so
OCR cannot block HTTP traffic.

For a Compose deployment with environment validation and health checks:

```bash
./scripts/deploy.sh
```

## Repository Layout

```text
.
|-- public/               Browser application
|-- src/
|   |-- db/               PostgreSQL client and migrations
|   |-- http/             Auth, document, and thread APIs
|   |-- lib/              Storage, sessions, jobs, and chunking
|   `-- services/         Extraction, retrieval, generation, verification
|-- scripts/              Bash operations and Python evaluation tools
|-- evaluations/          Retrieval benchmark datasets
|-- tests/                Node test suite
|-- docker-compose.yml    Complete local service topology
`-- Dockerfile            API and worker container image
```
