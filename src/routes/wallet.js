/**
 * Wallet Routes
 * 
 * Client routes for:
 * - Getting wallet balance
 * - Viewing transaction history
 */

const express = require('express');
const WalletController = require('../controllers/walletController');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

/**
 * GET /wallet/balance
 * Get current wallet balance
 *
 * Headers: client-id (required)
 */
router.get('/balance', asyncHandler(WalletController.getBalance));

/**
 * GET /wallet/history
 * Get wallet transaction history with pagination
 *
 * Headers: client-id (required)
 * Query: page=1, limit=20
 */
router.get('/history', asyncHandler(WalletController.getHistory));

module.exports = router;
