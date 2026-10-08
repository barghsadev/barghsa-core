export type SensitiveCategory = 'credential' | 'national_id' | 'bank_detail';

/** Remove known sensitive values before content leaves the API for an AI provider. */
export function redactAiText(input: string): {
  text: string;
  categories: SensitiveCategory[];
} {
  const categories = new Set<SensitiveCategory>();
  const replace = (category: SensitiveCategory) => {
    categories.add(category);
    return '[REDACTED]';
  };
  let text = input.replace(
    /\b((?:password|passwd|passcode|api[ _-]?key|access[ _-]?token|token|secret|authorization|bank[ _-]?account|account[ _-]?number|national[ _-]?(?:id|code))\s*(?::|=|\bis\b)\s*)(?:Bearer\s+)?(?:"[^"]+"|'[^']+'|[^\s,;.!?]+(?:\.[^\s,;.!?]+)*)/gi,
    (_match, label: string) =>
      label +
      replace(
        /account|bank/i.test(label)
          ? 'bank_detail'
          : /national/i.test(label)
            ? 'national_id'
            : 'credential'
      )
  );
  text = text.replace(/\bBearer\s+[A-Za-z0-9._~+/-]{8,}\b/gi, () => replace('credential'));
  text = text.replace(
    /\b(?:sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
    () => replace('credential')
  );
  text = text.replace(/(?<![A-Za-z0-9۰-۹٠-٩])IR[0-9۰-۹٠-٩]{24}(?![A-Za-z0-9۰-۹٠-٩])/gi, () =>
    replace('bank_detail')
  );
  text = text.replace(/(?<![0-9۰-۹٠-٩])(?:[0-9۰-۹٠-٩][ -]?){15}[0-9۰-۹٠-٩](?![0-9۰-۹٠-٩])/g, () =>
    replace('bank_detail')
  );
  text = text.replace(/(?<![0-9۰-۹٠-٩])[0-9۰-۹٠-٩]{10}(?![0-9۰-۹٠-٩])/g, (value) => {
    const digits = value.replace(/[۰-۹٠-٩]/g, (digit) => {
      const persian = '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit);
      return String(persian >= 0 ? persian : '٠١٢٣٤٥٦٧٨٩'.indexOf(digit));
    });
    const check = Number(digits[9]);
    const remainder =
      digits
        .slice(0, 9)
        .split('')
        .reduce((sum, digit, index) => sum + Number(digit) * (10 - index), 0) % 11;
    return check === (remainder < 2 ? remainder : 11 - remainder) ? replace('national_id') : value;
  });
  text = text.replace(
    /((?:رمز عبور|گذرواژه|توکن|کلید API|کد ملی|شماره ملی|شماره کارت|شماره حساب|شماره شبا)(?:[:：]\s*|\s+))([^\s،,;.!?]+)/giu,
    (_match, label: string) =>
      label +
      replace(
        /کد ملی|شماره ملی/.test(label)
          ? 'national_id'
          : /شماره کارت|شماره حساب|شماره شبا/.test(label)
            ? 'bank_detail'
            : 'credential'
      )
  );
  return { text, categories: [...categories] };
}
