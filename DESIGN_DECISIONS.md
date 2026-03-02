# Design Decisions & Architecture Rationale

This document explains the key architectural decisions and why they were made.

---

## 1. MongoDB Transactions for Atomicity

### Decision
Use MongoDB multi-document transactions for wallet deductions and order creation.

### Why?

**What We're Solving:**
- Race condition: Two concurrent orders might both deduct money before checking if balance is sufficient
- Partial updates: Order created but balance not updated, or vice versa
- Data inconsistency: Ledger shows transaction that didn't complete

**Alternative Approaches & Why We Rejected Them:**

| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| **NoSQL Without Transactions** | Simple, fast | Race conditions, inconsistency | ❌ No |
| **Application-Level Locking** | Works anywhere | Complex, prone to deadlocks, slow | ❌ No |
| **Two-Phase Commit** | Reliable | Requires multiple databases, very slow | ❌ No |
| **MongoDB Transactions** | ACID guaranteed, simple code, fast | Requires replica set | ✅ **YES** |
| **Event Sourcing (eventual consistency)** | Highly scalable | Complex, eventual not instant | ⏸️ Future |

**Implementation:**
```javascript
const session = await Wallet.startSession();
session.startTransaction();
try {
  // All operations within transaction
  // Either all succeed or all fail
  wallet.balance -= amount;
  order.status = 'PENDING';
  ledger.push(transaction);
  await session.commitTransaction();
} catch {
  await session.abortTransaction();
}
```

**Scaling Path:**
- Today: Single replica set with transactions
- 10M users: Sharded transactions (MongoDB 4.2+)
- Beyond: Event sourcing for distributed consistency

---

## 2. Separate Collections for Wallet, Order, and Ledger

### Decision
Use three separate MongoDB collections instead of embedding everything in one document.

### Schema Design Comparison

**Option A: Everything in Order Document**
```javascript
{
  order_id: "ORD-001",
  client_id: "CLIENT-001",
  amount: 100,
  wallet_after: 900,
  balance_history: [
    { timestamp, balance }
  ]
}
```
❌ **Problem**: Wallet document grows infinitely with history

**Option B: Our Design (Separate Collections)**
```javascript
// Collections:
Wallet { client_id, balance, version, status }
Order { order_id, client_id, amount, status, fulfillment_id }
Ledger { client_id, transaction_type, amount, balance_after, reference }
```
✅ **Advantage**: Clear separation of concerns, optimizable independently

### Why This Separation?

**Wallet Collection:**
- Hot data: Frequently accessed, cached candidates
- Small document: Fixed fields, optimal for caching
- Scalable: Can shard by client_id without growth issues

**Order Collection:**
- Moderate size: Order details + fulfillment response
- Historical: Can be archived after 30 days
- Queryable: Indexed by client_id, status, created_at

**Ledger Collection:**
- Write-only: Each transaction appends new entry
- Immutable: Prevents accidental/malicious modifications
- Archivable: Can move old entries to cold storage
- Compliant: Perfect for audit trails

### Comparison: Embedded vs. Separate

| Aspect | Embedded | Separate (Our Design) |
|---|---|---|
| Query Performance | Fast for single order | Very fast for wallet, moderate for orders |
| Update Complexity | Complex nested updates | Simple atomic updates |
| Storage Efficiency | Some duplication | Minimal duplication |
| Scalability | Harder with sharding | Natural sharding boundaries |
| Compliance | Hard to guarantee immutability | Easy with separate ledger |

---

## 3. Immutable Ledger Pattern

### Decision
Create an append-only, immutable ledger collection.

### Why Immutability?

**Traditional Mutable Ledger:**
```javascript
// Can be updated/deleted
db.ledger.updateOne({ id: 123 }, { $set: { amount: 1000 } })
db.ledger.deleteOne({ id: 123 })
```
❌ **Problems:**
- Fraudulent modifications
- Lost history
- Compliance violations
- Impossible to detect tampering

**Our Immutable Ledger:**
```javascript
// Middleware prevents updates
ledgerSchema.pre('updateOne', function() {
  throw new Error('Ledger entries are immutable');
});

// Can only append
await Ledger.create({ ... }) // Insert only
```
✅ **Benefits:**
- **Compliance**: Regulatory requirement for financial systems
- **Forensics**: Detect fraudulent modifications
- **Reconstruction**: Rebuild wallet balance from scratch
- **Audit Trail**: Complete history from day one

### Use Cases

