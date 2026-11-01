const router = require('express').Router();
router.use('/', require('./account'));
router.use('/products', require('./products'));
router.use('/orders', require('./orders'));
router.use('/delivery-requests', require('./delivery'));
router.use('/store', require('./store'));
router.use('/buyers', require('./buyers'));
module.exports = router;
