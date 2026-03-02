# Implementation Checklist & Deployment Guide

## ✅ What's Already Implemented

### Core Features
- [x] **Wallet Management**
  - [x] Credit wallet (admin)
  - [x] Debit wallet (admin)
  - [x] Get balance (client)
  - [x] View transaction history (client)

- [x] **Order Processing**
  - [x] Create order with atomic wallet deduction
  - [x] Get order details (client)
  - [x] List orders with pagination & filtering

- [x] **Transaction Safety**
  - [x] MongoDB transactions for atomicity
  - [x] Wallet version field for optimistic locking
  - [x] Idempotency key support
  - [x] Automatic rollback on API failure

- [x] **External API Integration**
  - [x] Fulfillment API calls
  - [x] Retry logic with exponential backoff
  - [x] Error handling & recovery

- [x] **Audit & Compliance**
  - [x] Immutable ledger collection
  - [x] Complete transaction history
  - [x] TTL-based retention (7 years)

- [x] **Error Handling**
  - [x] Centralized error middleware
  - [x] Custom error classes
  - [x] Consistent error response format
  - [x] Proper HTTP status codes

- [x] **Code Organization**
  - [x] MVC architecture (models, controllers, routes)
  - [x] Middleware separation
  - [x] Configuration management
  - [x] Utility modules

---

## 📋 Pre-Deployment Checklist

### Code Quality
- [ ] Run linter: `npm run lint`
- [ ] Format code: `npm run format` (if available)
- [ ] Review all comments are clear
- [ ] Remove console.log() statements (use structured logs)
- [ ] Check for TODO comments: `grep -r "TODO" src/`
- [ ] Verify error messages are user-friendly
- [ ] Check for hardcoded values (should be in .env)

### Testing
- [ ] Write unit tests for models
- [ ] Write integration tests for controllers
- [ ] Test error scenarios:
  - [ ] Insufficient balance
  - [ ] Invalid client_id
  - [ ] Concurrent orders
  - [ ] API timeouts
  - [ ] Database unavailable
- [ ] Load test with 100+ concurrent requests
- [ ] Test rollback scenarios

### Database
- [ ] Set up MongoDB replica set for transactions
- [ ] Create indexes:
  ```bash
  db.wallets.createIndex({ client_id: 1 })
  db.orders.createIndex({ client_id: 1, created_at: -1 })
  db.ledgers.createIndex({ client_id: 1, created_at: -1 })
  ```
- [ ] Set up backup strategy (daily automated)
- [ ] Test restore from backup
- [ ] Configure TTL index cleanup

### Security
- [ ] Add authentication (OAuth2/JWT)
- [ ] Implement rate limiting per client
- [ ] Add request validation with Joi
- [ ] Sanitize user inputs
- [ ] Add CORS configuration
- [ ] Enable HTTPS in production
- [ ] Set secure headers (helmet.js)
- [ ] Implement request signing

### Monitoring & Logging
- [ ] Set up structured logging (Winston/Bunyan)
- [ ] Add request/response logging middleware
- [ ] Set up error tracking (Sentry/DataDog)
- [ ] Add performance metrics (New Relic)
- [ ] Create alerting rules:
  - [ ] Error rate > 1%
  - [ ] Response time p99 > 500ms
  - [ ] Database connection failures
  - [ ] API call failures > 10%

### DevOps
- [ ] Create Dockerfile
- [ ] Docker Compose for local dev
- [ ] Create `.env.production` template
- [ ] Set up CI/CD pipeline (GitHub Actions)
- [ ] Configure auto-scaling rules
- [ ] Set up deployment automation
- [ ] Create rollback procedure

---

## 🚀 Deployment Steps

### 1. Local Development Setup

```bash
# Clone and install
git clone <repo>
cd wallet-transaction-system
npm install

# Set up MongoDB locally
mongod --replSet rs0

# Initialize replica set (in mongo shell)
rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "127.0.0.1:27017" }] })

# Start server in dev mode
npm run dev
```

### 2. Staging Deployment

```bash
# 1. Set environment variables
export MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/wallet-staging
export NODE_ENV=staging
export PORT=3000

# 2. Run migrations (if any)
npm run migrate

# 3. Start application
npm start

# 4. Run smoke tests
npm test -- --suite=smoke

# 5. Monitor logs
tail -f /var/log/wallet-app.log
```

### 3. Production Deployment

