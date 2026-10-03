# Setup guide: run SmartCart on your computer

## 1. What you need

| Tool | Why | Check |
|---|---|---|
| Docker Desktop (Windows / Mac) or Docker Engine (Linux) | runs everything | `docker --version` and `docker compose version` |
| Node.js 20 or newer | only for the tests and the demo scripts | `node --version` |
| Git | to keep the project on GitHub | `git --version` |

Memory: the whole system runs about 12 containers. Give Docker **at least 4 GB of RAM**
(Docker Desktop: Settings > Resources). With less, Kafka or MongoDB may stop.

You do **not** need a Stripe, OpenAI or email account to run the project. Every one of them has a built-in fallback (see step 2).

## 2. Configure the `.env` file

```bash
cp .env.example .env              # Windows PowerShell: copy .env.example .env
```

Open `.env` in a text editor and change at least these two:

| Setting | What to put |
|---|---|
| `POSTGRES_PASSWORD` | any password, letters and numbers only |
| `JWT_SECRET` | any long random text (32+ characters) |

Optional settings:

| Setting | Empty means | To use the real thing |
|---|---|---|
| `STRIPE_SECRET_KEY` | **mock payments** (instant, no account) | create a free Stripe account, turn on *Test mode*, copy the secret key that starts with `sk_test_` |
| `OPENAI_API_KEY` | **simple word-matching fallback** for recommendations (not AI) | create a key at platform.openai.com. Cost for 14 products is a fraction of a cent |
| `SMTP_HOST` etc. | emails are **printed in the log** | for Gmail: host `smtp.gmail.com`, port `587`, your address, and a Google *App Password* |
| `ADMIN_EMAIL` | n/a | the account you register with this email becomes admin |

> If your resume says "AI-powered recommendations using OpenAI", put a real `OPENAI_API_KEY` in `.env` and run the seed command (step 4) once, so the stored vectors really come from OpenAI. The seed log prints `embedding: openai` or `embedding: local` for each product.

## 3. Start everything

```bash
docker compose up --build -d
```

The first run downloads images and builds 8 images: 5 to 10 minutes. Then check:

```bash
docker compose ps
```

Wait until every line says `healthy` (Kafka needs about a minute). If something stays `starting`, see Troubleshooting below.

## 4. Add the sample products

```bash
docker compose exec product-service node src/seed.js
```

This creates 14 products. Running it again resets their stock to the starting values.

## 5. Use it

Open **http://localhost:3100**

1. Click *Create account* and register.
2. Open a product. Notice the *You may also like* row (recommendations).
3. Add products to the cart and go to *Checkout*.
4. Pick **Test card: payment succeeds** and place the order. The order page updates by itself from *Processing* to *Order confirmed*.
5. Place another order and pick **Test card: card is declined**. The order page ends as *Order cancelled*. Go back to the product: its stock is the same as before. That is the "stock is restored" feature.
6. *Smart Fitness Watch* only has 3 in stock. Try to buy 5 to see the out-of-stock message.
7. Open a few products several times. The *Trending now* shelf on the home page changes.

### Run the same story from the command line

```bash
node scripts/demo.js           # success, declined card with stock restore, out of stock
node scripts/demo.js outage    # circuit breaker demo (mock payments only)
node scripts/measure-cache.js  # measures the Redis cache hit ratio
```

### Watching the services work

```bash
docker compose logs -f order-service payment-service notification-service product-service
```

You will see the events travel: `published ORDER_PLACED`, `received ORDER_PLACED`, `PAID`, `CONFIRMED`, the email, and for a cancelled order `stock restored`.

Check the circuit breaker state: open http://localhost:3005/health

## 6. Run the tests

Each service has tests that need no database (they use small fakes). From the project folder:

**Mac / Linux / Git Bash**
```bash
for s in api-gateway auth-service product-service cart-service order-service payment-service notification-service; do
  (cd $s && npm ci && npm test)
done
```

**Windows PowerShell**
```powershell
foreach ($s in "api-gateway","auth-service","product-service","cart-service","order-service","payment-service","notification-service") {
  Push-Location $s; npm ci; npm test; Pop-Location
}
```

## 7. Admin: add a product

Register with the email you set as `ADMIN_EMAIL`, copy your token from the browser
(DevTools > Application > Local Storage > `smartcart_session`), then:

```bash
curl -X POST http://localhost:8080/api/products \
  -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Desk Fan","price":1499,"category":"home","stock":20,"emoji":"🌀","description":"Quiet table fan with three speeds."}'
```

## 8. Everyday commands

| Task | Command |
|---|---|
| Stop everything (keep data) | `docker compose down` |
| Start again | `docker compose up -d` |
| Rebuild after code changes | `docker compose up --build -d` |
| Delete ALL data and start fresh | `docker compose down -v` |
| See the log of one service | `docker compose logs -f order-service` |
| Open the Redis shell | `docker compose exec redis redis-cli` |

## 9. Troubleshooting

| Problem | What to do |
|---|---|
| `Please create the .env file first` | you skipped step 2: copy `.env.example` to `.env` |
| `port is already allocated` | another program uses 3100, 8080 or 3005. Change `FRONTEND_PORT` or `GATEWAY_PORT` in `.env` |
| Kafka stays `unhealthy` | give Docker more memory (4 GB+) and run `docker compose logs kafka` |
| A service restarts again and again | `docker compose logs <service>`. The most common reason is a typo in `.env` |
| Website is empty | run the seed command (step 4) |
| Order stays `PENDING` forever | `docker compose logs payment-service`. The payment service may still be starting, or Kafka is down. Pending orders finish when the service is back |
| `docker compose build` fails while downloading | network problem, run the command again |
| "Too many requests" | raise `RATE_LIMIT_PER_MIN` in `.env` and run `docker compose up -d` |
| Changed `.env` but nothing changed | run `docker compose up -d` again so containers are recreated |

## 10. Put it on GitHub

```bash
git init
git add .
git commit -m "SmartCart"
git branch -M main
git remote add origin https://github.com/YOUR_NAME/smartcart.git
git push -u origin main
```

`.env` is in `.gitignore`, so your passwords and keys are not uploaded. Never remove it from there.
