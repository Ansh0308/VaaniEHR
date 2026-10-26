// Minimal structured logger (JSON lines on stdout/stderr). Never pass PHI, tokens or secrets in fields.

type Fields = Record<string, unknown>;

function write(level: 'info' | 'warn' | 'error', message: string, fields: Fields = {}): void {
  if (process.env.NODE_ENV === 'test' && process.env.LOG_IN_TESTS !== 'true') return;
  const line = JSON.stringify({ level, time: new Date().toISOString(), message, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else
    process.stdout.write(`${line}
`);
}

export const logger = {
  info: (message: string, fields?: Fields) => write('info', message, fields),
  warn: (message: string, fields?: Fields) => write('warn', message, fields),
  error: (message: string, fields?: Fields) => write('error', message, fields),
};

/**
 * An error message made safe to write to a log (ADR-D44, ASVS 16.2.5): database and library messages can quote the value that
 * caused them (`invalid input syntax for type uuid: "..."`), and a thrown message can carry anything a caller put in it. Quoted
 * text, e-mail addresses, token-like strings and long digit runs are masked, and the length is capped. The error NAME and a
 * database code stay readable; that is what an operator needs.
 */
export function redactMessage(message: string): string {
  return message
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'`]*/gi, '<url>')
    .replace(/"[^"]*"|'[^']*'|`[^`]*`/g, '"?"')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]*/g, '<jwt>')
    .replace(/\b(Bearer|Basic)\s+\S+/gi, '$1 <redacted>')
    .replace(/[A-Za-z0-9+/_=-]{24,}/g, '<token>')
    .replace(/\d{6,}/g, '<digits>')
    .slice(0, 200);
}