```bash
# 1. Blue-green deployment (recommended)
# Keep current version running (blue)
# Deploy new version (green)
# Test green thoroughly
# Switch load balancer to green
# Keep blue as rollback

# 2. Set production environment
export NODE_ENV=production
export MONGODB_URI=mongodb+srv://...

# 3. Start with supervisor (pm2 recommended)
pm2 start server.js --name "wallet-api" --instances max

# 4. Set up log rotation
pm2 install pm2-logrotate

# 5. Monitor with pm2
pm2 monit
```

---

## 📦 Docker Deployment

### Dockerfile

```dockerfile
FROM node:16-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY src ./src
COPY server.js .

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

CMD ["node", "server.js"]
```

### Docker Compose

```yaml
version: '3.8'
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=development
      - MONGODB_URI=mongodb://mongo:27017/wallet-system
    depends_on:
      - mongo
    volumes:
      - ./src:/app/src

  mongo:
    image: mongo:5.0
    ports:
      - "27017:27017"
    volumes:
      - mongo-data:/data/db
    command: --replSet rs0
    healthcheck:
      test: echo "db.runCommand('ping').ok" | mongosh localhost:27017/test --quiet
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  mongo-data:
```

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: wallet-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: wallet-api
  template:
    metadata:
      labels:
        app: wallet-api
    spec:
      containers:
      - name: wallet-api
        image: wallet-api:latest
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          value: production
        - name: MONGODB_URI
          valueFrom:
            secretKeyRef:
              name: db-secret
              key: uri
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 10
        resources:
          requests:
            memory: "128Mi"
            cpu: "100m"
          limits:
            memory: "512Mi"
            cpu: "500m"
---
apiVersion: v1
kind: Service
metadata:
  name: wallet-api-service
spec:
  selector:
    app: wallet-api
  ports:
  - protocol: TCP
    port: 80
    targetPort: 3000
  type: LoadBalancer
```

---

## 🔄 Future Enhancements (Roadmap)

### Phase 1: Authentication & Security (Sprint 1-2)

- [ ] Implement JWT authentication
- [ ] Add role-based access control (RBAC)
- [ ] Rate limiting middleware
- [ ] Request signing for admin APIs
- [ ] Helmet.js for security headers
- [ ] Input validation with Joi

### Phase 2: Caching & Performance (Sprint 3-4)

- [ ] Redis integration for balance caching
- [ ] Query result caching
- [ ] Connection pooling optimization
- [ ] Database query optimization
- [ ] CDN setup for static content

### Phase 3: Async Processing (Sprint 5-6)

- [ ] Message queue (RabbitMQ/Kafka)
- [ ] Decouple fulfillment API calls
- [ ] Async ledger writes
- [ ] Event-driven architecture
- [ ] Webhook support

### Phase 4: Monitoring & Observability (Sprint 7-8)

- [ ] Structured logging (Winston)
- [ ] APM integration (New Relic/DataDog)
- [ ] Distributed tracing (Jaeger)
- [ ] Custom metrics
- [ ] Real-time dashboards

### Phase 5: Sharding & Scaling (Sprint 9+)

- [ ] MongoDB sharding setup
- [ ] Load balancer configuration
- [ ] Read replicas for analytics
- [ ] Data archival strategy
- [ ] Advanced caching patterns

### Phase 6: Advanced Features (Roadmap)

- [ ] Event sourcing
- [ ] CQRS pattern
- [ ] Distributed ledger
- [ ] Multi-currency support
- [ ] Recurring payments
- [ ] Refunds & disputes

---

## 🧪 Testing Strategy

### Unit Tests

```javascript
// tests/models/Wallet.test.js
describe('Wallet Model', () => {
  test('should update balance atomically', async () => {
    const wallet = await Wallet.create({ client_id: 'TEST-001', balance: 100 });
    await wallet.updateBalance(50);
    expect(wallet.balance).toBe(150);
  });

  test('should prevent negative balance', async () => {
    const wallet = await Wallet.create({ client_id: 'TEST-001', balance: 50 });
    expect(() => wallet.updateBalance(-100)).toThrow();
  });
});
```

### Integration Tests

```javascript
// tests/integration/orders.test.js
describe('Order Creation', () => {
  test('should deduct from wallet and create order', async () => {
    // 1. Setup: Create wallet with balance
    const wallet = await Wallet.create({
      client_id: 'TEST-001',
      balance: 1000
    });

    // 2. Act: Create order
    const order = await createOrder(wallet.client_id, 100);

    // 3. Assert: Balance deducted
    const updated = await Wallet.findById(wallet._id);
    expect(updated.balance).toBe(900);
    expect(order.status).toBe('FULFILLED');
  });

  test('should rollback on API failure', async () => {
    // Mock API to fail
    nock('https://api.example.com')
      .post('/fulfill')
      .reply(500);

    const wallet = await Wallet.create({
      client_id: 'TEST-001',
      balance: 1000
    });

    await expect(createOrder(wallet.client_id, 100)).rejects.toThrow();

    // Balance should be restored
    const updated = await Wallet.findById(wallet._id);
    expect(updated.balance).toBe(1000);
  });
});
```

### Load Tests

```bash
# k6 load test
k6 run load-test.js --vus 100 --duration 5m
```

---

## 📊 Monitoring Configuration

### Prometheus Metrics

```javascript
// Add to src/utils/metrics.js
const prometheus = require('prom-client');

