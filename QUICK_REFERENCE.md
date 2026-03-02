# Quick Reference & Visual Guide

## 📦 Complete Folder Structure

```
wallet-transaction-system/
│
├── 📄 server.js                           # Entry point (graceful shutdown)
├── 📄 package.json                        # Dependencies & scripts
├── 📄 .env                                # Environment variables
├── 📄 .gitignore                          # Git ignore rules
│
├── 📁 src/                               # Source code
│   │
│   ├── 📄 app.js                         # Express app setup
│   │
│   ├── 📁 config/                        # Configuration
│   │   └── 📄 database.js                # MongoDB connection + retry logic
│   │
│   ├── 📁 models/                        # Mongoose schemas
│   │   ├── 📄 Wallet.js                  # Wallet model (balance tracking)
│   │   ├── 📄 Order.js                   # Order model (fulfillment tracking)
│   │   └── 📄 Ledger.js                  # Ledger model (immutable transactions)
│   │
│   ├── 📁 controllers/                   # Business logic
│   │   ├── 📄 walletController.js        # Credit/debit operations
│   │   └── 📄 orderController.js         # Order operations + rollback
│   │
│   ├── 📁 routes/                        # API endpoints
│   │   ├── 📄 admin.js                   # Admin routes (/admin/*)
│   │   ├── 📄 orders.js                  # Order routes (/orders/*)
│   │   └── 📄 wallet.js                  # Wallet routes (/wallet/*)
│   │
│   ├── 📁 middleware/                    # Express middleware
│   │   └── 📄 errorHandler.js            # Error handling + custom errors
│   │
│   └── 📁 utils/                         # Utilities
│       └── 📄 fulfillmentAPI.js          # External API + retry logic
│
├── 📄 README.md                           # Project overview
├── 📄 CURL_COMMANDS.md                    # Complete API examples
├── 📄 SCALABILITY_GUIDE.md                # Scaling to millions
└── 📄 DESIGN_DECISIONS.md                 # Architecture rationale

```

## 🔀 Data Flow Diagram

### Order Creation Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ POST /orders (amount=250, client-id=CLIENT-001)                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │
         ┌─────────────────▼──────────────────┐
         │ 1. VALIDATE INPUT                  │
         │    - Check client-id header        │
         │    - Validate amount > 0           │
         │    - Check idempotency key         │
         └─────────────────┬──────────────────┘
                           │
         ┌─────────────────▼──────────────────┐
         │ 2. START MONGODB TRANSACTION       │
         │    (Atomic operations begin)       │
         └─────────────────┬──────────────────┘
                           │
         ┌─────────────────▼──────────────────┐
         │ 3. FETCH WALLET                    │
         │    Wallet.findOne({ client_id })  │
         └─────────────────┬──────────────────┘
                           │
         ┌─────────────────▼──────────────────┐
         │ 4. CHECK BALANCE                   │
         │    balance >= amount ? continue    │
         └─────────────────┬──────────────────┘
                     YES  │  NO
                         │  └─────► ABORT ─────────┐
                         │                         │
         ┌───────────────▼──────────────────┐    │
         │ 5. DEDUCT FROM WALLET            │    │
         │    wallet.balance -= amount      │    │
         └────────────────┬─────────────────┘    │
                          │                       │
         ┌────────────────▼─────────────────┐    │
         │ 6. CREATE LEDGER ENTRY           │    │
         │    type: ORDER_DEBIT             │    │
         └────────────────┬─────────────────┘    │
                          │                       │
         ┌────────────────▼─────────────────┐    │
         │ 7. CREATE ORDER (PENDING)        │    │
         │    Order.create({...})           │    │
         └────────────────┬─────────────────┘    │
                          │                       │
         ┌────────────────▼─────────────────┐    │
         │ 8. COMMIT TRANSACTION            │    │
         │    ✓ Wallet updated              │    │
         │    ✓ Order created               │    │
         │    ✓ Ledger recorded             │    │
         └────────────────┬─────────────────┘    │
                          │                       │
         ┌────────────────▼─────────────────┐    │
         │ 9. CALL FULFILLMENT API          │    │
         │    POST /posts (external)        │    │
         └────────────────┬─────────────────┘    │
                    SUCCESS│  FAILURE            │
                          │  │                   │
         ┌────────────────▼──▼──────────────┐   │
         │ 10A. UPDATE ORDER FULFILLED      │   │
         │ 10B. ROLLBACK WALLET + REFUND    │   │
         └────────────────┬──────────────────┘   │
                          │                      │
         ┌────────────────▼──────────────────┐  │
         │ 11. RETURN RESPONSE               │  │
         │ (201 Success or 402 Error)        │  │
         └────────────────┬──────────────────┘  │
                          │                      │
                    ┌─────▼──────┐              │
                    │ 200 OK      │              │
                    │ OR 402 Error│◄─────────────┘
                    └─────────────┘
