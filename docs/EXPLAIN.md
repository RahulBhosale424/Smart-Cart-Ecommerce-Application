# SmartCart explained in simple words

Read this top to bottom once, then use it as your cheat sheet before interviews.
Every section has: the **problem**, a **simple picture**, **where it is in the code**, and **what to say**.

---

## 0. The 30-second story (say this first)

"SmartCart is an online shop built as seven small services. A customer browses products, adds them to a cart, and places an order. The order service saves the order and reserves the stock, then asks the payment service to charge the card through Kafka. If the payment works, the order is confirmed and an email is sent. If it fails, the order is cancelled and the stock goes back automatically. Redis makes the product pages fast, the circuit breaker protects us when Stripe has problems, and everything runs in Docker and is deployed to AWS by GitHub Actions."

---

## 1. What happens when a customer places an order (know this by heart)

1. The browser calls `POST /api/orders`. The frontend passes it to the **api-gateway**.
2. The gateway checks the login token (JWT) and forwards the request with the user id.
3. **order-service** asks **cart-service** for the cart.
4. order-service asks **product-service** to **reserve the stock**. This is one atomic database step: "reduce the stock only if there is enough". The product service also returns the real price from its own database. The customer's cart price is never trusted.
5. order-service saves the order **and** an `order.placed` message in the same database transaction (this is the outbox, section 8). The order is `PENDING`. The customer gets an answer immediately.
6. A small worker in order-service sends the message to **Kafka**.
7. **payment-service** receives `order.placed`, checks Redis "did I already handle this order?", then charges Stripe through the circuit breaker.
8. It publishes `payment.completed` or `payment.failed`.
9. order-service receives that result and changes the status: `CONFIRMED` or `CANCELLED`, and writes the next message (`order.confirmed` / `order.cancelled`) in the same transaction.
10. **notification-service** emails the customer.
11. If it was cancelled, **product-service** receives `order.cancelled` and adds the stock back (only once per order).
12. The order page in the browser asks for the status every 1.5 seconds and shows the result.

---

## 2. Microservices and one database per service

- **Problem:** in one big program a bug in payments can bring down the product pages, and everything must be scaled together.
- **Picture:** a restaurant with separate stations (orders, kitchen, cashier). If the cashier is busy, the kitchen keeps cooking.
- **In the code:** one folder per service, each with its own `Dockerfile`. Auth and orders use PostgreSQL, products use MongoDB, carts use Redis. No service reads another service's database; they ask through HTTP or Kafka.
- **Say:** "I split by responsibility. Each service owns its data, so they can fail and scale independently. The price of this is more moving parts and the need to keep data consistent across services, which I handled with events, the saga and the outbox."
- **Be honest:** for a small team a single application is simpler. I chose microservices to learn these patterns.

Why different databases: orders need safe transactions (PostgreSQL). Products differ a lot by category, a phone has RAM and a shirt has a size (MongoDB). Carts are temporary and need speed (Redis).

---

## 3. API gateway and login (JWT)

- **Problem:** the website should not know seven addresses, and every service should not repeat the login check.
- **Picture:** the reception desk of a building. Visitors show their ID once, then reception sends them to the right office.
- **In the code:** `api-gateway/src/auth.js` and `index.js`.
- **How login works:** `auth-service` checks the password (stored as a **bcrypt** hash, never the real password) and returns a **JWT**, a signed token that says who you are. The browser sends it in every request. The gateway verifies the signature, then forwards the user id to the services in headers (`x-user-id`, `x-user-role`).
- **Security detail worth saying:** the gateway first **deletes** any `x-user-*` headers sent by the client, so nobody can pretend to be an admin by sending a fake header.
- **Internal endpoints** (`/internal/reserve`) live outside the `/products` path that the gateway exposes, so the outside world cannot call them.
- **Say:** "JWT is verified once at the gateway. Services trust the gateway because they are on a private Docker network."

---

## 4. Redis cache (the "80%" bullet)

