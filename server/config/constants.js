// Values shared by validation + business rules. Must match the frontend (public/app.js).
const CATS = [
  'Makeup Products', 'Skincare Products', 'Haircare Products', 'Salon Supplies and Tools',
  'Beauty and Makeup Accessories', 'Fashion Accessories', 'Other Beauty Products',
];
const COMBO = 'Beauty Combos & Gift Sets';
const KIND = ['lip', 'ser', 'sham', 'brush', 'brush', 'pearl', 'perf']; // product artwork per category
const HUES = [340, 30, 38, 300, 12, 285];
const MEASURE_UNITS = ['pcs', 'bottle', 'jar', 'tube', 'pack', 'box', 'set'];

const FAR_KM = 10;            // deliveries above this need owner approval
const FREE_DELIVERY_FROM = 999;
const STANDARD_DELIVERY = 49;
const LOW_STOCK = 5;

const BLK_MSG = 'Your account is blocked from placing new orders. You can still view your past orders. Please contact the store owner for help.';
const DUP_EMAIL = 'Email already exists. Please log in or use Forgot Password.';

const OTP = { MINUTES: 5, TRIES: 5, COOLDOWN_SEC: 60, HOURLY: 5 };

module.exports = {
  CATS, COMBO, KIND, HUES, MEASURE_UNITS, FAR_KM, FREE_DELIVERY_FROM, STANDARD_DELIVERY,
  LOW_STOCK, BLK_MSG, DUP_EMAIL, OTP,
};