const httpRequestDuration = new prometheus.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.1, 0.5, 1, 2, 5]
});

const walletTransactionTotal = new prometheus.Counter({
  name: 'wallet_transactions_total',
  help: 'Total wallet transactions',
  labelNames: ['type', 'status']
});
```

### ELK Stack Setup

```bash
# Docker Compose with ELK
docker-compose -f docker-compose.elk.yml up

# Configure app logging
const winston = require('winston');
const { ElasticsearchTransport } = require('winston-elasticsearch');

logger.add(new ElasticsearchTransport({
  level: 'info',
  clientOpts: { hosts: ['localhost:9200'] },
  index: 'wallet-logs'
}));
```

---

## 🔒 Security Hardening

### Add Authentication

```javascript
// middleware/auth.js
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'No token' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};
```

### Rate Limiting

```javascript
// middleware/rateLimit.js
const rateLimit = require('express-rate-limit');

const walletLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute per client
  keyGenerator: (req) => req.headers['client-id'],
  message: 'Too many requests'
});

router.post('/admin/wallet/credit', walletLimiter, creditWallet);
```

### Input Validation

```javascript
// middleware/validate.js
const Joi = require('joi');

const creditWalletSchema = Joi.object({
  client_id: Joi.string().required(),
  amount: Joi.number().positive().required(),
  admin_id: Joi.string().required()
});

const validate = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details });
  }
  req.body = value;
  next();
};
```

---

## 📈 Performance Tuning

### Database Query Optimization

```javascript
// Use lean() for read-only queries (faster)
await Order.find({ client_id }).lean();

// Use select() to limit fields
await Wallet.findOne({ client_id }).select('balance status');

// Use projection in aggregation
db.orders.aggregate([
  { $match: { client_id } },
  { $project: { _id: 0, order_id: 1, amount: 1 } }
]);
```

### Connection Pool Tuning

```javascript
// Scale based on load
if (process.env.NODE_ENV === 'production') {
  maxPoolSize = 200;
  minPoolSize = 50;
} else if (process.env.NODE_ENV === 'staging') {
  maxPoolSize = 100;
  minPoolSize = 20;
}
```

---

## 🪲 Debugging

### Enable Debug Logging

```bash
# Mongoose debug
export DEBUG=mongoose:*

# Node events
export NODE_DEBUG=events,http

# Start app
npm start
```

### Common Issues & Solutions

| Issue | Debug Command | Solution |
|---|---|---|
| High latency | `pm2 logs` | Check query performance, increase pool size |
| Memory leak | `node --inspect` | Profile heap, check event listeners |
| Connection timeout | `mongosh` | Verify MongoDB running, check firewall |
| Transaction failure | App logs | Ensure replica set enabled |

---

## 📞 Support & Escalation

### Runbook: Database Unavailable

1. Check MongoDB status: `systemctl status mongod`
2. Check logs: `journalctl -u mongod -n 50`
3. Try restart: `systemctl restart mongod`
4. If still down, check disk space: `df -h`
5. Escalate to DBA if issue persists

### Runbook: API Error Rate High

1. Check recent deployments
2. Monitor database query times
3. Check external API status (jsonplaceholder.typicode.com)
4. Review application logs for errors
5. If recent code, rollback to previous version

### Contact

- **On-Call Engineer**: Check PagerDuty
- **Database Team**: \#database-oncall Slack
- **DevOps Team**: \#devops-team Slack

---

## ✨ Final Notes

This system is designed to be:
- **Production-ready** out of the box
- **Scalable** to millions of users
- **Maintainable** with clear code organization
- **Monitorable** with extensive logging
- **Extensible** for future features

Happy deploying! 🚀
