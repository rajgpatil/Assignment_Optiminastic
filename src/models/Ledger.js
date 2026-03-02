/**
 * Ledger Model
 * 
 * Immutable transaction history for:
 * - Audit trail and compliance
 * - Debugging transaction issues
 * - Analytics and reporting
 * - Never delete, only append (immutable ledger pattern)
 * 
 * Design notes:
 * - Large volume of writes (ledger entries)
 * - TTL index for retention policies
 * - Capped collection option (future enhancement for circular buffers)
 */

const mongoose = require('mongoose');

const ledgerSchema = new mongoose.Schema(
  {
    // Client identifier
    client_id: {
      type: String,
      required: true,
      index: true,
    },

    // Transaction type
    transaction_type: {
      type: String,
      enum: [
        'CREDIT', // Admin credit
        'DEBIT', // Admin debit
        'ORDER_DEBIT', // Order amount deduction
        'ORDER_REFUND', // Order refund on failure
        'ADJUSTMENT', // Manual adjustment
      ],
      required: true,
      index: true,
    },

    // Amount changed (always positive, use transaction_type for direction)
    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    // Balance after transaction
    balance_after: {
      type: Number,
      required: true,
      min: 0,
    },

    // Reference to related document
    reference: {
      type: String, // Order ID or admin action ID
      default: null,
      sparse: true,
      index: true,
    },

    // Description for debugging
    description: {
      type: String,
      default: null,
    },

    // Admin/System action details
    initiated_by: {
      type: String, // admin or system
      default: 'system',
    },

    // For chargeback/refund scenarios
    related_transaction_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      sparse: true,
    },

    // Status of transaction
    status: {
      type: String,
      enum: ['SUCCESS', 'FAILED', 'PENDING'],
      default: 'SUCCESS',
    },

    // Timestamp (immutable on creation)
    created_at: {
      type: Date,
      default: Date.now,
      index: true,
      // Automatic deletion after 7 years (compliance requirement)
      expires: 220752000, // 7 years in seconds
    },

    // Additional metadata
    metadata: {
      ip_address: String,
      user_agent: String,
      transaction_hash: String, // For idempotency checking
    },
  },
  {
    timestamps: false, // Ledger is immutable, no updates
  }
);

// Compound indexes for efficient queries
ledgerSchema.index({ client_id: 1, created_at: -1 });
ledgerSchema.index({ client_id: 1, transaction_type: 1 });
ledgerSchema.index({ reference: 1 });

// Prevent any updates to ledger entries
ledgerSchema.pre('updateOne', function (next) {
  throw new Error('Ledger entries are immutable and cannot be updated');
});

ledgerSchema.pre('updateMany', function (next) {
  throw new Error('Ledger entries are immutable and cannot be updated');
});

ledgerSchema.pre('findByIdAndUpdate', function (next) {
  throw new Error('Ledger entries are immutable and cannot be updated');
});

/**
 * Create a ledger entry with validation
 */
ledgerSchema.statics.recordTransaction = async function (
  clientId,
  transactionType,
  amount,
  balanceAfter,
  reference,
  description,
  initiatedBy = 'system',
  metadata = {}
) {
  // Validate inputs
  if (!clientId) throw new Error('Client ID is required');
  if (!transactionType) throw new Error('Transaction type is required');
  if (amount < 0) throw new Error('Amount must be positive');
  if (balanceAfter < 0) throw new Error('Balance cannot be negative');

  return this.create({
    client_id: clientId,
    transaction_type: transactionType,
    amount,
    balance_after: balanceAfter,
    reference: reference || null,
    description,
    initiated_by: initiatedBy,
    metadata,
    status: 'SUCCESS',
  });
};

/**
 * Get transaction history for a client
 * Useful for debugging and analytics
 */
ledgerSchema.statics.getClientHistory = async function (
  clientId,
  limit = 50,
  skip = 0
) {
  return this.find({ client_id: clientId })
    .sort({ created_at: -1 })
    .limit(limit)
    .skip(skip)
    .exec();
};

/**
 * Get balance history over time (for analytics)
 */
ledgerSchema.statics.getBalanceSnapshot = async function (clientId, date) {
  return this.findOne({
    client_id: clientId,
    created_at: { $lte: new Date(date) },
  })
    .sort({ created_at: -1 })
    .select('balance_after')
    .exec();
};

const Ledger = mongoose.model('Ledger', ledgerSchema);

module.exports = Ledger;