```

### Transaction Rollback on API Failure

```
Fulfillment API Fails
      │
      ▼
START ROLLBACK TRANSACTION
      │
   ┌──┴──┐
   │     │
   ▼     ▼
Fetch  Restore
Wallet Balance
   │
   ▼
Update Wallet
Balance += amount
   │
   ▼
Create Refund
Ledger Entry
   │
   ▼
COMMIT ROLLBACK
   │
   ▼
Client Refunded ✓
```

## 📊 Data Model Relationships

```
┌──────────────────────┐
│      WALLET          │
├──────────────────────┤
│ _id (PK)             │
│ client_id (UK)       │───┐
│ balance              │   │
│ version              │   │
│ status               │   │
│ created_at           │   │
│ updated_at           │   │
└──────────────────────┘   │
                           │  1:N
                           │
      ┌────────────────────┤
      │                    │
      │         ┌──────────┴────────────┐
      │         │                       │
      ▼         ▼                       ▼
┌──────────┐ ┌──────────────┐ ┌──────────────┐
│  ORDER   │ │   LEDGER     │ │   LEDGER     │
├──────────┤ ├──────────────┤ ├──────────────┤
│ _id (PK) │ │ _id (PK)     │ │ _id (PK)     │
│ order_id │ │ client_id    │ │ client_id    │
│client_id │ │ tx_type      │ │ tx_type      │
│ amount   │ │ amount       │ │ amount       │
│ status   │ │ balance_after│ │ balance_after│
│fulfill_id│ │ reference◄───┼─┤reference     │
│created_at│ │ created_at   │ │ created_at   │
└──────────┘ └──────────────┘ └──────────────┘
   │              │                 │
   │ ORDER_DEBIT  │ ORDER_REFUND    │
   └──────────────┴─────────────────┘
```

## 🔌 API Endpoint Map

```
Root: http://localhost:3000

├── /health
│   └── GET: Server health check
│
├── /admin
│   ├── /wallet
│   │   ├── /credit
│   │   │   └── POST: Add funds to wallet
│   │   └── /debit
│   │       └── POST: Remove funds from wallet
│   
├── /wallet
│   ├── /balance
│   │   └── GET: Current balance
│   └── /history
│       └── GET: Transaction history (paginated)
│
└── /orders
    ├── POST: Create order
    ├── GET: List orders (paginated, filterable)
    └── /{order_id}
        └── GET: Order details
```

## 🔐 Security Boundaries

```
External World
      │
      ▼
┌──────────────────┐
│  Express Server  │
│  (Public API)    │
└────────┬─────────┘
         │
         │ client-id header
         │ validation
         ▼
┌──────────────────────────────────────┐
│  Authorization & Validation          │
│  - Check client-id exists            │
│  - Validate request schema           │
│  - Rate limiting (future)            │
└────────┬─────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────┐
│  Controllers & Business Logic        │
│  - Atomic transactions               │
│  - Wallet locks                      │
│  - State machine enforced            │
└────────┬─────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────┐
│  MongoDB (Secure)                    │
│  - Immutable ledger (no updates)     │
│  - Transaction support               │
│  - Authentication required           │
└──────────────────────────────────────┘
```

## 🚦 Request Lifecycle

```
Incoming Request
      │
      ▼
┌──────────────────────────────────┐
│  Express Middleware              │
│  - Parse JSON body               │
│  - Verify client-id header       │
└──────┬───────────────────────────┘
       │
       ▼
