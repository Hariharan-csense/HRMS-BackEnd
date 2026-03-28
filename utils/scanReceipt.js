const fs = require('fs');
const { DocumentProcessorServiceClient } = require('@google-cloud/documentai');

const client = new DocumentProcessorServiceClient({
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
});

function getMimeType(file) {
  if (!file || !file.mimetype) {
    throw new Error('File object missing or invalid');
  }

  if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/jpg')
    return 'image/jpeg';
  if (file.mimetype === 'image/png')
    return 'image/png';
  if (file.mimetype === 'application/pdf')
    return 'application/pdf';

  throw new Error(`Unsupported file type: ${file.mimetype}`);
}

async function scanReceipt(filePath, file) {
  const request = {
    name: `projects/${process.env.GOOGLE_PROJECT_ID}/locations/us/processors/${process.env.GOOGLE_PROCESSOR_ID}`,
    rawDocument: {
      content: fs.readFileSync(filePath),
      mimeType: getMimeType(file)
    }
  };

  const [result] = await client.processDocument(request);
  const document = result.document;

  let amount = null;
  let expense_date = null;
  let vendor = null;

  // 1️⃣ Expense Parser entities
  document.entities?.forEach(entity => {
    if (entity.type === 'total_amount') {
      amount = entity.normalizedValue?.moneyValue?.amount;
    }

    if (entity.type === 'transaction_date') {
      const d = entity.normalizedValue?.dateValue;
      if (d) {
        expense_date = `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
      }
    }

    if (entity.type === 'supplier_name') {
      vendor = entity.mentionText;
    }
  });

  // 2️⃣ FULL OCR TEXT (for fallback)
  const fullText = document.text || '';
  
  console.log('=== OCR DEBUG ===');
  console.log('Full Text:', fullText);
  console.log('Initial OCR Results:');
  console.log('- Amount:', amount);
  console.log('- Date:', expense_date);
  console.log('- Vendor:', vendor);

  // 🔍 Enhanced regex fallback for better extraction
  if (fullText && !expense_date) {
    // Try multiple date formats including Indian formats
    const datePatterns = [
      // Standard formats
      /(\d{2}[\/\-]\d{2}[\/\-]\d{4})/,           // DD/MM/YYYY or DD-MM-YYYY
      /(\d{2}[\/\-]\d{2}[\/\-]\d{2})/,           // DD/MM/YY or DD-MM-YY
      /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/,       // D/M/YYYY or D-M-YYYY
      /(\d{4}[\/\-]\d{2}[\/\-]\d{2})/,           // YYYY/MM/DD or YYYY-MM-DD
      
      // Indian bill formats
      /(\d{2}\.\d{2}\.\d{4})/,                   // DD.MM.YYYY
      /(\d{2}\.\d{2}\.\d{2})/,                   // DD.MM.YY
      /(\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})/i, // DD Month YYYY
      /(\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/i, // DD FullMonth YYYY
      
      // With prefixes
      /Date\s*[:\-]?\s*(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/i,
      /Bill\s*Date\s*[:\-]?\s*(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/i,
      /Invoice\s*Date\s*[:\-]?\s*(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/i,
      
      // Time with date (common in receipts)
      /(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})\s*(\d{1,2}:\d{2})/,
      
      // Just look for any 4-digit year pattern with day/month around it
      /(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](20\d{2})/,
    ];

    for (const pattern of datePatterns) {
      const match = fullText.match(pattern);
      if (match) {
        let dateStr = match[1] || match[2] || match[3]; // Handle multiple capture groups
        if (!dateStr) continue;
        
        // Clean up the date string
        dateStr = dateStr.replace(/[^\d\/\-\.]/g, '');
        
        // Convert different separators to standard format
        dateStr = dateStr.replace(/\./g, '/');
        
        // Convert YY to YYYY if needed
        const yearMatch = dateStr.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{2})$/);
        if (yearMatch) {
          const year = parseInt(yearMatch[3]);
          dateStr = `${yearMatch[1]}/${yearMatch[2]}/${year < 50 ? 2000 + year : 1900 + year}`;
        }
        
        // Try to parse and format as YYYY-MM-DD
        const dateMatch = dateStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
        if (dateMatch) {
          const day = parseInt(dateMatch[1]);
          const month = parseInt(dateMatch[2]);
          const year = parseInt(dateMatch[3]);
          
          // Validate day, month, year ranges
          if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 2000 && year <= 2030) {
            expense_date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            console.log(`Found date: ${expense_date} from pattern: ${pattern}`);
            break;
          }
        }
      }
    }
  }

  // 🔍 Enhanced amount extraction with better total detection
  if (fullText && !amount) {
    console.log('Attempting enhanced amount extraction...');
    
    // FLEXIBLE patterns - catch amounts that strict patterns miss
    const amountPatterns = [
      // 1. Strict final total patterns (highest priority)
      {
        pattern: /(?:GRAND\s*TOTAL|FINAL\s*TOTAL|TOTAL\s*DUE|TOTAL\s*PAYABLE|BILL\s*TOTAL|NET\s*TOTAL)[\s:]*\s*(?:Rs\.?|INR|\₹)?\s*([0-9]+(?:\.[0-9]{2})?)/i,
        priority: 1
      },
      // 2. Simple "TOTAL:" patterns (high priority)
      {
        pattern: /TOTAL[\s:]*\s*(?:Rs\.?|INR|\₹)?\s*([0-9]+(?:\.[0-9]{2})?)/i,
        priority: 2
      },
      // 3. "Gross:" patterns (common in receipts)
      {
        pattern: /Gross[\s:]*\s*(?:Rs\.?|INR|\₹)?\s*([0-9]+(?:\.[0-9]{2})?)/i,
        priority: 3
      },
      // 4. Currency patterns (more flexible)
      {
        pattern: /(?:Rs\.?|INR|\₹)\s*([0-9]+(?:\.[0-9]{2})?)/i,
        priority: 4
      },
      // 5. Amount followed by currency (reverse pattern)
      {
        pattern: /([0-9]+(?:\.[0-9]{2})?)\s*(?:Rs\.?|INR|\₹)/i,
        priority: 5
      },
      // 6. Numbers with decimal points (likely amounts)
      {
        pattern: /([0-9]+\.[0-9]{2})/i,
        priority: 6
      },
      // 7. Amount at very bottom (last line)
      {
        pattern: /^([0-9]+(?:\.[0-9]{2})?)\s*$/,
        priority: 7,
        context: 'very_bottom'
      }
    ];

    let bestMatch = null;
    let bestPriority = Infinity;

    // Split text into lines to analyze context
    const lines = fullText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    for (const { pattern, priority, context } of amountPatterns) {
      // Create a global version of the pattern for matchAll
      const globalPattern = new RegExp(pattern.source, pattern.flags + 'g');
      const matches = [...fullText.matchAll(globalPattern)];
      
      for (const match of matches) {
        const extractedAmount = parseFloat(match[1].replace(',', ''));
        
        // Reasonable filtering - realistic bill amounts
        if (extractedAmount < 1 || extractedAmount > 10000) continue;
        
        // Get the line containing this match
        const matchLine = lines.find(line => line.includes(match[0]));
        if (!matchLine) continue;
        
        // Less strict filtering - only skip obvious non-amounts
        const lineText = matchLine.toLowerCase();
        
        // Only skip lines that are clearly not amounts
        if (lineText.includes('phone') || 
            lineText.includes('mobile') || 
            lineText.includes('bill no') || 
            lineText.includes('gst') ||
            lineText.includes('fssai') ||
            lineText.includes('qty') ||
            lineText.includes('rate') ||
            lineText.includes('mrp')) continue;
        
        // For very_bottom context, only match absolute last line
        if (context === 'very_bottom') {
          if (lines.indexOf(matchLine) === lines.length - 1) {
            if (priority < bestPriority || (priority === bestPriority && extractedAmount > (bestMatch?.amount || 0))) {
              bestMatch = { amount: extractedAmount, source: match[0], priority };
              bestPriority = priority;
              console.log(`Found bottom amount: ${extractedAmount} from: "${matchLine}"`);
            }
          }
        } else {
          // Use priority-based selection, but prefer larger amounts for same priority
          if (priority < bestPriority || (priority === bestPriority && extractedAmount > (bestMatch?.amount || 0))) {
            bestMatch = { amount: extractedAmount, source: match[0], priority };
            bestPriority = priority;
            console.log(`Found amount: ${extractedAmount} from: "${matchLine}" (priority: ${priority})`);
          }
        }
      }
    }

    if (bestMatch) {
      amount = bestMatch.amount;
      console.log(`Found amount: ${amount} from pattern: "${bestMatch.source}" (priority: ${bestMatch.priority})`);
    }
  }

  // 🔍 Enhanced vendor extraction
  if (fullText && !vendor) {
    const lines = fullText.split('\n').filter(line => line.trim().length > 0);
    
    // Look for vendor in first few lines
    for (let i = 0; i < Math.min(5, lines.length); i++) {
      const line = lines[i].trim();
      // Skip lines that look like amounts, dates, or common headers
      if (!/^\d+$/.test(line) && 
          !line.match(/^\d{2}[\/\-]\d{2}[\/\-]\d{4}/) &&
          !line.toLowerCase().includes('total') &&
          !line.toLowerCase().includes('amount') &&
          !line.toLowerCase().includes('receipt') &&
          !line.toLowerCase().includes('bill') &&
          line.length > 3) {
        vendor = line;
        break;
      }
    }
  }

  console.log('Final OCR Results:');
  console.log('- Amount:', amount);
  console.log('- Date:', expense_date);
  console.log('- Vendor:', vendor);
  console.log('=================');

  return {
    amount,
    expense_date,
    vendor,
    fullText
  };
}

module.exports = scanReceipt;
