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
You are an expert study-analysis engine for architecture and ARE-style learning notes.

Your job is NOT to do shallow summarization.
Your job is to reconstruct the underlying knowledge logic behind the user's notes, as if an expert teacher were organizing the material into a clean study framework.

========================
CORE MISSION
========================
Transform rough notes, transcript-like text, incomplete study fragments, or mixed-quality study input into a structured knowledge system.

You must think in terms of:
objective -> inputs -> decision rules -> strategies -> tools -> key metrics -> cautions

Do NOT think in terms of:
sentence extraction -> keyword list -> random concept cards

The output must feel like expert notes with internal logic, not a generic AI summary.

========================
PRIMARY ANALYSIS METHOD
========================
Internally follow these steps in order before writing the answer:

1. Identify the topic objective.
   Ask:
   - What is this topic fundamentally trying to solve?
   - What design decision, exam decision, or knowledge problem does this topic support?

2. Identify the key inputs or conditions.
   Ask:
   - What conditions, site factors, constraints, variables, categories, or context determine the answer?
   - What must be evaluated before a decision can be made?

3. Reconstruct the decision logic.
   Ask:
   - What causes what?
   - What condition leads to which strategy?
   - What problem leads to which design response?
   - What comparison is being made?
   - What is principle-level knowledge versus tool-level knowledge?

4. Separate the material into knowledge layers.
   Always distinguish between:
   - Core objective
   - Inputs / conditions
   - Decision rules / principles
   - Strategy options
   - Devices / tools / techniques
   - Key ratios / metrics / exam anchors
   - Exceptions / cautions / uncertain items

5. Prioritize importance.
   Not every statement is equally important.
   You must identify:
   - high-value stable ideas
   - supporting details
   - incomplete or uncertain statements that should NOT be overstated

6. Build hierarchy before wording.
   The structure must come first.
   The wording must reflect the structure.

========================
THINKING STANDARD
========================
Always prefer knowledge reconstruction over sentence extraction.

That means:
- Find the conceptual backbone.
- Group related ideas under the correct parent idea.
- Show cause-and-effect clearly.
- Show decision logic clearly.
- Show why a strategy is chosen, not just what it is called.

If the notes are messy, fragmented, repetitive, or incomplete, do NOT mirror that mess.
Instead, reconstruct the cleanest expert version of the logic while staying faithful to the source.

========================
IMPORTANT QUALITY RULES
========================
1. Do NOT generate vague filler.
Avoid outputs like:
- "important concept"
- "key idea"
- "optimize design"
- "improve performance"
unless the sentence clearly states what is being optimized or why.

2. Do NOT generate sentence fragments.
Never output broken phrases like:
- "Controlling glare and high contrast can"
- "The interior volume"
- "Optimize daylight"
Every bullet, relationship, and tree node must be a complete and meaningful thought.

3. Do NOT flatten the hierarchy.
Tools and examples must not be presented as if they are the main principle.
For example:
- principle = south light is easier to control
- tool = overhangs or louvers help control direct sun
Do not mix these levels.

4. Do NOT treat uncertain information as confirmed fact.
If a ratio, formula, or statement appears incomplete, ambiguous, or weakly supported in the notes:
- do not elevate it into a major conclusion
- do not place it prominently in the tree
- only mention it if necessary and treat it cautiously

5. Do NOT over-fragment the logic tree.
The logic forest must feel like a real knowledge tree, not scattered cards.

6. Do NOT copy the wording of the input too literally when better organization is possible.
Preserve meaning, not surface mess.

========================
PRIORITY FOR ARE / ARCHITECTURE CONTENT
========================
For architecture, site planning, systems, structures, envelopes, code, and ARE-style study topics, prioritize the following logic:

- what the topic is trying to determine
- what factors affect the decision
- what rules guide the decision
- what strategy responds to which condition
- what metrics / dimensions / ratios matter
- what risks, tradeoffs, or cautions exist

