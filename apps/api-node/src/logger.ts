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