- **Problem:** every product page read would hit MongoDB.
- **Picture:** a notebook on your desk with the answers you looked up today, so you do not walk to the library each time.
- **Cache-aside:** look in Redis first. If found (**HIT**), return it. If not (**MISS**), read MongoDB, save the answer in Redis with an expiry, return it. See `getOrSet` in `product-service/src/cache.js`. The response header `X-Cache: HIT` or `MISS` lets you watch it.
- **Expiry (TTL):** product 10 minutes, list 2 minutes. A little random extra time (jitter) is added so many keys do not all expire at the same second (a "cache stampede").
- **Keeping it correct:** when stock or a product changes, the old copies are deleted. Lists are found with **SCAN**, not KEYS. KEYS reads the whole Redis in one go and freezes it (Redis is single-threaded); SCAN reads a few keys at a time.
- **If Redis is down:** every Redis call is wrapped in a safe function, so the API falls back to MongoDB. Slower, but working.
- **Where the number comes from:** `scripts/measure-cache.js` reads the hit and miss counters and prints the hit ratio. Every HIT is one MongoDB read that did not happen. **Run it and put your own measured number on the resume.** If you get 85%, say 85%.
- **Say:** "I measured the cache hit ratio with counters in Redis under a read-heavy browsing test. Each hit saves a database read, so the database load dropped by roughly that percentage. The exact value depends on the traffic."

## 5. Trending products leaderboard (Redis Sorted Set)

- **Picture:** a scoreboard that re-sorts itself.
- **How:** each product view runs `ZINCRBY trending:products 1 <productId>`. The top list is `ZREVRANGE`. Redis keeps it sorted all the time, so reading the top 8 is very fast and needs no database query.
- **In the code:** `trackView` and `topTrending` in `cache.js`.
- **Limit to admit:** it counts all-time views. A better version would use a time window or decay.

---

## 6. Stock: reserve and restore (the first resume bullet)

- **Problem 1, overselling:** two customers buy the last item at the same moment.
- **Fix:** one atomic MongoDB update: "reduce stock by qty **only if** stock >= qty". MongoDB runs this as a single operation, so only one of them wins. See `reserveItems` in `product-service/src/stock.js`.
- **Problem 2, order has 3 items and the second one is out of stock:** the items already taken are put back at once.
- **Problem 3, payment fails later:** the order becomes `CANCELLED` and `order.cancelled` carries the item list. product-service adds the quantities back. A Redis key `stock:restored:<orderId>` makes sure it is done only once even if Kafka delivers the message twice.
- **Say:** "Stock is reserved at order time with an atomic conditional update. If the payment fails, a cancellation event restores it, and the restore is idempotent."

---

## 7. Kafka, events and the Saga

- **Problem:** if the order service called the payment service directly and payment was down, the order would fail on the spot.
- **Picture (Kafka):** a message board. The order service pins a note, the payment service reads it when it is ready. Notes stay on the board even if the reader is away.
- **Topics:** `order.placed`, `payment.completed`, `payment.failed`, `order.confirmed`, `order.cancelled`.
- **Key = orderId:** all messages of one order go to the same partition, so they are read in the right order.
- **Saga:** a database transaction cannot cover several services. A saga is a chain of steps where each step has an undo. Here: reserve stock, then charge. The undo of "reserve stock" is "restore stock". Mine is **choreography**: no boss, each service reacts to events. (The other style, **orchestration**, has one coordinator that tells every service what to do.)
- **At-least-once delivery:** Kafka may deliver a message twice. So every handler is safe to run twice (section 9).
- **In the code:** `shared kafka.js` in each service, `order-service/src/consumer.js`, `payment-service/src/consumer.js`.

## 8. The outbox pattern (the "save and send" problem)

- **Problem:** saving an order and sending a Kafka message are two different systems. If the service crashes between them, you get an order that nobody charges, or a message for an order that does not exist.
- **Picture:** instead of posting the letter yourself, you put it in the "to send" tray together with the order paper in one move. A clerk empties the tray later.
- **How:** order-service writes the message into an `outbox` table **in the same transaction** as the order. A worker (`outbox.js`) sends unsent rows to Kafka and marks them sent only after Kafka accepts. If it crashes after sending but before marking, the message is sent again (a duplicate, which is fine).
- **Say:** "An order can never exist without its event, and Kafka being down only delays the message."
- **Limit:** one worker is assumed. With several order-service copies, duplicates could be sent. Consumers handle duplicates anyway.

