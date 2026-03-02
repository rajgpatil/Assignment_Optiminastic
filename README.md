# Wallet-Based Transaction System

A scalable, production-ready wallet and transaction management system built with Node.js, Express, and MongoDB. Designed to handle millions of concurrent users with atomic transactions, comprehensive auditability, and robust error handling.

## 🎯 Key Features

- **Atomic Transactions**: MongoDB transactions ensure data consistency
- **Wallet Management**: Credit/debit operations via admin API
- **Order Processing**: Atomic wallet deduction with external API integration
- **Immutable Ledger**: Complete audit trail for compliance
- **Error Handling**: Centralized, comprehensive error management

---

## 📁 Project Structure

```
wallet-transaction-system/
├── src/
│   ├── models/                 # Database schemas
│   │   ├── Wallet.js          # Client wallet model with atomic updates
│   │   ├── Order.js           # Order model with state machine
│   │   └── Ledger.js          # Immutable transaction ledger
│   │
│   ├── controllers/           # Business logic layer
│   │   ├── walletController.js    # Wallet credit/debit operations
│   │   └── orderController.js     # Order creation and retrieval
│   │
│   ├── routes/               # API endpoints
│   │   ├── admin.js          # /admin/* wallet operations
│   │   ├── orders.js         # /orders/* order operations
│   │   └── wallet.js         # /wallet/* client wallet queries
│   │
│   ├── middleware/           # Express middleware
│   │   └── errorHandler.js   # Centralized error handling + custom errors
│   │
│   ├── utils/               # Utility functions
│   │   └── fulfillmentAPI.js # External API integration with retries
│   │
│   ├── config/              # Configuration
│   │   └── database.js      # MongoDB connection with reconnection logic
│   │
│   └── app.js              # Express app setup and route mounting
│
├── server.js               # Entry point with graceful shutdown
├── package.json            # Dependencies and scripts
├── .env                    # Environment variables
├── .gitignore              # Git ignore rules
├── CURL_COMMANDS.md        # Complete API examples
├── SCALABILITY_GUIDE.md    # Architecture & scaling strategy
└── README.md              # This file

## 🚀 Quick Start

### Prerequisites

- Node.js 14+ 
- MongoDB 4.2+ (with transaction support)
- npm or yarn

### Installation

```bash
# Clone repository
git clone <repo-url>
cd wallet-transaction-system

# Install dependencies
npm install

# Set up environment variables (already configured in .env)
# MONGODB_URI=mongodb://localhost:27017/wallet-system
# PORT=3000

# Start MongoDB (if running locally)
mongod

# For MongoDB replica set (required for transactions):
mongod --replSet rs0

# In mongo shell:
rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "localhost:27017" }] })
```

### Running the Server

```bash
# Production
npm start

# Development with auto-reload
npm run dev
```

Server starts on `http://localhost:3000`

### Health Check

```bash
curl http://localhost:3000/health
```

---

## 📊 Database Schema

### Wallet Collection

```javascript
{
  _id: ObjectId,
  client_id: String (unique, indexed),
  balance: Number (in cents),
  version: Number (for optimistic locking),
  status: 'active' | 'frozen' | 'suspended',
  total_credited: Number,
  total_debited: Number,
  last_transaction_at: Date,
  created_at: Date (indexed),
  updated_at: Date,
}

// Indexes:
{ client_id: 1 }           // Primary lookup
{ client_id: 1, status: 1 } // Status queries
{ created_at: 1 }          // Time-based queries
```

### Order Collection

```javascript
{
  _id: ObjectId,
  order_id: String (unique, indexed),
  client_id: String (indexed),
  amount: Number (in cents),
  status: 'PENDING' | 'FULFILLED' | 'FAILED' | 'CANCELLED',
  fulfillment_id: String (sparse, indexed),
  fulfillment_response: Mixed,
  error_details: {
    code: String,
    message: String,
    timestamp: Date,
    retry_count: Number,
  },
  idempotency_key: String (sparse, indexed),
  created_at: Date (indexed, TTL),
  fulfilled_at: Date,
  updated_at: Date,
  metadata: {
    ip_address: String,
    user_agent: String,
  }
}

// Indexes:
{ client_id: 1, created_at: -1 }    // List orders
{ client_id: 1, status: 1 }         // Filter by status
{ fulfillment_id: 1 }               // Fulfillment tracking
{ created_at: 1 expire: 2592000 }   // Auto-cleanup (30 days)
```