**Fraud Detection:**
```javascript
// Find all transactions before wallet was frozen
const suspiciousTransactions = await Ledger.find({
  client_id: 'FROZEN-CLIENT',
  created_at: { $lt: freezeDate },
  amount: { $gt: 1000 }
});
```

**Balance Verification:**
```javascript
// Verify wallet balance from ledger
const ledgerEntries = await Ledger.find({ client_id });
const calculatedBalance = ledgerEntries.reduce((sum, tx) => {
  return tx.transaction_type === 'CREDIT' 
    ? sum + tx.amount 
    : sum - tx.amount;
}, 0);

if (calculatedBalance !== wallet.balance) {
  // Alert: Wallet balance mismatch
}
```

---

## 4. Version Field for Optimistic Locking

### Decision
Add `version` field to Wallet for optimistic concurrency control.

### Problem Being Solved
```javascript
// Scenario: Two simultaneous requests
// ① Request A reads wallet: balance = 100
// ② Request B reads wallet: balance = 100
// ③ Request A deducts 50: balance = 50, writes
// ④ Request B deducts 40: balance = 60, writes
// Result: Balance is 60, but should be 10
```

### Our Solution: Optimistic Locking

```javascript
walletSchema.methods.updateBalance = async function(amount) {
  const updated = await Wallet.findByIdAndUpdate(
    this._id,
    {
      $set: { balance: this.balance + amount },
      $inc: { version: 1 }  // Increment version
    },
    { new: true }
  );
  
  // If no document matched (version changed), retry
  if (!updated) {
    throw new Error('Version mismatch - retry');
  }
};
```

### Pessimistic vs. Optimistic Locking

| Aspect | Pessimistic (Locks) | Optimistic (Version) |
|---|---|---|
| Implementation | Row locks in DB | Version field |
| Contention | Blocks other requests | Allows reads, conflict on write |
| Performance | Low (serialized) | High (parallel) |
| Deadlocks | Possible | No |
| Best For | High contention | Low contention |

**Decision Rationale:**
- Transactions already handle most cases
- Version field provides additional safety
- Minimal performance overhead (just one more field)

---

## 5. Idempotency Key Pattern

### Decision
Support `idempotency_key` parameter for safe retries.

### Why?

**Network Failures Scenario:**
```
Client: POST /orders with amount=100
Server: Creates order, deducts wallet, calls API
Server: API succeeds, returns fulfillment_id=101
Network: Response fails to reach client (timeout)
Client: Retries with exact same request
Server: ???
```

**Without Idempotency:**
1. Second request creates new order
2. Wallet deducted twice
3. Two orders created for one intent

**With Idempotency:**
1. Check if idempotency_key already processed
2. Return cached result ('Order already exists')
3. Client gets same response

### Implementation

```javascript
// Check if already processed
const existingOrder = await Order.findOne({ idempotency_key });
if (existingOrder) {
  return res.status(200).json({
    message: 'Order already exists (idempotency)',
    data: { order_id: existingOrder.order_id }
  });
}

// Process first time
const order = await Order.create({ idempotency_key, ... });
```

### Idempotency Key Generation

**Client-side (Recommended):**
```javascript
const crypto = require('crypto');
const idempotencyKey = crypto.randomUUID(); // UUIDv4
```

**API Contract:**
```
POST /orders
X-Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000
```

---

## 6. Fulfillment API Failure Handling with Rollback

### Decision
If external fulfillment API fails, automatically rollback the wallet deduction.

### Failure Scenarios

**Scenario 1: API Never Called**
```
Wallet deducted ✓
Order created ✓
API call fails ✗
Rollback wallet ✓
Result: Balance restored
```

**Scenario 2: API Partially Fails**
```
Wallet deducted ✓
Order created ✓
API times out
Retry logic kicks in
```

### Retry Strategy

```javascript
// Exponential backoff: 1s, 2s, 4s, 8s, 16s
const RETRY_DELAYS = [1000, 2000, 4000, 8000, 16000];
const MAX_RETRIES = 3;

// Retryable errors:
// - ECONNREFUSED (network down)
// - ETIMEDOUT (slow response)
// - 5xx (server error)
```

NOT Retried:
```
// - 4xx errors (bad request - our fault)
// - Invalid JSON response
// - Missing required fields
```

### Rollback Implementation