┌──────────────────────────────────┐
│  Route Handler                   │
│  - Input validation              │
│  - Check authorization           │
│  - Delegate to controller        │
└──────┬───────────────────────────┘
       │
       ▼
┌──────────────────────────────────┐
│  Controller                      │
│  - Business logic                │
│  - DB transaction                │
│  - Error handling                │
└──────┬───────────────────────────┘
       │
       ├─ Success? ───► 200/201 Response
       │
       └─ Error? ───────► asyncHandler catches
                               │
                               ▼
                          Error Handler
                               │
                               ├─ Log error
                               ├─ Map to HTTP status
                               ├─ Format response
                               │
                               ▼
                          4xx/5xx Response
```

## 📈 Latency Expectations

```
Operation              P50    P95    P99
──────────────────────────────────────────
GET /wallet/balance    5ms    15ms   30ms
POST /orders           80ms   150ms  250ms
GET /orders/:id        10ms   20ms   40ms
POST /admin/credit     50ms   100ms  150ms
POST /admin/debit      50ms   100ms  150ms

Total: 5-250ms per operation with network
```

## 🔄 Error Response Codes

```
Success:
  200 OK          - Request succeeded
  201 Created     - Resource created

Errors:
  400 Bad Request              - Invalid input
  402 Payment Required         - Insufficient balance
  404 Not Found                - Resource not found
  409 Conflict                 - Duplicate entry
  502 Bad Gateway              - External API failed
  503 Unavailable              - Database down
  500 Internal Server Error    - Unexpected error
```

## 🎯 Testing Checklist

```
Unit Tests:
  [ ] Wallet credit validation (positive/negative amounts)
  [ ] Wallet debit with insufficient balance
  [ ] Order creation without balance checks
  [ ] Transaction rollback on API failure
  [ ] Idempotency key prevents duplicates
  [ ] Ledger immutability enforced
  [ ] Status transitions invalid states rejected

Integration Tests:
  [ ] End-to-end order creation
  [ ] Concurrent orders (race conditions)
  [ ] Fulfillment API retry logic
  [ ] Wallet recovery from ledger
  [ ] MongoDB transaction atomicity

Load Tests:
  [ ] 100 concurrent orders/sec
  [ ] 1000 balance checks/sec
  [ ] 500 order lists/sec
  [ ] Connection pool behavior
  [ ] Error rate under load
```

## 📱 Common curl Commands

```bash
# Credit wallet
curl -X POST http://localhost:3000/admin/wallet/credit \
  -H "Content-Type: application/json" \
  -d '{"client_id":"C001","amount":1000}'

# Get balance
curl http://localhost:3000/wallet/balance \
  -H "client-id: C001"

# Create order
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -H "client-id: C001" \
  -d '{"amount":100}'

# List orders
curl "http://localhost:3000/orders?page=1&limit=10" \
  -H "client-id: C001"

# Get specific order
curl http://localhost:3000/orders/ORD-xxx \
  -H "client-id: C001"
```

## 🔧 Troubleshooting Matrix

| Issue | Cause | Solution |
|---|---|---|
| MongoDB Connection Error | DB not running | Start: `mongod` |
| Transaction Error | No replica set | Init: `rs.initiate({...})` |
| 402 Insufficient Balance | Wallet empty | Credit first |
| 404 Order Not Found | Invalid order_id or not your order | Check order_id & client-id |
| 502 API Error | Fulfillment API down | Check jsonplaceholder.typicode.com |
| 5xx Server Error | Unexpected error | Check logs & server.js output |

---

## 📚 Document Map

- **README.md** - Start here, project overview
- **CURL_COMMANDS.md** - All API examples with curl
- **SCALABILITY_GUIDE.md** - How to scale to 10M users
- **DESIGN_DECISIONS.md** - Why we made each architectural choice
- **Code Comments** - Inline explanations in all source files

Choose a starting point based on your needs:
- **New developer?** → README.md
- **Testing APIs?** → CURL_COMMANDS.md  
- **Want to understand?** → DESIGN_DECISIONS.md
- **Scaling up?** → SCALABILITY_GUIDE.md