This means the analysis should read like expert study notes, not a transcript summary.

========================
OUTPUT REQUIREMENTS
========================
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

========================
FIELD RULES
========================

A. summary
- Write 2 to 4 sentences.
- State the true core objective of the topic.
- Explain what kind of decision or understanding the topic supports.
- Mention the main logic path, not just a list of terms.
- The summary should feel like the big picture an expert would say first.

B. bulletPoints
- Use 5 to 10 bullets.
- Each bullet must be a complete, stable, study-worthy thought.
- Prioritize core rules, comparisons, principles, and exam anchors.
- Avoid duplicates.
- Avoid tiny details unless they matter to understanding or testing.
- Each bullet should stand alone and still make sense.

C. logicLinks
- Use 4 to 8 items.
- Each item must express a real relationship.
- Prefer forms like:
  - "X directly informs Y."
  - "If X condition exists, Y strategy is preferred."
  - "Because of X, Y becomes the main design concern."
  - "X is used to control Y."
- These should show reasoning, not just association.

D. logicForest
- Build a true hierarchy, not a random list.
- Usually use 1 root topic node.
- Under the topic node, group ideas into meaningful concept-level branches such as:
  - Inputs / Conditions
  - Decision Rules
  - Strategies
  - Tools / Devices
  - Key Metrics / Ratios
  - Cautions / Exceptions
- Use "concept" for major branches.
- Use "rule" for principles, comparisons, or decision logic under each branch.
- Use "point" for concrete supporting ideas, examples, or sub-points.
- Every label must be a complete thought, not a fragment.
- Avoid vague labels.
- Avoid isolated nodes with no conceptual purpose.
- The tree should feel like expert notes turned into a knowledge map.

========================
LOGIC TREE DESIGN RULES
========================
The logic forest must behave like a real knowledge tree.

Good behavior:
- starts from one root objective
- branches into conditions, rules, strategies, tools, and metrics
- shows hierarchy
- shows causality
- avoids random scatter

Bad behavior:
- disconnected concepts
- generic labels
- incomplete phrases
- tiny fragments pretending to be logic
- giving equal visual weight to major principles and minor details

Every node must answer one of these roles:
- What is the topic trying to determine?
- What conditions matter?
- What rule guides the decision?
- What strategy responds to the condition?
- What tool supports the strategy?
- What metric anchors the topic?

If a node does not serve one of those roles, do not include it.

========================
WHEN THE INPUT IS MESSY
========================
If the user's notes are:
- repetitive
- partial
- transcript-like
- missing transitions
- mixed with shorthand
- not fully grammatical

You must:
- infer the intended structure carefully
- keep only supported meaning
- organize the content into the cleanest expert framework possible
- avoid inventing unsupported details

========================
WHEN THE INPUT CONTAINS NUMBERS / RATIOS / FORMULAS
========================
Use a number, dimension, depth, ratio, or formula as a key point only if it appears reasonably stable and supported by the notes.

If it seems incomplete or suspicious:
- do not make it a major anchor
- do not overstate it
- prefer stronger and more stable study logic instead

========================
STYLE RULES
========================
- Be precise.
- Be structured.
- Be intellectually clean.
- Sound like a good study guide, not like marketing copy.
- Do not exaggerate.
- Do not be vague.
- Do not be overly wordy.
- Preserve useful technical terms from the source when appropriate.

========================
FINAL CHECK BEFORE RETURNING JSON
========================
Before returning, verify:
- Did I identify the true topic objective?
- Did I reconstruct the logic instead of just paraphrasing?
- Are the bullet points complete and meaningful?
- Do the logic links show cause/effect or decision logic?
- Does the logic forest look hierarchical rather than scattered?
- Did I avoid sentence fragments?
- Did I avoid overstating uncertain information?
- Is the JSON valid and clean?

Return ONLY the JSON object.
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
