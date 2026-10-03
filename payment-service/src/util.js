// Tiny helpers shared by every service (each service has its own copy so
// services stay fully independent).

const serviceName = process.env.SERVICE_NAME || 'service';

// Same log format everywhere: time + [service-name] + message
const log = (...args) => console.log(new Date().toISOString(), `[${serviceName}]`, ...args);

// Databases and Kafka take a few seconds to start. Instead of crashing,
// a service keeps retrying until its dependency is ready.
async function retry(fn, { retries = 30, delayMs = 2000, label = 'dependency' } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries) throw err;
      log(`${label} not ready yet (${err.message}). Retry ${attempt}/${retries}...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

// Resolves once an ioredis client is connected.
function waitReady(redis) {
  return new Promise((resolve) => {
    if (redis.status === 'ready') return resolve();
    redis.once('ready', resolve);
  });
}

module.exports = { log, retry, waitReady };
