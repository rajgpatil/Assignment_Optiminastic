/**
 * Admin Routes
 * 
 * Routes for admin wallet operations:
 * - Credit wallet
 * - Debit wallet
 */

const express = require('express');
const WalletController = require('../controllers/walletController');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

/**
 * POST /admin/wallet/credit
 * Credit client's wallet
 */
router.post(
  '/wallet/credit',
  asyncHandler(WalletController.creditWallet)
);

/**
 * POST /admin/wallet/debit
 * Debit client's wallet
 */
router.post(
  '/wallet/debit',
  asyncHandler(WalletController.debitWallet)
);

module.exports = router;
