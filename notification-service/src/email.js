// Builds and sends emails.
// With SMTP_HOST set, real emails are sent (nodemailer).
// Without it, the email is printed in the service log, which is enough for a demo.

const { log } = require('./util');

const money = (n) => `Rs. ${Number(n).toFixed(2)}`;

// Pure function: event -> email content (easy to test)
function buildEmail(eventType, payload) {
  if (eventType === 'ORDER_CONFIRMED') {
    return {
      subject: `Order confirmed (${money(payload.total)})`,
      text: `Thank you! Your payment was received and your order ${payload.orderId} is confirmed.\nTotal: ${money(payload.total)}`,
    };
  }
  if (eventType === 'ORDER_CANCELLED') {
    return {
      subject: 'Your order was cancelled',
      text: `Your order ${payload.orderId} could not be completed.\nReason: ${payload.reason || 'Payment failed'}\nYou were not charged and the items are back in stock. You can try again from your cart.`,
    };
  }
  return null;
}

function createSender() {
  const from = process.env.EMAIL_FROM || 'SmartCart <no-reply@smartcart.dev>';

  if (!process.env.SMTP_HOST) {
    return {
      mode: 'console',
      async send({ to, subject, text }) {
        log(`EMAIL (console mode) to=${to} subject="${subject}"\n${text}`);
      },
    };
  }

  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return {
    mode: 'smtp',
    async send({ to, subject, text }) {
      await transporter.sendMail({ from, to, subject, text });
      log(`email sent to ${to}: ${subject}`);
    },
  };
}

module.exports = { buildEmail, createSender };
