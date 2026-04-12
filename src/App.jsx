import { useEffect, useMemo, useState } from 'react'

const palaceData = {
  PA: {
    rooms: ['Site Analysis', 'Codes', 'Programming', 'Environmental Context'],
    starter:
      'Programming and analysis notes go here. Think about site conditions, zoning, adjacency, and early project constraints.',
  },
  PPD: {
    rooms: ['Site', 'Climate', 'Structure', 'Mechanical', 'Envelope', 'Codes'],
    starter:
      'Building system: active system relies on mechanical equipment and uses more energy. Passive system relies on sun, air, and wind flow. In cold climate, reduce heat loss and gain solar heat. In hot climate, control heat gain and optimize natural ventilation. Trombe wall helps stabilize temperature but takes more space.',
  },
  PDD: {
    rooms: ['Assemblies', 'Detailing', 'Specifications', 'Coordination'],
    starter:
      'Detailing notes go here. Think about wall assemblies, membranes, flashing, thermal continuity, specifications, and coordination between systems.',
  },
  PCM: {
    rooms: ['Practice Ops', 'Risk', 'Finance'],
    starter:
      'Practice management notes go here. Think about firm operations, liability, staffing, billing, and financial planning.',
  },
  PJM: {
    rooms: ['Contracts', 'Bidding', 'Construction Admin'],
    starter:
      'Project management notes go here. Think about scope, schedule, consultant coordination, bidding, and CA workflows.',
  },
  CE: {
    rooms: ['Site Visits', 'Documentation', 'Observation Reports'],
    starter:
      'Construction evaluation notes go here. Think about field reports, submittals, RFIs, observations, and closeout.',
  },
}

const STORAGE_KEYS = {
  division: 'are-study-selected-division',
  room: 'are-study-selected-room',
  notes: 'are-study-notes-map',
  savedAt: 'are-study-last-saved-at',
  wrongAnswerText: 'are-study-wrong-answer-text',
}

function getNoteKey(division, room) {
  return `${division}__${room}`
}

function getInitialDivision() {
  const saved = localStorage.getItem(STORAGE_KEYS.division)
  return saved && palaceData[saved] ? saved : 'PPD'
}

function getInitialRoom(division) {
  const saved = localStorage.getItem(STORAGE_KEYS.room)
  return saved && palaceData[division].rooms.includes(saved)
    ? saved
    : palaceData[division].rooms[0]
}

function getStoredNotes() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.notes)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function getInitialNote(division, room) {
  const notesMap = getStoredNotes()
  const savedNote = notesMap[getNoteKey(division, room)]
  return savedNote ?? palaceData[division].starter
}

function extractData(text, selectedDivision, selectedRoom) {
  const clean = text.trim()

  if (!clean) {
    return {
      summary: '还没有内容，先把你的视频笔记、手写转录内容或课堂总结贴进来。',
      chunks: [],
      links: [],
      locations: [`${selectedDivision} → ${selectedRoom}`],
    }
  }

  const lower = clean.toLowerCase()
  const chunks = []

  if (lower.includes('active system')) {
    chunks.push({
      title: 'Active System',
      desc: '依赖机械设备，控制更强，但通常能耗更高。',
    })
  }

  if (lower.includes('passive system')) {
    chunks.push({
      title: 'Passive System',
      desc: '依赖太阳、空气和风等自然条件，通常更节能。',
    })
  }

  if (lower.includes('cold climate') || lower.includes('hot climate')) {
    chunks.push({
      title: 'Cold Climate vs Hot Climate',
      desc: '寒冷气候强调减少热损失，炎热气候强调控制热增益与通风。',
    })
  }

  if (lower.includes('trombe wall')) {
    chunks.push({
      title: 'Trombe Wall',
      desc: '一种被动式采暖策略，可稳定温度，但占空间。',
    })
  }

  if (chunks.length === 0) {
    clean
      .split(/[.!?]\s+/)
      .filter(Boolean)
      .slice(0, 4)
      .forEach((item, index) => {
        chunks.push({
          title: `Note Chunk ${index + 1}`,
          desc: item,
        })
      })
  }

  const links = []
  if (lower.includes('passive system')) {
    links.push('Passive System → depends on → Sun / Air / Wind')
  }
  if (lower.includes('active system')) {
    links.push('Active System → relies on → Mechanical Equipment')
  }
  if (lower.includes('cold climate')) {
    links.push('Cold Climate → goal → Reduce Heat Loss')
  }
  if (lower.includes('hot climate')) {
    links.push('Hot Climate → goal → Control Heat Gain')
  }
  if (lower.includes('cold climate') && lower.includes('hot climate')) {
    links.push('Cold Climate ↔ contrasts with ↔ Hot Climate')
  }
  if (lower.includes('trombe wall')) {
    links.push('Trombe Wall → example of → Passive Strategy')
  }

  const locations = [
    `${selectedDivision} → ${selectedRoom}`,
    `${selectedDivision} → Core Concepts`,
    `${selectedDivision} → Review`,
  ]

  const summary = `当前定位：${selectedDivision} / ${selectedRoom}。这个页面会把原始笔记先收进来，再自动拆成小知识块、关系和建议归类位置。`

  return { summary, chunks, links, locations }
}

