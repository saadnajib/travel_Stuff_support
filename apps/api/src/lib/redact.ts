const PLACEHOLDER = '[hidden: keep contact on CarryLink]';

// Phone numbers incl. international formats and spelled-out separators; at least 7 digits.
const PHONE_RE = /(?:\+|00)?[\s.\-()]*\d(?:[\s.\-()]*\d){6,14}/g;
const EMAIL_RE = /[A-Z0-9._%+-]+\s*(?:@|\(at\)|\[at\])\s*[A-Z0-9.-]+\s*(?:\.|\(dot\)|\[dot\])\s*[A-Z]{2,}/gi;
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s]+|\b[a-z0-9-]+\.(?:com|net|org|io|me|co|uk|pk|in|ae|de|ng|app|link)(?:\/[^\s]*)?/gi;
const MESSENGER_RE = /\b(?:whats\s*app|wa\.me|telegram|t\.me|signal|imo|viber|snap(?:chat)?|insta(?:gram)?)\b[\s:]*[@\w.+-]*/gi;

export function redactPii(body: string): { text: string; redacted: boolean } {
  let redacted = false;
  const apply = (re: RegExp, s: string) =>
    s.replace(re, () => {
      redacted = true;
      return PLACEHOLDER;
    });
  let text = body;
  text = apply(EMAIL_RE, text);
  text = apply(URL_RE, text);
  text = apply(MESSENGER_RE, text);
  text = apply(PHONE_RE, text);
  return { text, redacted };
}
