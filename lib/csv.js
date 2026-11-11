// Built from scripts/lib/csv.ts by apps/export-web/build.ts. Do not edit.
// Minimal CSV reader (RFC 4180: commas, double-quoted fields, "" escapes,
// CRLF or LF line endings). No dependencies, so import scripts run with
// plain Node.

                                            

                            
                    
                                                                                             
                                       
 

export function parseCsv(text        )            {
  const records             = [];
  let field = '';
  let record           = [];
  let inQuotes = false;

  // Strip a UTF-8 byte-order mark (Excel adds one on "CSV UTF-8" export).
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      record.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  const [headerRecord, ...body] = records;
  const headers = (headerRecord ?? []).map((h) => h.trim());
  const rows = body
    .map((values, idx) => ({ values, line: idx + 2 }))
    .filter(({ values }) => values.some((v) => v.trim() !== ''))
    .map(({ values, line }) => {
      const row                             = { _line: String(line) };
      headers.forEach((h, i) => (row[h] = values[i] ?? ''));
      return row;
    });
  return { headers, rows };
}