```javascript
static async rollbackWalletDeduction(clientId, amount, orderId) {
  const session = await Wallet.startSession();
  session.startTransaction();
  
  try {
    const wallet = await Wallet.findOne({ client_id: clientId });
    wallet.balance += amount; // Restore
    await wallet.save({ session });
    
    // Record as refund in ledger
    await Ledger.create([{
      client_id: clientId,
      transaction_type: 'ORDER_REFUND',
      amount,
      reference: orderId
    }], { session });
    
    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error; // Alert operations
  }
}
```

---

## 7. Centralized Error Handling Middleware

### Decision
Use Express middleware for centralized error handling instead of passing errors through business logic.

### Error Flow

```
┌─ Route Handler ─┐
│ (may throw)     │
└────────┬────────┘
         │ error
         ▼
┌─ Catch Block ─┐
│ asyncHandler()│
└────────┬────────┘
         │
         ▼
┌─── Error Handler Middleware ───┐
│ - Map error to HTTP status      │
│ - Format response               │
│ - Log for monitoring            │
│ - Send to client                │
└────────────────────────────────┘
```

### Why Middleware (Not Try-Catch Everywhere)?

**Before: Scattered Error Handling**
```javascript
router.post('/orders', async (req, res) => {
  try {
    const wallet = await Wallet.find({...});
    if (!wallet) {
      return res.status(404).json({ error: 'Wallet not found' });
    }
    
    if (wallet.balance < amount) {
      return res.status(402).json({ error: 'Insufficient balance' });
    }
    
    // ... 20 more try-catches
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```
❌ **Problems:** Repetitive, inconsistent, hard to maintain

**After: Centralized Handler**
```javascript
router.post('/orders', asyncHandler(async (req, res) => {
  const wallet = await Wallet.find({...});
  if (!wallet) throw new NotFoundError('Wallet not found');
  if (wallet.balance < amount) throw new InsufficientBalanceError('...');
  // ... clean code
}));

// All errors hit this middleware:
app.use(errorHandler); // Handles ALL errors consistently
```
✅ **Benefits:**
- Consistent error format across all endpoints
- Single place to modify error behavior
- Easier to add monitoring/logging
- Clean business logic code

---

## 8. Connection Pooling for Scalability

### Decision
Use MongoDB connection pooling with configurable pool sizes.

### Connection Pool Benefits

```
Without pooling (create new connection per request):
Request 1: Create → Query → Close (overhead!)
Request 2: Create → Query → Close (overhead!)
Request 3: Create → Query → Close (overhead!)
↓
For 1000 concurrent users: Create 1000 connections!
```

```
With pooling:
Warm pool: [Conn1, Conn2, Conn3, ...]
Request 1: Borrow Conn1 → Query → Return
Request 2: Borrow Conn2 → Query → Return
Request 3: Borrow Conn1 → Query → Return
↓
For 1000 concurrent users: Only need ~50 connections
```

### Pool Configuration

```javascript
maxPoolSize: 50,  // Up to 50 simultaneous connections
minPoolSize: 10   // Keep 10 warm
```

### Scaling Pool Size

| Scale | Concurrent Users | Concurrent Requests | Pool Size |
|---|---|---|---|
| **Dev** | 10 | 2 | 10 |
| **Small** | 1K | 10 | 20 |
| **Medium** | 10K | 100 | 50-100 |
| **Large** | 100K | 1,000 | 100-200 |
| **Enterprise** | 1M+ | 10,000+ | 200-500 |

---

## 9. Stateless Application Design

### Decision
No in-memory session storage; all state in MongoDB or external caches.

### Why Stateless?

**Stateful (Wrong):**
```javascript
// Don't do this!
app.locals.sessions = {}; // In-memory!
app.post('/orders', (req, res) => {
  const session = app.locals.sessions[clientId];
  session.requestCount++;
});
```
❌ **Problems:**
- Can't restart server without losing state
- Can't scale horizontally (other servers don't have this state)
- Server crashes = data loss

**Stateless (Right):**
```javascript
// Load state from database on each request
app.post('/orders', asyncHandler(async (req, res) => {
  const wallet = await Wallet.findOne({ client_id });
  const order = await Order.create({ ... });
  // All state in MongoDB, not in memory
}));
```
✅ **Benefits:**
- Restart server anytime (no data loss)
- Scale horizontally (any server can handle any request)
- No synchronization issues
- Easy deployment and updates

---

## 10. Asynchronous Handlers with Try-Catch Wrapper

### Decision
Wrap async route handlers with `asyncHandler()` middleware.

### Why?

