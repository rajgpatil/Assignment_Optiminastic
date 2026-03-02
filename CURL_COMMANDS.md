# API Usage Examples

## Overview
This document provides sample curl commands for all API endpoints.

## Prerequisites
```bash
# Install dependencies
npm install

# Set up .env file (already provided)

# Start MongoDB (ensure running on localhost:27017)
mongod

# Start the server
npm start
# OR for development with auto-reload
npm run dev
```

---

## 1. Admin Wallet Operations

### 1.1 Credit Wallet
Add funds to a client's wallet

```bash
curl -X POST http://localhost:3000/admin/wallet/credit \
  -H "Content-Type: application/json" \
  -d '{
    "client_id": "CLIENT-001",
    "amount": 1000,
    "admin_id": "ADMIN-001",
    "reference": "INITIAL_CREDIT"
  }'
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

### 1.2 Debit Wallet
Remove funds from a client's wallet

```bash
curl -X POST http://localhost:3000/admin/wallet/debit \
  -H "Content-Type: application/json" \
  -d '{
    "client_id": "CLIENT-001",
    "amount": 100,
    "admin_id": "ADMIN-001",
    "reference": "MAINTENANCE_FEE"
  }'
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Wallet debited successfully",
  "data": {
    "client_id": "CLIENT-001",
    "amount": 100,
    "new_balance": 900,
    "transaction_id": "507f1f77bcf86cd799439011"
  }
}
```

**Error - Insufficient Balance (402):**
```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "Insufficient balance. Required: 1000, Available: 900",
    "timestamp": "2026-03-02T10:00:00.000Z"
  }
}
```

---

## 2. Client Wallet Operations

### 2.1 Get Wallet Balance
Check current wallet balance

```bash
curl -X GET http://localhost:3000/wallet/balance \
  -H "client-id: CLIENT-001"
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "client_id": "CLIENT-001",
    "balance": 900,
    "status": "active",
    "total_credited": 1000,
    "total_debited": 100,
    "last_updated": "2026-03-02T10:00:00.000Z"
  }
}
```

### 2.2 Get Transaction History
Retrieve wallet transaction history with pagination

```bash
curl -X GET "http://localhost:3000/wallet/history?page=1&limit=10" \
  -H "client-id: CLIENT-001"
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "transactions": [
      {
        "_id": "507f1f77bcf86cd799439011",
        "client_id": "CLIENT-001",
        "transaction_type": "DEBIT",
        "amount": 100,
        "balance_after": 900,
        "description": "Admin debit: 100",
        "created_at": "2026-03-02T10:05:00.000Z"
      },
      {
        "_id": "507f1f77bcf86cd799439010",
        "client_id": "CLIENT-001",
        "transaction_type": "CREDIT",
        "amount": 1000,
        "balance_after": 1000,
        "description": "Admin credit: 1000",
        "created_at": "2026-03-02T10:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 10,
      "total": 2,
      "pages": 1
    }
  }
}
```

---

## 3. Order Operations

### 3.1 Create Order
Create an order with atomic wallet deduction

The API will:
1. Deduct amount from wallet
2. Create order with PENDING status
3. Call fulfillment API
4. Update order to FULFILLED
5. Refund if fulfillment fails

```bash
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -H "client-id: CLIENT-001" \
  -d '{
    "amount": 250,
    "idempotency_key": "ORD-IDEMPOTENT-001"
  }'
```

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
    "created_at": "2026-03-02T10:10:00.000Z"
  }
}
```

**Idempotency - Same Request Again:**
```bash
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -H "client-id: CLIENT-001" \
  -d '{
    "amount": 250,
    "idempotency_key": "ORD-IDEMPOTENT-001"
  }'
```

**Response (200 OK) - Returns existing order:**
```json
{
  "success": true,
  "message": "Order already exists (idempotency)",
  "data": {
    "order_id": "ORD-1709371200000-a1b2c3d4",
    "status": "FULFILLED",
    "fulfillment_id": "101"
  }
}
```

**Error - Insufficient Balance (402):**
```json
{
  "success": false,
  "message": "Order creation failed due to insufficient balance",
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "details": "Insufficient balance. Required: 250, Available: 0"
  }
}
```

**Error - API Failure with Refund (402):**
```json
{
  "success": false,
  "message": "Order creation failed due to fulfillment API error",
  "error": {
    "code": "FULFILLMENT_API_ERROR",
    "details": "Fulfillment API call failed: timeout",
    "order_id": "ORD-1709371200000-x1y2z3w4",
    "amount_refunded": 250
  }
}
```

### 3.2 Get Order Details
Retrieve specific order information

```bash
curl -X GET http://localhost:3000/orders/ORD-1709371200000-a1b2c3d4 \
  -H "client-id: CLIENT-001"
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "order_id": "ORD-1709371200000-a1b2c3d4",
    "amount": 250,
    "status": "FULFILLED",
    "fulfillment_id": "101",
    "created_at": "2026-03-02T10:10:00.000Z",
    "fulfilled_at": "2026-03-02T10:10:05.000Z"
  }
}
```

