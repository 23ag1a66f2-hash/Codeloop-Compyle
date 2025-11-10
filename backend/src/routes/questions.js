const express = require('express');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Question routes - to be implemented',
    data: []
  });
});

module.exports = router;