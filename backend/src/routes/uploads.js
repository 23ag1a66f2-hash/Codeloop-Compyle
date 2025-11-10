const express = require('express');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

router.post('/note', requirePermission('manage_notes'), (req, res) => {
  res.json({
    success: true,
    message: 'File upload routes - to be implemented'
  });
});

module.exports = router;