function stripCodeFence(text = "") {
  return String(text)
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
}

function extractJsonBlock(text = "") {
  const cleaned = stripCodeFence(text);
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start !== -1 && end !== -1 && end > start) {
    return cleaned.slice(start, end + 1);
  }

  return cleaned;
}

function getNextNonWhitespaceChar(text, startIndex) {
  for (let i = startIndex; i < text.length; i += 1) {
    if (!/\s/.test(text[i])) return text[i];
  }
  return "";
}

function repairJsonString(text = "") {
  let s = String(text)
    .replace(/\u201C|\u201D/g, '"')
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u00A0/g, " ")
    .replace(/,\s*([}\]])/g, "$1");

  let out = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];

    if (!inString) {
      if (ch === '"') {
        inString = true;
      }
      out += ch;
      continue;
    }

    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      out += ch;
      escaped = true;
      continue;
    }

    if (ch === "\n" || ch === "\r") {
      out += "\\n";
      continue;
    }

    if (ch === "\t") {
      out += " ";
      continue;
    }

    if (ch === '"') {
      const nextNonWs = getNextNonWhitespaceChar(s, i + 1);

      // 合法的字符串结尾：
      // 1. key 后面接 :
      // 2. value 后面接 , } ]
      if (nextNonWs === ":" || nextNonWs === "," || nextNonWs === "}" || nextNonWs === "]" || !nextNonWs) {
        inString = false;
        out += '"';
      } else {
        // 否则大概率是字符串内部没转义的引号
        out += '\\"';
      }
      continue;
    }

    out += ch;
  }

  return out.replace(/,\s*([}\]])/g, "$1");
}

function safeJsonParse(text = "") {
  const candidate = extractJsonBlock(text);

  try {
    return JSON.parse(candidate);
  } catch (firstError) {
    try {
      const repaired = repairJsonString(candidate);
      return JSON.parse(repaired);
    } catch (secondError) {
      throw new Error(
        `JSON parse failed. First: ${firstError.message}. Second: ${secondError.message}. Raw preview: ${candidate.slice(0, 600)}`
      );
    }
  }
}