**Error - Order Not Found:**
```bash
curl -X GET http://localhost:3000/orders/INVALID-ORDER-ID \
  -H "client-id: CLIENT-001"
```

**Response (404 Not Found):**
```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Order INVALID-ORDER-ID not found or does not belong to this client",
    "timestamp": "2026-03-02T10:00:00.000Z"
  }
}
```

### 3.3 List Client Orders
Get all orders for a client with pagination and filtering

```bash
# List all orders
curl -X GET "http://localhost:3000/orders?page=1&limit=10" \
  -H "client-id: CLIENT-001"

# List only fulfilled orders
curl -X GET "http://localhost:3000/orders?page=1&limit=10&status=FULFILLED" \
  -H "client-id: CLIENT-001"

# List failed orders
curl -X GET "http://localhost:3000/orders?page=1&limit=10&status=FAILED" \
  -H "client-id: CLIENT-001"
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "orders": [
      {
        "order_id": "ORD-1709371200000-a1b2c3d4",
        "amount": 250,
        "status": "FULFILLED",
        "fulfillment_id": "101",
        "created_at": "2026-03-02T10:10:00.000Z",
        "fulfilled_at": "2026-03-02T10:10:05.000Z"
      },
      {
        "order_id": "ORD-1709370900000-b2c3d4e5",
        "amount": 150,
        "status": "FULFILLED",
        "fulfillment_id": "100",
        "created_at": "2026-03-02T10:05:00.000Z",
        "fulfilled_at": "2026-03-02T10:05:03.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 10,
      "total": 2,
      "pages": 1
    }
  }
}
```

---

## 4. Health Check

### 4.1 Server Health
Check if server is running and healthy

```bash
curl -X GET http://localhost:3000/health
```

**Response (200 OK):**
```json
{
  "status": "healthy",
  "timestamp": "2026-03-02T10:00:00.000Z",
  "uptime": 3600.5
}
```

---

## Error Response Format

All error responses follow this structure:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable error message",
    "timestamp": "2026-03-02T10:00:00.000Z"
  }
}
```

### Common Error Codes
- `VALIDATION_ERROR` (400): Invalid input data
- `INSUFFICIENT_BALANCE` (402): Not enough wallet balance
- `NOT_FOUND` (404): Resource not found
- `DUPLICATE_ENTRY` (409): Duplicate record
- `FULFILLMENT_API_ERROR` (502): External API failure
- `DATABASE_CONNECTION_ERROR` (503): MongoDB unavailable
- `INTERNAL_SERVER_ERROR` (500): Unexpected server error

---

## Complete End-to-End Scenario

```bash
#!/bin/bash

# 1. Credit wallet with 5000
curl -X POST http://localhost:3000/admin/wallet/credit \
  -H "Content-Type: application/json" \
  -d '{"client_id": "CLIENT-001", "amount": 5000}'

# 2. Check balance (should be 5000)
curl -X GET http://localhost:3000/wallet/balance \
  -H "client-id: CLIENT-001"

# 3. Create first order (250)
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -H "client-id: CLIENT-001" \
  -d '{"amount": 250}'

# 4. Create second order (300)
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -H "client-id: CLIENT-001" \
  -d '{"amount": 300}'

# 5. Check balance again (should be 5000 - 250 - 300 = 4450)
curl -X GET http://localhost:3000/wallet/balance \
  -H "client-id: CLIENT-001"

# 6. List all orders
curl -X GET "http://localhost:3000/orders?limit=10" \
  -H "client-id: CLIENT-001"

# 7. View transaction history
curl -X GET "http://localhost:3000/wallet/history?limit=10" \
  -H "client-id: CLIENT-001"
```

---

## Testing with Postman

Import this as a Postman environment:

```json
{
  "name": "Wallet System",
  "values": [
    {
      "key": "base_url",
      "value": "http://localhost:3000",
      "enabled": true
    },
    {
      "key": "client_id",
      "value": "CLIENT-001",
      "enabled": true
    },
    {
      "key": "admin_id",
      "value": "ADMIN-001",
      "enabled": true
    }
  ]
}
```

Then use in requests:
```
{{base_url}}/wallet/balance
```

---

## Performance Testing

### Load test with Apache Bench (installing orders)

```bash
# Install Apache Bench
# macOS: brew install httpd
# Linux: sudo apt-get install apache2-utils

# Test with 100 concurrent requests, 1000 total requests
ab -n 1000 -c 100 \
  -H "client-id: CLIENT-001" \
  -p order.json \
  -T application/json \
  http://localhost:3000/orders
```

Create `order.json`:
```json
{
  "amount": 10
}
```

---

## MongoDB Connection String

If using MongoDB Atlas:

```
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/wallet-system?retryWrites=true&w=majority
```

Connection string with replica set (for transactions):
```
MONGODB_URI=mongodb://localhost:27017/wallet-system?replicaSet=rs0
```

To set up MongoDB with transactions locally:

```bash
# Start MongoDB as a replica set
mongod --replSet rs0

# In mongo shell, initialize replica set
rs.initiate({
  _id: "rs0",
  members: [{ _id: 0, host: "localhost:27017" }]
})
```