### Ledger Collection (Immutable)

```javascript
{
  _id: ObjectId,
  client_id: String (indexed),
  transaction_type: 'CREDIT' | 'DEBIT' | 'ORDER_DEBIT' | 'ORDER_REFUND',
  amount: Number (always positive),
  balance_after: Number,
  reference: String (optional, sparse, indexed),
  description: String,
  initiated_by: String,
  status: 'SUCCESS' | 'FAILED' | 'PENDING',
  created_at: Date (indexed, TTL - 7 years),
  metadata: {
    ip_address: String,
    user_agent: String,
  }
}

// Indexes:
{ client_id: 1, created_at: -1 }      // History retrieval
{ client_id: 1, transaction_type: 1 } // Type-based queries
{ reference: 1 }                       // Order relationship
```

---

## 🔌 API Endpoints

### Admin Wallet Operations

#### POST `/admin/wallet/credit`
Credit a client's wallet

**Request:**
```json
{
  "client_id": "CLIENT-001",
  "amount": 1000,
  "admin_id": "ADMIN-001",
  "reference": "INITIAL_CREDIT"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Wallet credited successfully",
  "data": {
    "client_id": "CLIENT-001",
    "amount": 1000,
    "new_balance": 1000,
    "transaction_id": "507f1f77bcf86cd799439011"
  }
}
```

#### POST `/admin/wallet/debit`
Debit a client's wallet

**Request:**
```json
{
  "client_id": "CLIENT-001",
  "amount": 100,
  "admin_id": "ADMIN-001"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Wallet debited successfully",
  "data": {
    "client_id": "CLIENT-001",
    "amount": 100,
    "new_balance": 900
  }
}
```

### Client Wallet Operations

#### GET `/wallet/balance`
Get current wallet balance

**Headers:** `client-id: CLIENT-001`

**Response:**
```json
{
  "success": true,
  "data": {
    "client_id": "CLIENT-001",
    "balance": 900,
    "status": "active"
  }
}
```

#### GET `/wallet/history?page=1&limit=20`
Get transaction history with pagination

**Headers:** `client-id: CLIENT-001`

**Response:**
```json
{
  "success": true,
  "data": {
    "transactions": [...],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 100,
      "pages": 5
    }
  }
}
```

### Order Operations

#### POST `/orders`
Create order with atomic wallet deduction

**Headers:** `client-id: CLIENT-001`  
**Body:**
```json
{
  "amount": 250,
  "idempotency_key": "ORD-IDEMPOTENT-001"
}
```

**Flow:**
1. Validates balance (atomic check)
2. Deducts amount from wallet (transaction)
3. Creates PENDING order
4. Calls fulfillment API
5. Updates order status to FULFILLED
6. OR on API failure: reverts wallet + marks FAILED

**Response (201 Created):**
```json
{
  "success": true,
  "message": "Order created and fulfilled successfully",
  "data": {
    "order_id": "ORD-1709371200000-a1b2c3d4",
    "client_id": "CLIENT-001",
    "amount": 250,
    "status": "FULFILLED",
    "fulfillment_id": "101",
    "created_at": "2026-03-02T10:10:00Z"
  }
}
```

#### GET `/orders/:order_id`
Get order details

**Headers:** `client-id: CLIENT-001`

**Response:**
```json
{
  "success": true,
  "data": {
    "order_id": "ORD-1709371200000-a1b2c3d4",
    "amount": 250,
    "status": "FULFILLED",
    "fulfillment_id": "101"
  }
}
```



**Last Updated**: March 2, 2026

