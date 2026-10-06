// ARE 5.0 divisions and content areas (sections), with the approximate share of
// exam items each section carries. Source: NCARB ARE 5.0 Guidelines. NCARB's
// April 2026 update adjusted some objectives but kept divisions, item counts and
// sections the same. Weights only drive the "focus next" ranking.

export const DIVISIONS = [
  {
    code: "PcM",
    name: "Practice Management",
    items: 65,
    areas: [
      { id: "PcM-1", name: "Business Operations", weight: [20, 26] },
      { id: "PcM-2", name: "Finances, Risk & Development of Practice", weight: [29, 35] },
      { id: "PcM-3", name: "Practice-Wide Delivery of Services", weight: [22, 28] },
      { id: "PcM-4", name: "Practice Methodologies", weight: [17, 23] }
    ]
  },
  {
    code: "PjM",
    name: "Project Management",
    items: 75,
    areas: [
      { id: "PjM-1", name: "Resource Management", weight: [7, 13] },
      { id: "PjM-2", name: "Project Work Planning", weight: [17, 23] },
      { id: "PjM-3", name: "Contracts", weight: [25, 31] },
      { id: "PjM-4", name: "Project Execution", weight: [17, 23] },
      { id: "PjM-5", name: "Project Quality Control", weight: [19, 25] }
    ]
  },
  {
    code: "PA",
    name: "Programming & Analysis",
    items: 75,
    areas: [
      { id: "PA-1", name: "Environmental & Contextual Conditions", weight: [14, 20] },
      { id: "PA-2", name: "Codes & Regulations", weight: [16, 22] },
      { id: "PA-3", name: "Site Analysis & Programming", weight: [21, 27] },
      { id: "PA-4", name: "Building Analysis & Programming", weight: [37, 43] }
    ]
  },
  {
    code: "PPD",
    name: "Project Planning & Design",
    items: 100,
    areas: [
      { id: "PPD-1", name: "Environmental Conditions & Context", weight: [10, 16] },
      { id: "PPD-2", name: "Codes & Regulations", weight: [16, 22] },
      { id: "PPD-3", name: "Building Systems, Materials & Assemblies", weight: [19, 25] },
      { id: "PPD-4", name: "Project Integration of Program & Systems", weight: [32, 38] },
      { id: "PPD-5", name: "Project Costs & Budgeting", weight: [8, 14] }
    ]
  },
  {
    code: "PDD",
    name: "Project Development & Documentation",
    items: 100,
    areas: [
      { id: "PDD-1", name: "Integration of Building Materials & Systems", weight: [31, 37] },
      { id: "PDD-2", name: "Construction Documentation", weight: [32, 38] },
      { id: "PDD-3", name: "Project Manual & Specifications", weight: [12, 18] },
      { id: "PDD-4", name: "Codes & Regulations", weight: [8, 14] },
      { id: "PDD-5", name: "Construction Cost Estimates", weight: [2, 8] }
    ]
  },
  {
    code: "CE",
    name: "Construction & Evaluation",
    items: 75,
    areas: [
      { id: "CE-1", name: "Preconstruction Activities", weight: [17, 23] },
      { id: "CE-2", name: "Construction Observation", weight: [32, 38] },
      { id: "CE-3", name: "Administrative Procedures & Protocols", weight: [32, 38] },
      { id: "CE-4", name: "Project Closeout & Evaluation", weight: [7, 13] }
    ]
  }
];

export const DIVISION_CODES = DIVISIONS.map(division => division.code);

export const DIVISION_STATUSES = [
  ["not-started", "Not started"],
  ["studying", "Studying"],
  ["scheduled", "Exam scheduled"],
  ["passed", "Passed"]
];

// Why a practice question was missed. Patterns here matter as much as content gaps.
export const MISTAKE_REASONS = [
  ["concept", "Didn't know the concept"],
  ["misread", "Misread the question"],
  ["trap", "Fell for a distractor"],
  ["calc", "Calculation error"],
  ["second-guess", "Changed a right answer"],
  ["time", "Rushed / ran out of time"],
  ["guess", "Guessed correctly (shaky)"]
];

export const COMMON_SOURCES = [
  "NCARB Practice Exam",
  "Black Spectacles",
  "Amber Book",
  "PPI / Ballast",
  "Brightwood",
  "Hyperfine",
  "Young Architect",
  "ArchiFlash",
  "Building Codes Illustrated",
  "AIA Contract Documents",
  "Architect's Handbook of Professional Practice"
];

export function divisionByCode(code) {
  return DIVISIONS.find(division => division.code === code) || null;
}

export function areaById(id) {
  for (const division of DIVISIONS) {
    const area = division.areas.find(item => item.id === id);
    if (area) return { ...area, division: division.code };
  }
  return null;
}

export function weightMid(area) {
  return area ? (area.weight[0] + area.weight[1]) / 2 : 0;
}

export function reasonLabel(value) {
  return (MISTAKE_REASONS.find(([key]) => key === value) || [value, value || "Unspecified"])[1];
}

// The website stored PcM/PjM as PCM/PJM.
export function normalizeDivisionCode(value) {
  const raw = String(value || "").trim();
  return DIVISION_CODES.find(code => code.toLowerCase() === raw.toLowerCase()) || "";
}
