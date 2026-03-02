/**
 * Wallet Controller
 * 
 * Handles wallet operations with:
 * - Input validation
 * - Balance updates
 * - Ledger recording
 * - Error handling
 */

const Wallet = require('../models/Wallet');
const Ledger = require('../models/Ledger');
const { ValidationError, InsufficientBalanceError, NotFoundError } = require('../middleware/errorHandler');

class WalletController {
  /**
   * Admin credit wallet
   * Adds amount to client's wallet
   *
   * @param {Object} req - Express request
   * @param {Object} res - Express response
   * @param {Object} next - Express next function
   */
  static async creditWallet(req, res, next) {
    try {
      const { client_id, amount } = req.body;

      // Validation
      if (!client_id || !amount) {
        throw new ValidationError('client_id and amount are required');
      }

      if (typeof amount !== 'number' || amount <= 0) {
        throw new ValidationError('amount must be a positive number');
      }

      if (amount > 999999999) {
        throw new ValidationError('amount exceeds maximum limit');
      }

      // Convert to integer (cents/paise)
      const intAmount = Math.floor(amount * 100) / 100;

      // Find or create wallet
      let wallet = await Wallet.findOne({ client_id });

      if (!wallet) {
        wallet = await Wallet.create({
          client_id,
          balance: 0,
          version: 0,
        });
      }

      // Check wallet status
      if (wallet.status !== 'active') {
        throw new ValidationError(
          `Wallet is ${wallet.status} and cannot accept credits`
        );
      }

      // Update balance
      const newBalance = wallet.balance + intAmount;
      wallet.balance = newBalance;
      wallet.total_credited += intAmount;
      wallet.version += 1;
      wallet.last_transaction_at = new Date();

      await wallet.save();

      // Record ledger entry
      await Ledger.create({
        client_id,
        transaction_type: 'CREDIT',
        amount: intAmount,
        balance_after: newBalance,
        reference: req.body.reference || null,
        description: `Admin credit: ${intAmount}`,
        initiated_by: req.body.admin_id || 'system',
        metadata: {
          ip_address: req.ip,
          user_agent: req.get('user-agent'),
        },
      });

      res.status(200).json({
        success: true,
        message: 'Wallet credited successfully',
        data: {
          client_id,
          amount: intAmount,
          new_balance: newBalance,
          transaction_id: wallet._id,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Admin debit wallet
   * Removes amount from client's wallet
   *
   * @param {Object} req - Express request
   * @param {Object} res - Express response
   * @param {Object} next - Express next function
   */
  static async debitWallet(req, res, next) {
    try {
      const { client_id, amount } = req.body;

      // Validation
      if (!client_id || !amount) {
        throw new ValidationError('client_id and amount are required');
      }

      if (typeof amount !== 'number' || amount <= 0) {
        throw new ValidationError('amount must be a positive number');
      }

      const intAmount = Math.floor(amount * 100) / 100;

      // Get wallet
      const wallet = await Wallet.findOne({ client_id });

      if (!wallet) {
        throw new NotFoundError(`Wallet not found for client ${client_id}`);
      }

      // Check wallet status
      if (wallet.status !== 'active') {
        throw new ValidationError(
          `Wallet is ${wallet.status} and cannot accept debits`
        );
      }

      // Check balance
      if (wallet.balance < intAmount) {
        throw new InsufficientBalanceError(
          `Insufficient balance. Required: ${intAmount}, Available: ${wallet.balance}`
        );
      }

      // Update balance
      const newBalance = wallet.balance - intAmount;
      wallet.balance = newBalance;
      wallet.total_debited += intAmount;
      wallet.version += 1;
      wallet.last_transaction_at = new Date();

      await wallet.save();

      // Record ledger entry
      await Ledger.create({
        client_id,
        transaction_type: 'DEBIT',
        amount: intAmount,
        balance_after: newBalance,
        reference: req.body.reference || null,
        description: `Admin debit: ${intAmount}`,
        initiated_by: req.body.admin_id || 'system',
        metadata: {
          ip_address: req.ip,
          user_agent: req.get('user-agent'),
        },
      });

      res.status(200).json({
        success: true,
        message: 'Wallet debited successfully',
        data: {
          client_id,
          amount: intAmount,
          new_balance: newBalance,
          transaction_id: wallet._id,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get wallet balance for a client
   * Lightweight query with caching capability
   *
   * @param {Object} req - Express request
   * @param {Object} res - Express response
   * @param {Object} next - Express next function
   */
  static async getBalance(req, res, next) {
    try {
      const client_id = req.headers['client-id'];

      if (!client_id) {
        throw new ValidationError('client-id header is required');
      }

      const wallet = await Wallet.findOne({ client_id }).select(
        'client_id balance status updated_at total_credited total_debited'
      );

      if (!wallet) {
        throw new NotFoundError(`Wallet not found for client ${client_id}`);
      }

      res.status(200).json({
        success: true,
        data: {
          client_id: wallet.client_id,
          balance: wallet.balance,
          status: wallet.status,
          total_credited: wallet.total_credited,
          total_debited: wallet.total_debited,
          last_updated: wallet.updated_at,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get wallet transaction history
   * Supports pagination for scalability
   *
   * @param {Object} req - Express request
   * @param {Object} res - Express response
   * @param {Object} next - Express next function
   */
  static async getHistory(req, res, next) {
    try {
      const client_id = req.headers['client-id'];
      const { page = 1, limit = 20 } = req.query;

      if (!client_id) {
        throw new ValidationError('client-id header is required');
      }

      const skip = (parseInt(page) - 1) * parseInt(limit);
      const maxLimit = 100; // Prevent DoS attacks
      const queryLimit = Math.min(parseInt(limit), maxLimit);

      const transactions = await Ledger.getClientHistory(
        client_id,
        queryLimit,
        skip
      );

      const total = await Ledger.countDocuments({ client_id });

      res.status(200).json({
        success: true,
        data: {
          transactions,
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

module.exports = WalletController;
