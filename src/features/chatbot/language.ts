/**
 * Very small language guess for pt-BR / es / en. Not authoritative — the model
 * is also told to mirror the customer's language — but good enough to seed the
 * conversation locale and pick the greeting.
 */
const PT =
  /\b(ol[áa]|bom dia|boa tarde|boa noite|agendar|hor[áa]rio|quero|obrigad|barbeiro|corte|pre[çc]o)\b/i;
const ES =
  /\b(hola|buenos d[íi]as|buenas|quiero|reservar|turno|horario|gracias|precio|barbero|corte)\b/i;
const EN = /\b(hi|hello|hey|book|appointment|available|thanks|price|haircut|barber|want)\b/i;

export function detectLocale(text: string, fallback = "pt-BR"): "pt-BR" | "en" | "es" {
  const t = text.toLowerCase();
  const score = {
    "pt-BR": (t.match(PT) ? 2 : 0) + (/[ãõ]|ç/.test(t) ? 1 : 0),
    es: (t.match(ES) ? 2 : 0) + (/[¿¡]|ñ/.test(t) ? 1 : 0),
    en: t.match(EN) ? 2 : 0,
  };
  const best = (Object.entries(score) as ["pt-BR" | "en" | "es", number][]).sort(
    (a, b) => b[1] - a[1],
  )[0]!;
  return best[1] === 0 ? (fallback as "pt-BR") : best[0];
}