function summarizeWrongAnswer(text, division, room) {
  const clean = text.trim()

  if (!clean) {
    return null
  }

  const lines = clean
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const correctLine =
    lines.find((line) =>
      /correct answer|answer|正确答案|答案[:：]?/i.test(line)
    ) || '未明确识别，请手动补充正确答案。'

  const explanationLines = lines.filter((line) =>
    /because|therefore|so|reason|explanation|因为|所以|因此|解析|原因/i.test(line)
  )

  const topicGuess = `${division} → ${room}`

  const keyPoints = [
    '先判断题目真正考的是概念、系统、流程，还是规范逻辑。',
    '不要只记正确选项，要记“为什么其他项错”。',
    '把这题归到固定房间里，后面复习时更容易回忆。',
  ]

  if (/climate|solar|heat|passive|active|thermal|sun|wind/i.test(clean)) {
    keyPoints.unshift('这题更像环境策略 / building systems 逻辑题，先抓性能目标，再看手段。')
  }

  const memoryHook =
    '复习时不要背整题，改记成：题目考点 + 正确逻辑 + 最容易误判的点。'

  return {
    correctAnswer: correctLine,
    whyRight:
      explanationLines[0] ||
      '请从答案分析里提炼一句：这个选项为什么最符合题干条件。',
    trapPoint:
      explanationLines[1] ||
      '最容易错在只看到表面关键词，却没有先判断题目真正考的系统逻辑。',
    topicGuess,
    keyPoints,
    memoryHook,
  }
}

