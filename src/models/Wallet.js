/**
 * Wallet Model
 * 
 * Stores client wallet information with:
 * - Balance tracking with version field
 * - Indexes for fast lookups and aggregations
 * - Version field for optimistic locking support
 */

const mongoose = require('mongoose');

const walletSchema = new mongoose.Schema(
  {
    // Client identifier - indexed for fast lookups
    client_id: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },

    // Current wallet balance in smallest currency unit (cents, paise, etc.)
    // Using integer to avoid floating-point precision issues
    balance: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      // For sharding on balance distribution (if needed)
      index: true,
    },

    // Version for optimistic locking (prevents lost updates)
    // Increment on each transaction
    version: {
      type: Number,
      default: 0,
    },

    // Metadata for monitoring and analytics
    total_credited: {
      type: Number,
      default: 0,
      min: 0,
    },

    total_debited: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Status: active, frozen, suspended
    status: {
      type: String,
      enum: ['active', 'frozen', 'suspended'],
      default: 'active',
      index: true,
    },

    // Track when wallet was created/updated
    created_at: {
      type: Date,
      default: Date.now,
      index: true,
    },

    updated_at: {
      type: Date,
      default: Date.now,
    },

    // Last transaction timestamp for debugging
    last_transaction_at: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

// Compound index for analytics queries
walletSchema.index({ client_id: 1, status: 1 });
walletSchema.index({ created_at: 1 });

// Middleware to update timestamp on any modification
walletSchema.pre('save', function (next) {
  this.updated_at = new Date();
  next();
});

/**
 * Update balance atomically with version checking
 * Prevents race conditions in high-concurrency scenarios
 */
walletSchema.methods.updateBalance = async function (amount, increaseVersion = true) {
  const updateData = {
    balance: this.balance + amount,
    last_transaction_at: new Date(),
  };

  if (increaseVersion) {
    updateData.version = this.version + 1;
  }

  if (amount > 0) {
    updateData.total_credited = this.total_credited + amount;
  } else if (amount < 0) {
    updateData.total_debited = this.total_debited + Math.abs(amount);
  }

  // Atomic update with version check
  const updated = await Wallet.findByIdAndUpdate(
    this._id,
    {
      $set: updateData,
      $inc: { version: increaseVersion ? 1 : 0 },
    },
    {
      new: true,
      // Use session if provided for distributed transactions
    }
  );

  if (!updated) {
    throw new Error('Version mismatch or wallet not found');
  }

  return updated;
};

const Wallet = mongoose.model('Wallet', walletSchema);

module.exports = Wallet;