---

## 9. Idempotency (no duplicate charges, no double restore)

**Idempotent** = doing it twice has the same effect as doing it once.

| Place | How |
|---|---|
| Payment, layer 1 | Redis key `payment:result:<orderId>` is checked before Stripe is called |
| Payment, layer 2 | Stripe gets the idempotency key `smartcart-order-<orderId>`, so Stripe itself will not charge twice |
| Order status | `UPDATE ... WHERE status = 'PENDING'`: a second identical message matches no row and does nothing |
| Stock restore | Redis `SET ... NX`: only the first caller wins |

- **Real example:** the app calls Stripe, the charge succeeds, but the answer is lost in a network timeout. The app retries. Without idempotency the customer pays twice.
- **Why two layers for payment:** layer 1 is fast and saves a call. Layer 2 covers the rare moment when two copies of the message run at the same time, before layer 1 has saved anything.

---

## 10. Circuit breaker (the "reduced payment response time" bullet)

- **Problem:** Stripe is down. Without protection every payment waits for a timeout (seconds) and keeps hammering a broken service.
- **Picture:** the fuse in your house. When it detects trouble it cuts the circuit.
- **States:** **CLOSED** (normal), **OPEN** (calls are rejected instantly, Stripe is not contacted), **HALF-OPEN** (after 30 seconds one test call is allowed; if it works the circuit closes).
- **Our settings** (`payment-service/src/payments.js`): opens when at least 5 calls were made and half of them failed; 10 second timeout per call.
- **Detail that shows understanding:** a **declined card is not an outage**, so it does not count toward opening the breaker (`errorFilter`). There is a test for that.
- **What the bullet really means:** when Stripe is failing, the open circuit answers in about a millisecond instead of waiting for the timeout. `node scripts/demo.js outage` shows it, and the payment log prints `rejected in N ms because the circuit is OPEN` next to the slower failures.
- **Timeouts are retried, not cancelled:** if a call times out we do not know whether Stripe charged the card, so the error is thrown and Kafka delivers the message again. That is safe because of idempotency.
- **Say:** "The breaker turns slow failures into fast failures. I do not quote exact numbers because they depend on the timeout I configure; I can show the log lines that prove the difference."

## 11. Stripe in this project (be exact about it)

- **Test mode:** with `STRIPE_SECRET_KEY` set (an `sk_test_` key) the service uses the real Stripe API with Stripe's **test payment methods**: `pm_card_visa` succeeds, `pm_card_chargeDeclined` is declined. No real money, no real card numbers.
- **No key:** a **mock** behaves the same way, so the project runs without an account.
- **Money:** amounts are sent as whole numbers in the smallest unit (paise), never as decimals.
- **What a production version adds:** the card is collected in the browser with Stripe Elements (card data goes straight to Stripe and never touches our servers), the browser confirms the payment, and Stripe tells us the final result by a **webhook** with a verified signature. This project uses the server-side test-card approach to keep the demo simple, and I know the difference.

---

## 12. AI recommendations (OpenAI)

- **Problem:** "customers also like" based on meaning, not only on category.
- **Picture:** every product gets coordinates on a huge map of meaning. Products with similar meaning sit close together. "Wireless headphones" and "Bluetooth earbuds" are neighbours, "leather sneakers" is far away.
- **Embedding:** OpenAI's `text-embedding-3-small` turns a product's name, category, tags and description into a list of 1536 numbers. Created **once** when the product is created or changed, then stored on the product in MongoDB. Page views never call OpenAI.
- **Cosine similarity:** measures the angle between two such lists. 1 = same direction (same meaning), 0 = unrelated. `embeddings.js` computes it in plain JavaScript over the products (fine for a small catalogue).
- **Fallbacks (important):** if OpenAI fails, the product text is turned into numbers by a simple word-count method; if there are still too few matches, products of the same category are shown. A recommendation problem never breaks the product page.
- **Say:** "I use a pre-trained embedding model through the OpenAI API. I did not train a model. My work is the pipeline: create embeddings when products change, store them, and compare them to find similar products. For millions of products I would move the vectors to a vector database such as pgvector or Pinecone."
- **Without an API key** the fallback is not AI, it only matches shared words. Use a real key before claiming it.