export default function App() {
  const [selectedDivision, setSelectedDivision] = useState(() => getInitialDivision())
  const [selectedRoom, setSelectedRoom] = useState(() =>
    getInitialRoom(getInitialDivision())
  )
  const [note, setNote] = useState(() =>
    getInitialNote(getInitialDivision(), getInitialRoom(getInitialDivision()))
  )
  const [lastSavedAt, setLastSavedAt] = useState(
    () => localStorage.getItem(STORAGE_KEYS.savedAt) || ''
  )

  const [wrongAnswerText, setWrongAnswerText] = useState(
    () => localStorage.getItem(STORAGE_KEYS.wrongAnswerText) || ''
  )
  const [wrongAnswerImage, setWrongAnswerImage] = useState(null)
  const [wrongAnswerSummary, setWrongAnswerSummary] = useState(null)

  const currentRooms = palaceData[selectedDivision].rooms

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.division, selectedDivision)
  }, [selectedDivision])

  useEffect(() => {
    if (!currentRooms.includes(selectedRoom)) {
      const firstRoom = currentRooms[0]
      setSelectedRoom(firstRoom)
      return
    }

    localStorage.setItem(STORAGE_KEYS.room, selectedRoom)
    const notesMap = getStoredNotes()
    const storedNote = notesMap[getNoteKey(selectedDivision, selectedRoom)]
    setNote(storedNote ?? palaceData[selectedDivision].starter)
  }, [selectedDivision, selectedRoom, currentRooms])

  useEffect(() => {
    const timer = setTimeout(() => {
      const notesMap = getStoredNotes()
      notesMap[getNoteKey(selectedDivision, selectedRoom)] = note
      localStorage.setItem(STORAGE_KEYS.notes, JSON.stringify(notesMap))

      const savedTime = new Date().toLocaleString()
      localStorage.setItem(STORAGE_KEYS.savedAt, savedTime)
      setLastSavedAt(savedTime)
    }, 400)

    return () => clearTimeout(timer)
  }, [note, selectedDivision, selectedRoom])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.wrongAnswerText, wrongAnswerText)
  }, [wrongAnswerText])

  const result = useMemo(() => {
    return extractData(note, selectedDivision, selectedRoom)
  }, [note, selectedDivision, selectedRoom])

  function handleManualSave() {
    const notesMap = getStoredNotes()
    notesMap[getNoteKey(selectedDivision, selectedRoom)] = note
    localStorage.setItem(STORAGE_KEYS.notes, JSON.stringify(notesMap))

    const savedTime = new Date().toLocaleString()
    localStorage.setItem(STORAGE_KEYS.savedAt, savedTime)
    setLastSavedAt(savedTime)
  }

  function handleLoadSample() {
    setNote(palaceData[selectedDivision].starter)
  }

  function handleClear() {
    setNote('')
    const notesMap = getStoredNotes()
    notesMap[getNoteKey(selectedDivision, selectedRoom)] = ''
    localStorage.setItem(STORAGE_KEYS.notes, JSON.stringify(notesMap))

    const savedTime = new Date().toLocaleString()
    localStorage.setItem(STORAGE_KEYS.savedAt, savedTime)
    setLastSavedAt(savedTime)
  }

  function handleWrongAnswerImageChange(event) {
    const file = event.target.files?.[0]
    if (!file) return

    const imageUrl = URL.createObjectURL(file)
    setWrongAnswerImage(imageUrl)
  }

  function handleAnalyzeWrongAnswer() {
    const summary = summarizeWrongAnswer(
      wrongAnswerText,
      selectedDivision,
      selectedRoom
    )
    setWrongAnswerSummary(summary)
  }

  function handleLoadWrongAnswerSample() {
    const sample = `Question:
Which strategy is most appropriate for reducing heat loss in a cold climate building?

Correct Answer: Increase insulation and take advantage of solar heat gain.

Explanation:
In cold climates, the building envelope should minimize heat loss and use passive solar gain when possible.
A common trap is choosing a strategy focused mainly on reducing heat gain, which is more appropriate for hot climates.
This question is testing climate-based passive design logic rather than a random isolated fact.`

    setWrongAnswerText(sample)
    setWrongAnswerSummary(
      summarizeWrongAnswer(sample, selectedDivision, selectedRoom)
    )
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="panel">
          <div className="panel-title">ARE Study Vault</div>
          <div className="panel-subtitle">空间结构 + 自动分块</div>
        </div>

        <div className="panel">
          <div className="section-title">Memory Palace</div>
          {Object.keys(palaceData).map((division) => (
            <button
              key={division}
              className={`pill ${selectedDivision === division ? 'active' : ''}`}
              onClick={() => setSelectedDivision(division)}
            >
              {division}
            </button>
          ))}
        </div>

        <div className="panel">
          <div className="section-title">{selectedDivision} Rooms</div>
          {currentRooms.map((room) => (
            <button
              key={room}
              className={`list-button ${selectedRoom === room ? 'active-room' : ''}`}
              onClick={() => setSelectedRoom(room)}
            >
              {room}
            </button>
          ))}
        </div>
      </aside>

      <main className="main-grid">
        <section className="panel big-panel">
          <div className="section-title">Capture</div>
          <div className="section-subtitle">
            把你的视频笔记、聊天整理、手写转录内容先丢进来。
          </div>

          <div className="status-row">
            <span className="status-tag">Division: {selectedDivision}</span>
            <span className="status-tag">Room: {selectedRoom}</span>
            <span className="status-tag light">
              {lastSavedAt ? `Saved: ${lastSavedAt}` : 'Not saved yet'}
            </span>
          </div>

          <textarea
            className="note-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Paste your ARE notes here..."
          />

          <div className="action-row">
            <button className="small-action" onClick={handleManualSave}>
              Save Note
            </button>

            <button className="small-action" onClick={handleLoadSample}>
              Load {selectedDivision} Sample
            </button>

            <button className="small-action ghost" onClick={handleClear}>
              Clear
            </button>
          </div>

          <div className="hint-box">
            现在这版已经支持本地保存。刷新页面后，当前浏览器里的内容会自动恢复。
          </div>
        </section>

        <section className="panel">
          <div className="section-title">Extraction</div>
          <div className="card soft">
            <div className="card-title">Summary</div>
            <div className="card-text">{result.summary}</div>
          </div>

          <div className="card-grid">
            {result.chunks.map((chunk) => (
              <div className="card" key={chunk.title}>
                <div className="card-title">{chunk.title}</div>
                <div className="card-text">{chunk.desc}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="section-title">Logic Links</div>
          {result.links.length === 0 ? (
            <div className="empty">还没有识别到关系。</div>
          ) : (
            result.links.map((item, index) => (
              <div className="list-item" key={index}>
                {item}
              </div>
            ))
          )}
        </section>

        <section className="panel">
          <div className="section-title">Suggested Placement</div>
          {result.locations.map((item, index) => (
            <div className="list-item" key={index}>
              {item}
            </div>
          ))}
        </section>

        <section className="panel big-panel">
          <div className="section-title">Wrong Answer Lab</div>
          <div className="section-subtitle">
            先上传题目截图做预览，再把题干、答案和解析粘进来，系统会帮你提炼错题重点。
          </div>

          <div className="wrong-answer-grid">
            <div>
              <label className="upload-box">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleWrongAnswerImageChange}
                  className="hidden-input"
                />
                <span>Upload Question Image</span>
              </label>

              {wrongAnswerImage ? (
                <img
                  src={wrongAnswerImage}
                  alt="Wrong answer preview"
                  className="wrong-answer-image"
                />
              ) : (
                <div className="image-placeholder">
                  上传题目截图后，这里会显示预览。
                </div>
              )}
            </div>

            <div>
              <textarea
                className="note-input wrong-answer-textarea"
                value={wrongAnswerText}
                onChange={(e) => setWrongAnswerText(e.target.value)}
                placeholder="Paste question, answer, and explanation here..."
              />

              <div className="action-row">
                <button className="small-action" onClick={handleAnalyzeWrongAnswer}>
                  Extract Mistake Summary
                </button>

                <button
                  className="small-action ghost"
                  onClick={handleLoadWrongAnswerSample}
                >
                  Load Sample
                </button>
              </div>
            </div>
          </div>

          {wrongAnswerSummary && (
            <div className="wrong-answer-result">
              <div className="card soft">
                <div className="card-title">Correct Answer</div>
                <div className="card-text">{wrongAnswerSummary.correctAnswer}</div>
              </div>

              <div className="card-grid three-col">
                <div className="card">
                  <div className="card-title">Why It Is Right</div>
                  <div className="card-text">{wrongAnswerSummary.whyRight}</div>
                </div>

                <div className="card">
                  <div className="card-title">Trap Point</div>
                  <div className="card-text">{wrongAnswerSummary.trapPoint}</div>
                </div>

                <div className="card">
                  <div className="card-title">ARE Topic</div>
                  <div className="card-text">{wrongAnswerSummary.topicGuess}</div>
                </div>
              </div>

              <div className="card">
                <div className="card-title">Key Points to Remember</div>
                <ul className="key-points-list">
                  {wrongAnswerSummary.keyPoints.map((point, index) => (
                    <li key={index}>{point}</li>
                  ))}
                </ul>
              </div>

              <div className="card">
                <div className="card-title">Memory Hook</div>
                <div className="card-text">{wrongAnswerSummary.memoryHook}</div>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
