import { GoogleGenerativeAI } from "@google/generative-ai";

function safeParseBody(request) {
  if (!request?.body) return {};
  if (typeof request.body === "object") return request.body;

  try {
    return JSON.parse(request.body);
  } catch {
    return {};
  }
}

function extractJsonText(rawText) {
  const raw = String(rawText || "").trim();
  if (!raw) return "";

  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();

  try {
    JSON.parse(cleaned);
    return cleaned;
  } catch {
    // keep trying
  }

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const candidate = cleaned.slice(firstBrace, lastBrace + 1).trim();
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // keep trying
    }
  }

  return cleaned;
}

function asCleanString(value) {
  return String(value || "").trim();
}

function asStringArray(value) {
  if (Array.isArray(value)) {
    return value
      .map(item => String(item || "").trim())
      .filter(Boolean);
  }

  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }

  return [];
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function wordCount(text = "") {
  return asCleanString(text)
    .split(/\s+/)
    .filter(Boolean).length;
}

function canonicalLabel(text = "") {
  return asCleanString(text)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9%<>]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripLeadingImperative(text = "") {
  return asCleanString(text).replace(
    /^(determine|consider|explore|use|analyze|identify|understand|review|evaluate|provide|ensure|select|choose|control|study|learn|know|find)\s+/i,
    ""
  );
}

function normalizeLabel(text = "") {
  let label = asCleanString(text)
    .replace(/^[•\-*–—]+\s*/, "")
    .replace(/^\d+\s*[.)-]\s*/, "")
    .replace(/^step\s+\d+\s*[:.-]?\s*/i, "")
    .replace(/\s+/g, " ")
    .replace(/[;:.,]+$/g, "")
    .trim();

  label = stripLeadingImperative(label);

  if (wordCount(label) > 10 && /,/.test(label)) {
    label = label.split(",")[0].trim();
  }

  if (wordCount(label) > 10 && /\b(?:because|therefore|so that|which|that)\b/i.test(label)) {
    label = label.split(/\b(?:because|therefore|so that|which|that)\b/i)[0].trim();
  }

  return label;
}

function guessNodeType(label = "", fallback = "point") {
  const clean = canonicalLabel(label);

  if (!clean) return fallback;
  if (/(trap|risk|hardest|avoid|warning|error)/.test(clean)) return "trap";
  if (/(strategy|layout|orientation|control|shading|louver|method|sidelighting|toplighting|placement)/.test(clean)) {
    return "strategy";
  }
  if (/(goal|aim|target|objective|quality|performance)/.test(clean)) return "goal";
  if (/(rule|requirement|threshold|limit|minimum|maximum|moderate|predominantly|heavily|clear|covered|\d+%|%|<|>)/.test(clean)) {
    return "rule";
  }
  if (/(example|case)/.test(clean)) return "example";
  if (/(analysis|coverage|climate|microclimate|daylighting|daylight|site|factor|factors|overview|core ideas|key factors|categories|methods|types|systems)/.test(clean)) {
    return "concept";
  }

  return fallback;
}

function maybeSplitCompoundLeaf(label = "") {
  const raw = asCleanString(label);
  if (!raw.includes("/") || wordCount(raw) < 8) return null;

  const parts = raw
    .split(/\s*\/\s*/)
    .map(item => normalizeLabel(item))
    .filter(Boolean);

  if (parts.length < 2 || parts.length > 4) return null;
  if (!parts.every(item => wordCount(item) >= 1 && wordCount(item) <= 6)) return null;

  return {
    label: "Overview",
    type: "concept",
    children: parts.map(item => ({
      label: item,
      type: guessNodeType(item, "point"),
      children: []
    }))
  };
}