---

## 13. Docker and docker-compose

- **Docker:** packs a service with everything it needs, so it runs the same on your laptop and on AWS.
- **Compose:** one file (`docker-compose.yml`) describes all 12 containers and how they connect. `docker compose up` starts everything.
- **Health checks and `depends_on: condition: service_healthy`:** a service only starts after its database or Kafka is really ready. Services also retry their connections, so a slow start does not crash them.
- **Public vs private:** only the website (and the gateway on your own machine for testing) is published. Databases and Kafka are reachable only inside the Docker network.

## 14. CI/CD with GitHub Actions and AWS

Pipeline in `.github/workflows/ci-cd.yml`:

1. **test:** unit tests for all 7 services, in parallel.
2. **docker-build:** `docker compose build`, so a broken Dockerfile is caught before deployment.
3. **deploy** (only on a push to `main`): copy the code to the EC2 server over SSH (rsync), run `docker compose up -d --build`, then smoke test the live site.

Details: [DEPLOY-AWS.md](DEPLOY-AWS.md).

---

## 15. Honest limits (say them before the interviewer finds them)

| Limit | What I would do next |
|---|---|
| Tokens are in `localStorage`, one token that lasts 1 day, no refresh token | httpOnly cookie plus short access token and refresh token |
| Payments use Stripe test cards, no webhook | Stripe Elements plus a verified webhook |
| One Kafka broker, replication factor 1 | 3 brokers, replication factor 3 |
| Outbox worker assumes one order-service copy | `FOR UPDATE SKIP LOCKED` so several workers can share the work |
| Trending counts all-time views | time windows or decay |
| Recommendations compare vectors in application memory | vector database when the catalogue is large |
| Rate limit is per IP only | per user and per route |
| Deployment has a short downtime and uses HTTP | rolling or blue-green deploy, domain and HTTPS |
| No end-to-end test and no monitoring dashboard | integration tests in CI, Prometheus and Grafana |

---

## 16. How this version differs from the earlier practice answers

If you studied earlier question lists, use these corrections:

- **Recommendations:** vectors are stored **in MongoDB** and compared in JavaScript. There is **no pgvector** in this version.
- **Real-time cart:** there is **no Socket.io**. The cart is a Redis Hash and the order page **polls** every 1.5 seconds.
- **Login:** a single JWT (1 day), not access plus refresh tokens.
- **Search:** MongoDB text search. **No Elasticsearch.**
- **No Kubernetes and no Prometheus/Grafana** in this version. You can still say you know them, but do not claim them as part of this project.
- **Kafka** runs in KRaft mode (no Zookeeper).
- **The outbox pattern is implemented**, so "what would you change?" now has a different answer: the next steps are in section 15.

---

## 17. Resume bullet to proof

| Bullet | Proof you can show in 30 seconds |
|---|---|
| 7 independent microservices, stock restored if payment fails | `node scripts/demo.js`, part 2: declined card, then stock returns to the original number |
| Stripe with retry protection | `payments.test.js`: "the same order is charged only once, even if processed twice" |
| Reduced payment response time | `node scripts/demo.js outage` and the `rejected in N ms` log lines |
| Redis caching, database load reduced | `node scripts/measure-cache.js` and the `X-Cache` header in the browser's Network tab |
| Trending leaderboard | home page *Trending now* changes as you open products |
| AI recommendations with OpenAI | product page *You may also like* with the similarity percentage; seed log says `embedding: openai` |
| GitHub Actions, Docker, AWS | the green workflow run in the Actions tab and the live site on the server's IP |
