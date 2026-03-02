/**
 * Order Model
 * 
 * Stores order information with:
 * - Status transitions with state machine validation
 * - Fulfillment tracking
 * - Comprehensive audit trail
 * - Indexes for efficient queries at scale
 */

const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema(
  {
    // Order identifier for external references
    order_id: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },

    // Client who placed the order
    client_id: {
      type: String,
      required: true,
      // Composite index for finding client orders
      index: true,
    },

    // Order amount in smallest currency unit
    amount: {
      type: Number,
      required: true,
      min: 1,
      // Index for range queries (e.g., orders > 1000)
      index: true,
    },

    // Order status state machine
    // PENDING: Created, awaiting fulfillment API call
    // FULFILLED: Fulfillment API returned successfully
    // FAILED: Fulfillment API failed, wallet reverted
    // CANCELLED: Client cancelled order
    status: {
      type: String,
      enum: ['PENDING', 'FULFILLED', 'FAILED', 'CANCELLED'],
      default: 'PENDING',
      index: true,
    },

    // Fulfillment API response ID
    fulfillment_id: {
      type: String,
      default: null,
      sparse: true,
      index: true,
    },

    // Fulfillment API response details (for debugging)
    fulfillment_response: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    // Error details if fulfillment failed
    error_details: {
      code: String,
      message: String,
      timestamp: Date,
      retry_count: {
        type: Number,
        default: 0,
      },
    },

    // Idempotency key to prevent duplicate processing
    idempotency_key: {
      type: String,
      sparse: true,
      index: true,
    },

    // Timestamps
    created_at: {
      type: Date,
      default: Date.now,
      index: true,
    },

    fulfilled_at: {
      type: Date,
      default: null,
    },

    updated_at: {
      type: Date,
      default: Date.now,
    },

    // For debugging and monitoring
    metadata: {
      ip_address: String,
      user_agent: String,
      source: String,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

// Composite indexes for common queries
orderSchema.index({ client_id: 1, created_at: -1 });
orderSchema.index({ client_id: 1, status: 1 });
orderSchema.index({ status: 1, created_at: -1 });
// TTL index for automatic cleanup of failed orders (configurable)
orderSchema.index({ created_at: 1 }, { 
  expireAfterSeconds: 2592000 // 30 days
});

// Pre-save middleware for audit trail
orderSchema.pre('save', function (next) {
  this.updated_at = new Date();
  next();
});

/**
 * Safely transition order status
 * Prevents invalid state transitions
 */
orderSchema.methods.transitionStatus = async function (newStatus, options = {}) {
  const validTransitions = {
    PENDING: ['FULFILLED', 'FAILED', 'CANCELLED'],
    FULFILLED: ['CANCELLED'], // Can cancel fulfilled orders
    FAILED: ['CANCELLED'],
    CANCELLED: [],
  };

  if (!validTransitions[this.status]?.includes(newStatus)) {
    throw new Error(
      `Invalid status transition from ${this.status} to ${newStatus}`
    );
  }

  this.status = newStatus;

  if (newStatus === 'FULFILLED') {
    this.fulfilled_at = new Date();
  }

  if (options.fulfillment_id) {
    this.fulfillment_id = options.fulfillment_id;
  }

  if (options.fulfillment_response) {
    this.fulfillment_response = options.fulfillment_response;
  }

  if (options.error) {
    this.error_details = {
      code: options.error.code || 'UNKNOWN',
      message: options.error.message || 'Unknown error',
      timestamp: new Date(),
      retry_count: (this.error_details?.retry_count || 0) + 1,
    };
  }

  return this.save();
};

const Order = mongoose.model('Order', orderSchema);

module.exports = Order;
