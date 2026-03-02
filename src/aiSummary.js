import Anthropic from '@anthropic-ai/sdk';
import { createLogger } from './logger.js';

const client = new Anthropic();

/**
 * Generates an AI-powered summary and recommendations for a restaurant customer
 * using Claude claude-sonnet-4-6.
 * @param {string} customerName - The restaurant's display name
 * @param {object} data - Combined data object from all sources
 * @param {object|null} data.metricool - Metricool social + ads data
 * @param {object|null} data.google - Google Business Profile data
 * @param {object|null} data.plausible - Plausible website analytics data
 * @param {number} month - Month (1-12)
 * @param {number} year - Full year
 * @returns {Promise<{summary: string}>}
 */
export async function generateAISummary(customerName, data, month, year) {
  const logger = createLogger('aiSummary');

  const monthNames = [
    'januari', 'februari', 'mars', 'april', 'maj', 'juni',
    'juli', 'augusti', 'september', 'oktober', 'november', 'december'
  ];
  const monthName = monthNames[month - 1];

  const prompt = `Du är en erfaren och varm marknadsföringskonsult som hjälper restaurangägare att förstå sin marknadsföring.
Du ska analysera månadsdata för ${customerName} för ${monthName} ${year} och ge en lättförståelig sammanfattning.

Här är all data för månaden:

${JSON.stringify(data, null, 2)}

Returnera ENBART ett JSON-objekt (utan markdown-kodblock) med exakt denna struktur:
{
  "summary": "En 3-4 meningar lång sammanfattning på svenska anpassad för restaurangägaren. Lyft fram de viktigaste resultaten och trenderna. Använd ett professionellt men varmt och uppmuntrande språk – som en konsult som verkligen bryr sig om sin kunds framgång. Undvik teknisk jargong."
}

Regler:
- Alltid på svenska
- Sammanfattningen ska vara 3-4 meningar, inte mer
- Om data saknas för en källa, nämn det kort och fokusera på tillgänglig data
- Returnera ENBART JSON, inga andra tecken utanför JSON-objektet`;

  try {
    logger.info('Generating AI summary', { customerName, month, year });

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    let content = message.content[0]?.text?.trim();
    if (!content) throw new Error('Empty response from Claude');

    // Strip markdown code fences if Claude wrapped the JSON
    content = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    const parsed = JSON.parse(content);

    if (!parsed.summary) {
      throw new Error('Invalid JSON structure from Claude');
    }

    logger.info('AI summary generated successfully');
    return { summary: parsed.summary };
  } catch (err) {
    logger.error('Failed to generate AI summary', { error: err.message });
    return {
      summary: `Månadsrapport för ${customerName} – ${monthName} ${year}. Data har samlats in från tillgängliga källor. Kontakta oss för en personlig genomgång av resultaten.`
    };
  }
}
