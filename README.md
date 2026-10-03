# SmartCart

An e-commerce platform built as seven small services that work together.
Customers browse products, add them to a cart, and pay. If the payment fails, the stock goes back on the shelf by itself.

**Stack:** Node.js, Express, PostgreSQL, MongoDB, Redis, Apache Kafka, Stripe, OpenAI embeddings, Next.js (React), Docker, GitHub Actions, AWS EC2.

## The big picture

```
 Browser
    |
    v
 frontend (Next.js, port 3100)          only this is public
    |  /api/*
    v
 api-gateway (checks login, rate limit)
    |-------------|--------------|--------------|
    v             v              v              v
 auth-service  product-service  cart-service  order-service
 PostgreSQL    MongoDB+Redis    Redis          PostgreSQL
                                                  |
        Kafka events:                             |  order.placed
   order.placed -> payment-service (Stripe) -> payment.completed / payment.failed
                                                  |
   order-service updates the order -> order.confirmed / order.cancelled
        |                                   |
 notification-service (email)      product-service (gives stock back)
```

The 7 services: **api-gateway, auth-service, product-service, cart-service, order-service, payment-service, notification-service**. The frontend is the website.

## What the resume says, and where it lives

| Resume claim | Where to see it |
|---|---|
| 7 independent microservices | one folder per service, each with its own Dockerfile and database |
| Stock is restored if payment fails | `product-service/src/stock.js`, `order-service/src/orders.js`, Kafka topics |
| Stripe with retry protection (no duplicate payments) | `payment-service/src/payments.js` and `stripeClient.js` |
| Reduced payment response time | circuit breaker in `payment-service/src/payments.js` |
| Redis caching, 80% less database load | `product-service/src/cache.js` and `scripts/measure-cache.js` |
| Live trending-products leaderboard | Redis sorted set in `product-service/src/cache.js` |
| AI recommendations with OpenAI | `product-service/src/embeddings.js` |
| Testing and deployment with GitHub Actions, Docker, AWS | `.github/workflows/ci-cd.yml`, `docker-compose.yml`, `docs/DEPLOY-AWS.md` |

## Quick start

```bash
cp .env.example .env              # Windows PowerShell: copy .env.example .env
# open .env and set POSTGRES_PASSWORD and JWT_SECRET
docker compose up --build -d      # first run takes 5 to 10 minutes
docker compose exec product-service node src/seed.js
```

Open **http://localhost:3100**. Full instructions: [docs/SETUP.md](docs/SETUP.md).

## Documents

- [docs/SETUP.md](docs/SETUP.md): run it on your computer, configuration, demo, tests, troubleshooting
- [docs/DEPLOY-AWS.md](docs/DEPLOY-AWS.md): put it on AWS with GitHub Actions
- [docs/EXPLAIN.md](docs/EXPLAIN.md): every concept in simple words, with interview answers

## Folder map

```
smartcart/
  docker-compose.yml        starts everything
  .env.example              all settings (copy to .env)
  .github/workflows/        CI/CD pipeline
  api-gateway/              entry point: JWT check, rate limit, routing
  auth-service/             register, login (PostgreSQL)
  product-service/          products, cache, trending, stock, recommendations (MongoDB, Redis)
  cart-service/             cart in a Redis Hash
  order-service/            orders, outbox, saga (PostgreSQL, Kafka)
  payment-service/          Stripe, circuit breaker, idempotency (Kafka)
  notification-service/     emails (Kafka)
  frontend/                 Next.js website
  scripts/                  demo.js, measure-cache.js, ec2-setup.sh
  docs/                     the guides
```

Each service has a `test/` folder (`npm test`, no database needed).
