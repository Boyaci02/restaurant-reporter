import nodemailer from 'nodemailer';
import fs from 'fs/promises';
import path from 'path';
import { createLogger } from './logger.js';

const MONTH_NAMES_SV = [
  'Januari', 'Februari', 'Mars', 'April', 'Maj', 'Juni',
  'Juli', 'Augusti', 'September', 'Oktober', 'November', 'December'
];

/**
 * Creates a Nodemailer transporter using SendGrid SMTP credentials.
 * @returns {import('nodemailer').Transporter}
 */
function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SENDGRID_SMTP_HOST || 'smtp.sendgrid.net',
    port: Number(process.env.SENDGRID_SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: 'apikey',
      pass: process.env.SENDGRID_API_KEY
    }
  });
}

/**
 * Sends the monthly PDF report to a customer via email.
 * @param {object} customer - Customer object from customers.json
 * @param {string} pdfPath - Absolute path to the PDF file
 * @param {number} month - Month (1-12)
 * @param {number} year - Full year
 * @returns {Promise<void>}
 */
export async function sendReport(customer, pdfPath, month, year) {
  const logger = createLogger('mailer', customer.id);
  const monthName = MONTH_NAMES_SV[month - 1];
  const agencyName = process.env.MAIL_FROM_NAME || 'Rapport';
  const fromAddress = process.env.MAIL_FROM_ADDRESS || '';

  const subject = `Din månadsrapport för ${monthName} ${year} – ${customer.name}`;

  const bodyHtml = `
<!DOCTYPE html>
<html lang="sv">
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: #1a1a2e; padding: 24px; border-radius: 8px 8px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 20px;">${agencyName}</h1>
  </div>
  <div style="background: #f8f9fa; padding: 32px; border-radius: 0 0 8px 8px; border: 1px solid #dee2e6; border-top: none;">
    <p style="font-size: 16px; margin-bottom: 16px;">Hej ${customer.name}!</p>
    <p style="margin-bottom: 16px;">
      Din månadsrapport för <strong>${monthName} ${year}</strong> är nu klar.
      Du hittar den bifogad till detta mejl.
    </p>
    <p style="margin-bottom: 16px;">
      Rapporten innehåller en genomgång av din närvaro på sociala medier,
      Google Business, hemsidestatistik samt AI-genererade insikter och
      rekommendationer för nästa månad.
    </p>
    <p style="margin-bottom: 24px;">
      Hör av dig om du har frågor eller vill diskutera resultaten!
    </p>
    <hr style="border: none; border-top: 1px solid #dee2e6; margin-bottom: 24px;">
    <p style="font-size: 12px; color: #6c757d; margin: 0;">
      ${agencyName} · ${fromAddress}<br>
      Rapporten genereras automatiskt den 1:a varje månad.
    </p>
  </div>
</body>
</html>`;

  const mailOptions = {
    from: `"${agencyName}" <${fromAddress}>`,
    to: customer.contact_email,
    subject,
    html: bodyHtml,
    attachments: [
      {
        filename: path.basename(pdfPath),
        path: pdfPath,
        contentType: 'application/pdf'
      }
    ]
  };

  logger.info('Sending report email', { to: customer.contact_email, subject });

  const transporter = createTransporter();
  const info = await transporter.sendMail(mailOptions);
  logger.info('Email sent successfully', { messageId: info.messageId });
}

/**
 * Sends a test email to verify SendGrid SMTP configuration.
 * Run via: npm run test-mail
 */
export async function testMail() {
  const logger = createLogger('mailer');
  const agencyName = process.env.MAIL_FROM_NAME || 'Rapport';
  const fromAddress = process.env.MAIL_FROM_ADDRESS || '';

  if (!fromAddress) {
    logger.error('MAIL_FROM_ADDRESS not set in .env');
    process.exit(1);
  }

  logger.info('Sending test email', { to: fromAddress });

  const transporter = createTransporter();
  const info = await transporter.sendMail({
    from: `"${agencyName}" <${fromAddress}>`,
    to: fromAddress,
    subject: `[TEST] Restaurant Reporter – SMTP fungerar!`,
    html: `<p>Det här är ett testmejl från Restaurant Reporter. SMTP-konfigurationen fungerar korrekt!</p>`
  });

  logger.info('Test email sent!', { messageId: info.messageId });
  console.log(`\n✅ Testmejl skickat till ${fromAddress} (message ID: ${info.messageId})\n`);
}

// ── CLI entrypoint ───────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('mailer.js') && process.argv.includes('--test')) {
  const { config } = await import('dotenv');
  config();
  await testMail();
}
