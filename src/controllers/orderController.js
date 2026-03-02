/**
 * Order Controller
 * 
 * Handles order operations with:
 * - Balance validation and wallet deduction
 * - External fulfillment API integration
 * - Rollback on API failures
 * - Idempotency handling
 * - Comprehensive error handling
 */

const Order = require('../models/Order');
const Wallet = require('../models/Wallet');
const Ledger = require('../models/Ledger');
const { callFulfillmentAPI } = require('../utils/fulfillmentAPI');
const {
  ValidationError,
  InsufficientBalanceError,
  NotFoundError,
  ExternalAPIError,
} = require('../middleware/errorHandler');

const crypto = require('crypto');

class OrderController {
  /**
   * Create order with atomic wallet deduction
   *
   * Flow:
   * 1. Validate input and check wallet balance
   * 2. Deduct amount from wallet
   * 3. Create order with PENDING status
   * 4. Create ledger entry
   * 5. Call fulfillment API
   * 6. Update order with fulfillment details
   * 7. On API failure: rollback wallet deduction
   *
   * @param {Object} req - Express request
   * @param {Object} res - Express response
   * @param {Object} next - Express next function
   */
  static async createOrder(req, res, next) {
    try {
      const client_id = req.headers['client-id'];
      const { amount, idempotency_key } = req.body;

      // ============================================
      // 1. VALIDATE INPUTS
      // ============================================

      if (!client_id) {
        throw new ValidationError('client-id header is required');
      }

      if (!amount || typeof amount !== 'number' || amount <= 0) {
        throw new ValidationError('amount must be a positive number');
      }

      const intAmount = Math.floor(amount * 100) / 100;

      // Idempotency: Check if order with same key already exists
      if (idempotency_key) {
        const existingOrder = await Order.findOne({ idempotency_key });
        if (existingOrder) {
          // Return previous response to ensure idempotency
          return res.status(200).json({
            success: true,
            message: 'Order already exists (idempotency)',
            data: {
              order_id: existingOrder.order_id,
              status: existingOrder.status,
              fulfillment_id: existingOrder.fulfillment_id,
            },
          });
        }
      }

      // ============================================
      // 2. CHECK WALLET BALANCE AND DEDUCT
      // ============================================

      const wallet = await Wallet.findOne({ client_id });

      if (!wallet) {
        throw new NotFoundError(`Wallet not found for client ${client_id}`);
      }

      if (wallet.status !== 'active') {
        throw new ValidationError(`Wallet is ${wallet.status}`);
      }

      if (wallet.balance < intAmount) {
        throw new InsufficientBalanceError(
          `Insufficient balance. Required: ${intAmount}, Available: ${wallet.balance}`
        );
      }

      // Deduct amount from wallet
      const newBalance = wallet.balance - intAmount;
      wallet.balance = newBalance;
      wallet.version += 1;
      wallet.last_transaction_at = new Date();

      await wallet.save();

      // Create ledger entry for deduction
      await Ledger.create({
        client_id,
        transaction_type: 'ORDER_DEBIT',
        amount: intAmount,
        balance_after: newBalance,
        reference: null, // Will be updated with order_id
        description: `Order payment: ${intAmount}`,
        initiated_by: 'system',
        metadata: {
          ip_address: req.ip,
          user_agent: req.get('user-agent'),
        },
      });

      // ============================================
      // 3. CREATE ORDER IN PENDING STATE
      // ============================================

      const order_id = `ORD-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

      const order = await Order.create({
        order_id,
        client_id,
        amount: intAmount,
        status: 'PENDING',
        idempotency_key: idempotency_key || null,
        metadata: {
          ip_address: req.ip,
          user_agent: req.get('user-agent'),
        },
      });

      // ============================================
      // 4. CALL EXTERNAL FULFILLMENT API
      // ============================================

      let fulfillmentResponse;
      let fulfillmentError = null;

      try {
        fulfillmentResponse = await callFulfillmentAPI({
          userId: client_id,
          title: order_id,
        });
      } catch (apiError) {
        fulfillmentError = apiError;
        console.error('Fulfillment API failed:', apiError.message);
      }

      // ============================================
      // 5. UPDATE ORDER STATUS
      // ============================================

      if (fulfillmentError) {
        // API failed - ROLLBACK wallet deduction
        await OrderController.rollbackWalletDeduction(
          client_id,
          intAmount,
          order_id
        );

        await order.transitionStatus('FAILED', {
          error: {
            code: fulfillmentError.code || 'API_ERROR',
            message: fulfillmentError.message,
          },
        });

        res.status(402).json({
          success: false,
          message: 'Order creation failed due to fulfillment API error',
          error: {
            code: 'FULFILLMENT_API_ERROR',
            details: fulfillmentError.message,
            order_id: order_id,
            amount_refunded: intAmount,
          },
        });
      } else {
        // API succeeded - UPDATE order with fulfillment details
        await order.transitionStatus('FULFILLED', {
          fulfillment_id: fulfillmentResponse.id,
          fulfillment_response: fulfillmentResponse,
        });

        res.status(201).json({
          success: true,
          message: 'Order created and fulfilled successfully',
          data: {
            order_id: order.order_id,
            client_id: order.client_id,
            amount: order.amount,
            status: order.status,
            fulfillment_id: order.fulfillment_id,
            created_at: order.created_at,
          },
        });
      }
    } catch (error) {
      next(error);
    }
  }

  /**
   * Rollback wallet deduction on fulfillment API failure
   * Restores balance and creates refund ledger entry
   *
   * @private
   */
  static async rollbackWalletDeduction(client_id, amount, order_id) {
    try {
      const wallet = await Wallet.findOne({ client_id });

      if (!wallet) {
        throw new Error(`Wallet not found during rollback for ${client_id}`);
      }

      // Restore balance
      const newBalance = wallet.balance + amount;
      wallet.balance = newBalance;
      wallet.version += 1;

      await wallet.save();

      // Record refund ledger entry
      await Ledger.create({
        client_id,
        transaction_type: 'ORDER_REFUND',
        amount,
        balance_after: newBalance,
        reference: order_id,
        description: `Order refund due to fulfillment failure: ${order_id}`,
        initiated_by: 'system',
      });

      console.log(`Wallet rollback completed for order ${order_id}`);
    } catch (error) {
      console.error('Wallet rollback failed:', error.message);
      throw error;
    }
  }

  /**
   * Get order details
   * Validates client ownership before returning
   *
   * @param {Object} req - Express request
   * @param {Object} res - Express response
   * @param {Object} next - Express next function
   */
  static async getOrder(req, res, next) {
    try {
      const client_id = req.headers['client-id'];
      const { order_id } = req.params;

      if (!client_id) {
        throw new ValidationError('client-id header is required');
      }

      if (!order_id) {
        throw new ValidationError('order_id is required');
      }

      const order = await Order.findOne({
        order_id,
        client_id, // Ensure client owns this order
      }).select(
        'order_id client_id amount status fulfillment_id created_at fulfilled_at'
      );

      if (!order) {
        throw new NotFoundError(
          `Order ${order_id} not found or does not belong to this client`
        );
      }

      res.status(200).json({
        success: true,
        data: {
          order_id: order.order_id,
          amount: order.amount,
          status: order.status,
          fulfillment_id: order.fulfillment_id,
          created_at: order.created_at,
          fulfilled_at: order.fulfilled_at,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * List client's orders
   * Supports pagination for scalability
   *
   * @param {Object} req - Express request
   * @param {Object} res - Express response
   * @param {Object} next - Express next function
   */
  static async listOrders(req, res, next) {
    try {
      const client_id = req.headers['client-id'];
      const { page = 1, limit = 20, status } = req.query;

      if (!client_id) {
        throw new ValidationError('client-id header is required');
      }

      const skip = (parseInt(page) - 1) * parseInt(limit);
      const maxLimit = 100;
      const queryLimit = Math.min(parseInt(limit), maxLimit);

      const query = { client_id };
      if (status) {
        query.status = status;
      }

      const orders = await Order.find(query)
        .sort({ created_at: -1 })
        .limit(queryLimit)
        .skip(skip)
        .select(
          'order_id amount status fulfillment_id created_at fulfilled_at'
        );

      const total = await Order.countDocuments(query);

      res.status(200).json({
        success: true,
        data: {
          orders,
          pagination: {
            page: parseInt(page),
            limit: queryLimit,
            total,
            pages: Math.ceil(total / queryLimit),
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = OrderController;