function dedupeChildren(children = []) {
  const seen = new Set();
  const result = [];

  for (const child of children) {
    const key = `${child.type}:${canonicalLabel(child.label)}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(child);
  }

  return result;
}

function flattenRepeatedChild(node) {
  if (!node?.children?.length) return node;

  const flattened = [];
  for (const child of node.children) {
    if (canonicalLabel(child.label) === canonicalLabel(node.label) && child.children.length) {
      flattened.push(...child.children);
    } else {
      flattened.push(child);
    }
  }

  return {
    ...node,
    children: dedupeChildren(flattened)
  };
}

function normalizeLogicNode(node, parentLabel = "") {
  if (!isPlainObject(node)) return null;

  const allowedTypes = new Set([
    "topic",
    "concept",
    "rule",
    "strategy",
    "goal",
    "point",
    "trap",
    "example"
  ]);

  const rawLabel = asCleanString(node.label);
  if (!rawLabel) return null;

  const compound = maybeSplitCompoundLeaf(rawLabel);
  if (compound && (!Array.isArray(node.children) || !node.children.length)) {
    return normalizeLogicNode(compound, parentLabel);
  }

  const label = normalizeLabel(rawLabel);
  if (!label) return null;

  const rawType = asCleanString(node.type).toLowerCase();
  const type = allowedTypes.has(rawType) ? rawType : guessNodeType(label, "point");

  const rawChildren = Array.isArray(node.children) ? node.children : [];
  let children = rawChildren
    .map(child => normalizeLogicNode(child, label))
    .filter(Boolean);

  children = dedupeChildren(children);

  let normalized = {
    label,
    type,
    children
  };

  normalized = flattenRepeatedChild(normalized);

  if (
    canonicalLabel(parentLabel) &&
    canonicalLabel(normalized.label) === canonicalLabel(parentLabel) &&
    normalized.children.length
  ) {
    return {
      label: "Overview",
      type: "concept",
      children: normalized.children
    };
  }

  return normalized;
}

function normalizeLogicForest(value, fallbackSummary = "", fallbackBullets = []) {
  let nodes = [];

  if (Array.isArray(value)) {
    nodes = value.map(node => normalizeLogicNode(node)).filter(Boolean);
  } else if (isPlainObject(value)) {
    if (isPlainObject(value.root)) {
      const rootNode = normalizeLogicNode(value.root);
      if (rootNode) nodes = [rootNode];
    } else {
      const directNode = normalizeLogicNode(value);
      if (directNode) nodes = [directNode];
    }
  }

  if (!nodes.length) {
    const fallbackChildren = fallbackBullets.slice(0, 6).map(item => ({
      label: normalizeLabel(item),
      type: guessNodeType(item, "point"),
      children: []
    }));

    return [
      {
        label: normalizeLabel(fallbackSummary) || "Study Notes",
        type: "topic",
        children: dedupeChildren(fallbackChildren)
      }
    ];
  }

  return nodes.map(node => flattenRepeatedChild(node));
}

function normalizeCaptureAnalysis(raw) {
  const summary = asCleanString(raw?.summary);
  const bulletPoints = asStringArray(raw?.bulletPoints).map(normalizeLabel).filter(Boolean);
  const logicLinks = asStringArray(raw?.logicLinks).map(asCleanString).filter(Boolean);
  const logicForest = normalizeLogicForest(
    raw?.logicForest,
    summary || "Study Notes",
    bulletPoints
  );

  return {
    summary,
    bulletPoints,
    logicLinks,
    logicForest
  };
}

function normalizeWrongQuestionAnalysis(raw) {
  const questionText = asCleanString(raw?.questionText);
  const summary = asCleanString(raw?.summary);
  const correctAnswer =
    typeof raw?.correctAnswer === "string"
      ? asCleanString(raw.correctAnswer)
      : asStringArray(raw?.correctAnswer);

  return {
    questionText,
    summary,
    correctAnswer,
    answerExtraction: asStringArray(raw?.answerExtraction),
    bulletPoints: asStringArray(raw?.bulletPoints),
    trapPoint: asStringArray(raw?.trapPoint),
    memoryHook: asCleanString(raw?.memoryHook)
  };
}

const CAPTURE_PROMPT = `
You are an ARE study-logic mapper.

Your job is to transform raw study notes into a compact review tree.
This must work for any ARE topic.
Do NOT hardcode topic words.

Return ONLY valid JSON.
Do not include markdown.
Do not include explanation.
Do not include commentary.
Do not wrap in triple backticks.

Use exactly this output shape:
{
  "summary": "",
  "bulletPoints": [""],
  "logicLinks": [""],
  "logicForest": [
    {
      "label": "",
      "type": "topic",
      "children": [
        {
          "label": "",
          "type": "concept",
          "children": [
            {
              "label": "",
              "type": "rule",
              "children": [
                {
                  "label": "",
                  "type": "point",
                  "children": []
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}

Rules:
1. Infer the real topic from the notes.
2. Build a study tree, not a sentence tree.
3. First group ideas into buckets, then place details under those buckets.
4. Good bucket examples: Overview, Key factors, Site analysis, Coverage, Orientation, Climate, Daylighting, System types, Requirements, Strategies, Traps, Examples.
5. Never repeat the root label as the first child unless the notes truly describe a nested subtopic with the same name.
6. If the notes begin with an overview sentence followed by slash-separated ideas, compress that into one concept bucket and split the ideas into short child nodes.
7. Convert long sentence fragments into compact noun phrases.
8. Prefer noun phrases over sentence fragments.
9. Keep every node label short:
   - ideally 1 to 6 words
   - maximum 8 words
10. Do not place full sentences inside nodes unless absolutely necessary.
11. Merge repetitive ideas instead of duplicating sibling nodes.
12. Use the root for the main topic only.
13. Use concept nodes for major categories.
14. Use rule or strategy nodes for methods, requirements, or guidance.
15. Use point, trap, or example nodes for compact details.
16. If numeric thresholds appear, group them under one category when possible.
17. Maximum depth: 4 levels including root.
18. Every node in logicForest must contain exactly:
   - label
   - type
   - children
19. children must always be an array, even if empty.
20. Allowed node types only:
   - topic
   - concept
   - rule
   - strategy
   - goal
   - point
   - trap
   - example
21. Do not leave placeholder labels in the final output.
22. Summary should be concise and useful for review.
23. Bullet points should be short review bullets.
24. Logic links should be short relationship statements only.

Good output style:
- Site Coverage -> Predominantly clear / Moderate / Heavily covered
- Orientation -> South / North / East-West

Bad output style:
- Determine the strengths and weaknesses of the site based on site analysis
- Site Planning -> Site Planning -> ...

Text:
`;

const WRONG_QUESTION_PROMPT = `
You are an ARE wrong-question study assistant.

Your job is to analyze the user's wrong-question content and return strict JSON only.

Return ONLY valid JSON.
Do not include markdown.
Do not include explanation.
Do not include commentary.
Do not wrap in triple backticks.

Use exactly this output shape:
{
  "questionText": "",
  "summary": "",
  "correctAnswer": "",
  "answerExtraction": [""],
  "bulletPoints": [""],
  "trapPoint": [""],
  "memoryHook": ""
}

Rules:
1. questionText should restate the question clearly if possible.
2. summary should explain the key learning point.
3. correctAnswer should be concise and direct.
4. answerExtraction should pull the core reasons or clues that support the answer.
5. bulletPoints should be short review bullets.
6. trapPoint should explain why the wrong path is tempting or incorrect.
7. memoryHook should be a short memorable reminder.
8. If the input is messy, infer the most likely study meaning from the content.
9. Keep everything concise and useful for future review.

Text:
`;

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.GEMINI_API_KEY) {
    return response.status(500).json({ error: "Missing GEMINI_API_KEY" });
  }

  try {
    const body = safeParseBody(request);
    const { text = "", type = "capture" } = body;

    if (!String(text || "").trim()) {
      return response.status(400).json({ error: "Empty text" });
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash"
    });

    const prompt =
      type === "wrong_question"
        ? `${WRONG_QUESTION_PROMPT}\n${text}`
        : `${CAPTURE_PROMPT}\n${text}`;

    const result = await model.generateContent(prompt);
    const rawText = result?.response?.text?.() || "";
    const jsonText = extractJsonText(rawText);

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      return response.status(500).json({
        error: `Model returned invalid JSON: ${jsonText.slice(0, 800)}`
      });
    }

    const analysis =
      type === "wrong_question"
        ? normalizeWrongQuestionAnalysis(parsed)
        : normalizeCaptureAnalysis(parsed);

    return response.status(200).json({ analysis });
  } catch (error) {
    return response.status(500).json({
      error: error?.message || "AI API Error"
    });
  }
}