**Problem: Unhandled Promise Rejections**
```javascript
// Without wrapper - error never reaches errorHandler!
router.post('/orders', async (req, res) => {
  const wallet = await Wallet.find({...}); // May throw
  // If throws, promise rejects but no .catch()!
});
```

**Solution: asyncHandler Wrapper**
```javascript
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
  //                                    ↑
  //                    Pass error to middleware
};

router.post('/orders', asyncHandler(async (req, res) => {
  const wallet = await Wallet.find({...});
  // Error caught and passed to errorHandler
}));
```

### Benefits:
- All errors reach error handler middleware
- Consistent error responses
- No server crashes from unhandled rejections
- Clean code (no try-catch needed in routes)

---

## 11. Database Connection Retry Logic

### Decision
Implement exponential backoff for MongoDB connection failures.

### Why?

**Scenario: MongoDB Restarts**
```
Server starts → MongoDB not ready (warming up)
Without retry: Server crashes, deploy fails
With retry: Waits for MongoDB, continues

Server running → MongoDB temporarily down
Without retry: Requests fail immediately
With retry: Requests have 10+ second grace period
```

### Retry Algorithm

```javascript
// Exponential backoff: 1s, 2s, 4s, 8s, 16s
const RETRY_ATTEMPTS = 5;
const INITIAL_DELAY = 1000;

for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
  try {
    await connect();
    return;
  } catch {
    const delay = INITIAL_DELAY * Math.pow(2, attempt - 1);
    console.log(`Retry in ${delay}ms (attempt ${attempt})`);
    await sleep(delay);
  }
}
```

### Connection Monitoring

```javascript
mongoose.connection.on('disconnected', () => {
  console.warn('MongoDB disconnected');
  attemptReconnect();
});

mongoose.connection.on('error', (err) => {
  console.error('MongoDB error:', err);
  // Don't immediately crash, schedule reconnect
});
```

---

## 12. Order Status State Machine

### Decision
Use explicit state transitions for order status changes.

### Valid State Transitions

```
    ┌─────────── PENDING ──────────┐
    │              │               │
    │              ▼               ▼
    │         FULFILLED ─→ CANCELLED
    │
    │              │
    │              ▼
    └─→ FAILED ────→ CANCELLED
```

### Implementation

```javascript
transitionStatus(newStatus) {
  const validTransitions = {
    'PENDING': ['FULFILLED', 'FAILED', 'CANCELLED'],
    'FULFILLED': ['CANCELLED'],
    'FAILED': ['CANCELLED'],
    'CANCELLED': []
  };
  
  if (!validTransitions[this.status].includes(newStatus)) {
    throw new Error(`Invalid: ${this.status} → ${newStatus}`);
  }
  
  this.status = newStatus;
}
```

### Benefits

- **No Invalid States**: Can't accidentally set `FULFILLED → FAILED`
- **Audit Trail**: Every status change recorded
- **Debugging**: Know exactly what states lead to current state
- **Business Logic**: Enforces business rules in code

---

## Summary: Design Philosophy

| Principle | Our Approach | Why |
|---|---|---|
| **Atomicity** | MongoDB transactions | Prevent race conditions |
| **Immutability** | Append-only ledger | Compliance & auditability |
| **Scalability** | Stateless, sharded | 10M+ users possible |
| **Reliability** | Transactions + rollback | Recover from failures |
| **Simplicity** | Separate concerns | Easier to maintain & scale |
| **Observability** | Structured logging | Debug production issues |

---

## Trade-offs Made

| Decision | Pro | Con | Accepted? |
|---|---|---|---|
| MongoDB (not SQL) | Flexible schema | Less ACID for complex joins | ✅ Yes |
| Transactions | Consistency | Requires replica set | ✅ Yes |
| Connection pooling | Scalability | Memory overhead | ✅ Yes |
| Retry logic | Resilience | More complexity | ✅ Yes |
| Immutable ledger | Compliance | Storage overhead | ✅ Yes |
| Statelessness | Scalability | More DB queries | ✅ Yes |

---

## Future Enhancements

1. **Event Sourcing** - For extreme scale (100M+ users)
2. **CQRS Pattern** - Separate read/write databases
3. **Distributed Ledger** - Blockchain for immutability
4. **Time-Series DB** - Specialized for ledger analytics
5. **Message Queue** - Kafka for async processing
6. **Cache Layer** - Redis for hot data
7. **GraphQL** - More flexible querying

These would be added as the system scales, but would complicate architecture significantly.
