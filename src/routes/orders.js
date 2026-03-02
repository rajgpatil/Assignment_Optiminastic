/**
 * Order Routes
 * 
 * Client routes for:
 * - Creating orders
 * - Retrieving order details
 * - Listing client's orders
 */

const express = require('express');
const OrderController = require('../controllers/orderController');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

/**
 * POST /orders
 * Create new order with atomic wallet deduction
 *
 * Headers: client-id (required)
 * Body: {
 *   amount: number,
 *   idempotency_key?: string
 * }
 */
router.post('/', asyncHandler(OrderController.createOrder));

/**
 * GET /orders/:order_id
 * Get order details
 *
 * Headers: client-id (required)
 * Params: order_id
 */
router.get('/:order_id', asyncHandler(OrderController.getOrder));

/**
 * GET /orders
 * List all orders for client with pagination
 *
 * Headers: client-id (required)
 * Query: page=1, limit=20, status=FULFILLED|PENDING|FAILED
 */
router.get('/', asyncHandler(OrderController.listOrders));

module.exports = router;
