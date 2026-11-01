const nodemailer = require('nodemailer');
const { env } = require('../config/env');
const { OTP } = require('../config/constants');
const { HttpError } = require('../utils/httpError');

const isConfigured = () => !!(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);

let transport;
const getTransport = () =>
  transport ||
  (transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  }));

async function sendOtp(to, otp) {
  try {
    await getTransport().sendMail({
      from: env.SMTP_FROM || env.SMTP_USER,
      to,
      subject: `${env.SHOP_NAME}: your password reset code`,
      text: `Your one-time code is ${otp}. It expires in ${OTP.MINUTES} minutes. If you did not ask for this, ignore this email.`,
    });
  } catch (e) {
    console.error('[mail] send failed:', e.message);
    throw new HttpError(502, 'Could not send the email. Please try again later.');
  }
}

module.exports = { isConfigured, sendOtp };
